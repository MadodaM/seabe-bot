// ==========================================
// routes/webhooks.js - Seabe Omni-Payment Listener
// ==========================================
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendWhatsApp } = require('../services/whatsapp');

// 💰 CORE WEBHOOK: Listens for NetCash / Ozow payment updates
// URL: https://your-render-url.com/api/webhooks/payment (depending on how it's mounted in index.js)
router.post('/api/core/webhooks/payment', express.urlencoded({ extended: true }), express.json(), async (req, res) => {
    
    // 1️⃣ Extract Payload (Handles both standard JSON and NetCash ITN formats)
    const reference = req.body.reference || req.body.Reference || req.body.p2;
    const status = req.body.status || req.body.TransactionStatusCode || req.body.TransactionStatus;
    const amount = req.body.amount || req.body.Amount || 0;

    try {
        console.log(`💰 WEBHOOK RECEIVED: Payment [${status}] for Ref: [${reference}]`);

        if (!reference) return res.status(200).send('No reference provided');

        // 2️⃣ The Omni-Search: Check Collections first, then Transactions
        let record = await prisma.collection.findFirst({ where: { reference: reference } });
        let recordType = 'COLLECTION';

        if (!record) {
            record = await prisma.transaction.findFirst({ where: { reference: reference } });
            recordType = 'TRANSACTION';
        }

        if (!record) {
            console.error(`❌ Webhook Error: Reference ${reference} not found in Collections or Transactions.`);
            return res.status(200).send('Reference Not Found'); // Return 200 so gateway stops retrying
        }

        // 3️⃣ Determine if Successful (NetCash uses '1' or '002', others use 'SUCCESS')
        const isSuccess = status === 'SUCCESS' || status === '1' || status === '002' || status === 'Completed';

        if (isSuccess && record.status !== 'PAID') {
            
            // A. Update the correct table
            if (recordType === 'COLLECTION') {
                await prisma.collection.update({ where: { id: record.id }, data: { status: 'PAID', updatedAt: new Date() } });
            } else {
                await prisma.transaction.update({ where: { id: record.id }, data: { status: 'PAID', updatedAt: new Date() } });
            }

            // B. Find the Phone Number to update Member and Send Receipt
            // (Collections have phone natively. Transactions might just have phone, but let's be safe)
            const targetPhone = record.phone; 

            if (targetPhone) {
                // Mark Member as ACTIVE
                await prisma.member.update({
                    where: { phone: targetPhone },
                    data: { status: 'ACTIVE' }
                }).catch(e => console.log("Note: Member update skipped or member not found."));

                // Send Receipt
                const receiptMsg = `✅ *Payment Successful*\n\nWe have received your payment of *R${parseFloat(amount || record.amount).toFixed(2)}* (Ref: ${reference}).\n\nYour Seabe Burial Society policy is now *ACTIVE*. Thank you!`;
                await sendWhatsApp(targetPhone, receiptMsg);
                console.log(`✅ Payment Loop Closed for ${targetPhone}`);
            }
        } 
        else if (status === 'FAILED' || status === 'CANCELLED' || status === 'ERROR' || status === '003') {
            // Handle Failure
            if (recordType === 'COLLECTION') {
                await prisma.collection.update({ where: { id: record.id }, data: { status: 'OVERDUE', updatedAt: new Date() } });
            } else {
                await prisma.transaction.update({ where: { id: record.id }, data: { status: 'FAILED', updatedAt: new Date() } });
            }

            if (record.phone) {
                const failMsg = `⚠️ *Payment Failed*\n\nYour recent payment attempt for Ref: ${reference} was unsuccessful.\n\nPlease try again using your link or reply *Menu* to generate a new one.`;
                await sendWhatsApp(record.phone, failMsg);
            }
        }

        return res.status(200).send('Webhook Processed Successfully');

    } catch (error) {
        console.error("❌ Webhook Processing Error:", error);
        return res.status(500).send('Internal Server Error');
    }
});

module.exports = router;