// routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
let client;
if (process.env.TWILIO_SID && process.env.TWILIO_AUTH) {
    client = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
}

// Gateway modules
const ozow = require('../services/ozow');
const netcash = require('../services/netcash');

// Utility: Phone Formatter
const formatPhone = (phone) => {
    if (!phone) return "";
    let clean = phone.replace(/\D/g, '');
    if (clean.startsWith('0')) clean = '27' + clean.slice(1);
    return '+' + clean;
};

// ==========================================
// 🛡️ WEBHOOK: PAYSTACK (Standard & Recurring)
// ==========================================
router.post('/paystack/webhook', async (req, res) => {
    try {
        const hash = crypto.createHmac('sha512', PAYSTACK_SECRET).update(JSON.stringify(req.body)).digest('hex');
        if (hash !== req.headers['x-paystack-signature']) return res.sendStatus(400);

        const event = req.body;
        if (event.event === 'charge.success') {
            const data = event.data;
            const ref = data.reference;

            const existingTx = await prisma.transaction.findUnique({ where: { reference: ref } });
            if (existingTx && existingTx.status === 'SUCCESS') return res.sendStatus(200);

            const transaction = await prisma.transaction.update({
                where: { reference: ref },
                data: { status: 'SUCCESS' }
            });

            if (transaction && client) {
                const userPhone = transaction.phone;
                const date = new Date().toISOString().split('T')[0];
                const pdfUrl = `https://invoice-generator.com?currency=ZAR&from=Seabe&to=${userPhone}&date=${date}&items[0][name]=Contribution&items[0][unit_cost]=${transaction.amount}`;

                await client.messages.create({
                    from: process.env.TWILIO_PHONE_NUMBER,
                    to: `whatsapp:${formatPhone(userPhone)}`,
                    body: `✅ *Receipt: Payment Received*\n\nRef: ${ref}\nAmount: R${transaction.amount}\n\nThank you! 🙏`,
                    mediaUrl: [ pdfUrl ]
                });
            }
        }
        res.sendStatus(200);
    } catch (e) {
        console.error("Webhook Error:", e);
        res.sendStatus(500);
    }
});

router.post('/payment-success', async (req, res) => {
    const event = req.body;
    if (event.event === 'charge.success') {
        const paystackData = event.data;
        const verifiedAmount = paystackData.amount / 100;
        const phone = paystackData.customer.email.split('@')[0];

        try {
            let transaction = await prisma.transaction.findFirst({
                where: { phone: phone, amount: verifiedAmount, status: 'PENDING' },
                orderBy: { createdAt: 'desc' },
                include: { church: true }
            });

            if (transaction) {
                await prisma.transaction.update({
                    where: { id: transaction.id },
                    data: { status: 'SUCCESS', reference: paystackData.reference }
                });
                console.log(`✅ Recurring Payment Success for ${phone}`);
            }
        } catch (error) { console.error("❌ Webhook Error:", error.message); }
    }
    res.sendStatus(200);
});

// ==========================================
// 💳 BROWSER SUCCESS PAGE
// ==========================================
router.get('/payment-success', async (req, res) => {
    const { reference } = req.query;
    if (!reference) return res.status(400).send("Missing reference.");

    try {
        const resp = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
        });

        if (resp.data.data.status === 'success') {
            const paystackData = resp.data.data;
            const verifiedAmount = paystackData.amount / 100; 
            const phone = (paystackData.metadata?.whatsapp_number || paystackData.metadata?.phone || "").replace('whatsapp:', '').replace('+', '');

            let transaction = await prisma.transaction.findUnique({
                where: { reference: reference },
                include: { church: true } 
            });

            if (!transaction && phone) {
                transaction = await prisma.transaction.findFirst({
                    where: { OR: [{ phone: phone }, { phone: `+${phone}` }], amount: verifiedAmount, status: 'PENDING' },
                    include: { church: true }
                });
            }

            if (transaction) {
                await prisma.transaction.update({
                    where: { id: transaction.id },
                    data: { status: 'SUCCESS', reference: reference }
                });

                const displayName = transaction.church?.name || transaction.churchCode || "Seabe Platform";
                const invoiceDate = new Date().toISOString().split('T')[0];

                const receiptBody = 
                    `📜 *OFFICIAL DIGITAL RECEIPT*\n--------------------------------\n` +
                    `🏛️ *Organization:* ${displayName}\n👤 *Member:* ${transaction.phone}\n` +
                    `💰 *Amount:* R${transaction.amount}.00\n📅 *Date:* ${invoiceDate}\n` +
                    `🔢 *Reference:* ${reference}\n--------------------------------\n` +
                    `✅ *Status:* Confirmed & Recorded\n\n_Thank you for your faithful contribution._`;

                if (client) {
                    await client.messages.create({
                        from: process.env.TWILIO_PHONE_NUMBER,
                        to: `whatsapp:${formatPhone(transaction.phone)}`,
                        body: receiptBody
                    }).catch(err => console.error("❌ Receipt Delivery Error:", err.message));
                }
                return res.send(`<h1>✅ Payment Received</h1><p>Check WhatsApp for your receipt from ${displayName}.</p>`);
            }
        }
        res.send("<h1>Processing...</h1><p>We are still verifying your payment. Check WhatsApp shortly.</p>");
    } catch (error) {
        res.status(500).send("An error occurred during verification.");
    }
});

// ==========================================
// 🔄 PAYMENT SYNC ENGINES
// ==========================================
router.get('/admin/sync-payments', async (req, res) => {
    const ACTIVE_GATEWAY_NAME = process.env.ACTIVE_GATEWAY || 'OZOW'; 
    const gateway = ACTIVE_GATEWAY_NAME === 'NETCASH' ? netcash : ozow;

    try {
        const pendingTransactions = await prisma.transaction.findMany({ where: { status: 'PENDING' } });
        let updatedCount = 0;

        for (const tx of pendingTransactions) {
            try {
                const verifyData = await gateway.verifyPayment(tx.reference);
                if (verifyData && (verifyData.status === 'Complete' || verifyData.status === 'success')) {
                    await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'SUCCESS' } });
                    updatedCount++;
                }
            } catch (err) {}
        }
        res.send({ message: `Sync Complete via ${ACTIVE_GATEWAY_NAME}`, checked: pendingTransactions.length, updated: updatedCount });
    } catch (error) { res.status(500).send({ error: error.message }); }
});

router.get('/cron/sync-payments', async (req, res) => {
    const cronKey = req.headers['x-cron-key'] || req.query.key;
    if (cronKey !== process.env.SECRET_CRON_KEY) return res.status(401).send("Unauthorized");

    try {
        const pendingTxs = await prisma.transaction.findMany({
            where: { status: 'PENDING', createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }
        });

        let fixes = 0;
        for (const tx of pendingTxs) {
            const resp = await axios.get(`https://api.paystack.co/transaction/verify/${tx.reference}`, {
                headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
            });
            if (resp.data.data.status === 'success') {
                await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'SUCCESS' } });
                fixes++;
            }
        }
        res.status(200).send({ status: "success", updated: fixes });
    } catch (e) { res.status(500).send("Internal Error"); }
});

module.exports = router;