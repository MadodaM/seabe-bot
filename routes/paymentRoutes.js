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

// 🎨 Reusable CSS & Template for a premium Seabe Pay feel
const seabeStyles = `
    :root { --primary: #14b8a6; --danger: #e74c3c; --bg: #f4f7f6; --text: #2c3e50; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 100vh; margin: 0; text-align: center; padding: 20px; }
    .card { background: white; padding: 40px 30px; border-radius: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.08); max-width: 400px; width: 100%; }
    .icon { font-size: 64px; margin-bottom: 20px; }
    h1 { margin: 0 0 10px 0; font-size: 24px; font-weight: 800; }
    p { color: #7f8c8d; line-height: 1.5; margin-bottom: 30px; font-size: 15px; }
    .btn { background: var(--primary); color: white; border: none; padding: 16px 24px; border-radius: 12px; font-size: 16px; font-weight: bold; width: 100%; cursor: pointer; text-decoration: none; display: inline-block; box-sizing: border-box; }
    .btn-outline { background: transparent; color: var(--text); border: 2px solid #e0e6ed; margin-top: 10px; }
    .seabe-brand { font-size: 14px; font-weight: 800; color: #b2bec3; margin-top: 30px; text-transform: uppercase; letter-spacing: 1px; }
    .seabe-brand span { color: var(--primary); }
`;

const renderPage = (title, icon, heading, message, isError = false) => `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
        <style>
            ${seabeStyles}
            ${isError ? '.icon { filter: grayscale(100%); } .btn { background: var(--danger); }' : ''}
        </style>
    </head>
    <body>
        <div class="card">
            <div class="icon">${icon}</div>
            <h1>${heading}</h1>
            <p>${message}</p>
            <a href="https://wa.me/27832182707" class="btn">Return to WhatsApp</a>
            <button onclick="window.close()" class="btn btn-outline">Close Window</button>
        </div>
        <div class="seabe-brand">Secured by Seabe <span>Pay</span></div>
    </body>
    </html>
`;

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
        return res.send(renderPage('Processing', '⏳', 'Processing...', 'Payment received but waiting on bank confirmation. You will receive a WhatsApp receipt shortly.'));
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
                return res.send(renderPage(
                    'Payment Successful', 
                    '✅', 
                    'Payment Successful!', 
                    `Your payment of <b>R${transaction.amount.toFixed(2)}</b> to <b>${orgName}</b> has been securely received.`
                ));
            }
        }
        res.send(renderPage('Processing', '⏳', 'Processing...', 'We are waiting for final confirmation from Netcash. Your receipt will be sent to WhatsApp shortly.'));
    } catch (error) {
        console.error("Browser Redirect Verification Error:", error.message);
        res.status(500).send(renderPage('Bank Sync Delay', '⚠️', 'Bank Sync Delay', 'An error occurred verifying with the bank, but your transaction is safe. Please check your WhatsApp for the receipt.', true));
    }
});

// ==========================================
// ❌ BROWSER CANCEL REDIRECT (Netcash Cancel URL)
// ==========================================
router.get('/payment-failed', (req, res) => {
    res.send(renderPage(
        'Payment Cancelled', 
        '⚠️', 
        'Payment Incomplete', 
        'Your transaction was cancelled or declined. No funds were deducted from your account.', 
        true
    ));
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