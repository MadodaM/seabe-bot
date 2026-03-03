// routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Twilio Setup
let client;
if (process.env.TWILIO_SID && process.env.TWILIO_AUTH) {
    client = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
}

// 🚀 GATEWAY: Exclusively Netcash
const netcash = require('../services/netcash');

// Utility: Phone Formatter
const formatPhone = (phone) => {
    if (!phone) return "";
    let clean = phone.replace(/\D/g, '');
    if (clean.startsWith('0')) clean = '27' + clean.slice(1);
    return '+' + clean;
};

// ==========================================
// 🛡️ WEBHOOK: NETCASH SERVER-TO-SERVER
// ==========================================
router.post('/netcash/webhook', async (req, res) => {
    try {
        // Netcash typically sends data via POST body.
        const reference = req.body.Reference || req.body.p2; 
        const isSuccess = req.body.TransactionAccepted === 'true' || req.body.Reason === '00'; 

        if (!reference) return res.status(400).send("Missing reference");

        if (isSuccess) {
            // 🚀 THE MULTI-TENANT FIX: We find the transaction EXACTLY by its unique reference!
            const transaction = await prisma.transaction.findUnique({ 
                where: { reference: reference },
                include: { member: true, church: true }
            });

            if (transaction && transaction.status === 'PENDING') {
                // 1. Update Transaction to Success
                await prisma.transaction.update({
                    where: { id: transaction.id },
                    data: { status: 'SUCCESS' }
                });

                // 2. Send the Official Receipt via WhatsApp
                if (client) {
                    const targetPhone = transaction.member ? transaction.member.phone : transaction.phone;
                    const orgName = transaction.church ? transaction.church.name : "Seabe Platform";
                    
                    await client.messages.create({
                        from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '')}`,
                        to: `whatsapp:${formatPhone(targetPhone)}`,
                        body: `✅ *Receipt: Payment Received*\n\n🏛️ *Org:* ${orgName}\nRef: ${reference}\nAmount: R${transaction.amount}\n\nThank you for your contribution! 🙏`
                    });
                }
            }
        }
        res.sendStatus(200);
    } catch (e) {
        console.error("Netcash Webhook Error:", e);
        res.sendStatus(500);
    }
});

// ==========================================
// 💳 BROWSER SUCCESS REDIRECT (Netcash Return URL)
// ==========================================
router.get('/payment-success', async (req, res) => {
    // Netcash usually appends the reference parameter to the return URL
    const reference = req.query.Reference || req.query.ref || req.query.p2;
    
    if (!reference) {
        return res.send("<div style='text-align:center;font-family:sans-serif;margin-top:50px;'><h1>Processing...</h1><p>Payment received but waiting on bank confirmation. You will receive a WhatsApp receipt shortly.</p></div>");
    }

    try {
        // Double check the status directly with Netcash (Anti-Fraud)
        const verifyData = await netcash.verifyPayment(reference);

        if (verifyData && (verifyData.status === 'Complete' || verifyData.status === 'success' || verifyData.TransactionAccepted)) {
            
            // 🚀 MULTI-TENANT FIX: Lookup strictly by reference, NOT phone!
            const transaction = await prisma.transaction.findUnique({
                where: { reference: reference },
                include: { member: true, church: true } 
            });

            if (transaction) {
                if (transaction.status === 'PENDING') {
                    await prisma.transaction.update({
                        where: { id: transaction.id },
                        data: { status: 'SUCCESS' }
                    });
                    
                    const targetPhone = transaction.member ? transaction.member.phone : transaction.phone;
                    const displayName = transaction.church ? transaction.church.name : "Seabe Platform";
                    const invoiceDate = new Date().toISOString().split('T')[0];

                    const receiptBody = 
                        `📜 *OFFICIAL DIGITAL RECEIPT*\n--------------------------------\n` +
                        `🏛️ *Organization:* ${displayName}\n` +
                        `💰 *Amount:* R${transaction.amount.toFixed(2)}\n📅 *Date:* ${invoiceDate}\n` +
                        `🔢 *Reference:* ${reference}\n--------------------------------\n` +
                        `✅ *Status:* Confirmed & Recorded\n\n_Thank you for your faithful contribution._`;

                    if (client && targetPhone) {
                        await client.messages.create({
                            from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '')}`,
                            to: `whatsapp:${formatPhone(targetPhone)}`,
                            body: receiptBody
                        }).catch(err => console.error("❌ Receipt Delivery Error:", err.message));
                    }
                }

                const orgName = transaction.church ? transaction.church.name : "Seabe Platform";
                return res.send(`
                    <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
                        <h1 style="color:#2ecc71;">✅ Payment Successful!</h1>
                        <p>Your payment of <b>R${transaction.amount.toFixed(2)}</b> to <b>${orgName}</b> has been securely received.</p>
                        <p>You may now close this window and return to WhatsApp.</p>
                    </div>
                `);
            }
        }
        res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
                <h1 style="color:#f39c12;">⏳ Processing...</h1>
                <p>We are waiting for final confirmation from Netcash. Your receipt will be sent to WhatsApp shortly.</p>
            </div>
        `);
    } catch (error) {
        console.error("Browser Redirect Verification Error:", error.message);
        res.status(500).send("<div style='text-align:center;font-family:sans-serif;margin-top:50px;'><h1>Bank Sync Delay</h1><p>An error occurred verifying with the bank, but your transaction is safe. Please check your WhatsApp for the receipt.</p></div>");
    }
});

// ==========================================
// 🔄 PAYMENT SYNC ENGINES (Cron & Manual)
// ==========================================
router.get('/admin/sync-payments', async (req, res) => {
    try {
        const pendingTransactions = await prisma.transaction.findMany({ where: { status: 'PENDING' } });
        let updatedCount = 0;

        for (const tx of pendingTransactions) {
            try {
                // Check Netcash for status updates on pending transactions
                const verifyData = await netcash.verifyPayment(tx.reference);
                if (verifyData && (verifyData.status === 'Complete' || verifyData.status === 'success' || verifyData.TransactionAccepted)) {
                    await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'SUCCESS' } });
                    updatedCount++;
                }
            } catch (err) {} 
        }
        res.send({ message: `Sync Complete via Netcash`, checked: pendingTransactions.length, updated: updatedCount });
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
            try {
                const verifyData = await netcash.verifyPayment(tx.reference);
                if (verifyData && (verifyData.status === 'Complete' || verifyData.status === 'success' || verifyData.TransactionAccepted)) {
                    await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'SUCCESS' } });
                    fixes++;
                }
            } catch (err) {}
        }
        res.status(200).send({ status: "success", updated: fixes });
    } catch (e) { res.status(500).send("Internal Error"); }
});

module.exports = router;