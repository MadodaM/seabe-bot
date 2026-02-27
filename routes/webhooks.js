// ==========================================
// routes/webhooks.js - Seabe Core Payments
// ==========================================
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendWhatsApp } = require('../services/whatsapp'); // Adjust path if needed

// 💰 CORE WEBHOOK: Listens for NetCash / Ozow payment updates
router.post('/api/core/webhooks/payment', async (req, res) => {
    // Payment gateways typically send data in the request body
    // Adjust these variable names if NetCash/Ozow uses slightly different keys (e.g., 'TransactionStatus')
    const { reference, status, amount } = req.body;

    try {
        console.log(`💰 WEBHOOK RECEIVED: Payment ${status} for Ref: ${reference}`);

        // 1️⃣ Find the invoice/collection using the unique reference
        const collection = await prisma.collection.findFirst({
            where: { reference: reference } 
        });

        if (!collection) {
            console.error(`❌ Webhook Error: No collection found for reference ${reference}`);
            // Still return 200 so the payment gateway stops spamming us with retries
            return res.status(200).send('Reference Not Found');
        }

        // 2️⃣ Process a SUCCESSFUL payment
        // (Checking for common success strings used by SA gateways)
        if (status === 'SUCCESS' || status === '000' || status === 'Completed') {
            
            // A. Mark the collection/invoice as PAID
            await prisma.collection.update({
                where: { id: collection.id },
                data: { status: 'PAID', updatedAt: new Date() }
            });

            // B. Mark the Member's policy as ACTIVE (The Magic Step ✨)
            if (collection.memberId) {
                await prisma.member.update({
                    where: { id: collection.memberId },
                    data: { status: 'ACTIVE' }
                });
            }

            // C. Send the Automated WhatsApp Digital Receipt
            const receiptMsg = `✅ *Payment Successful*\n\nHi ${collection.firstName},\nWe have received your premium payment of *R${parseFloat(amount).toFixed(2)}* (Ref: ${reference}).\n\nYour Seabe Burial Society policy is now *ACTIVE*. Thank you!`;
            await sendWhatsApp(collection.phone, receiptMsg);

            console.log(`✅ Payment Loop Closed for ${collection.firstName}`);
        }

        // 3️⃣ Process a FAILED or CANCELLED payment
        else if (status === 'FAILED' || status === 'CANCELLED' || status === 'ERROR') {
            
            await prisma.collection.update({
                where: { id: collection.id },
                data: { status: 'OVERDUE', updatedAt: new Date() }
            });

            const failMsg = `⚠️ *Payment Failed*\n\nHi ${collection.firstName},\nYour recent payment attempt for R${parseFloat(amount).toFixed(2)} was unsuccessful.\n\nPlease try again using your original link or reply *1* to speak to an administrator.`;
            await sendWhatsApp(collection.phone, failMsg);
            
            console.log(`⚠️ Payment failed for ${collection.firstName}`);
        }

        // 🛡️ Always return a 200 OK status to the payment provider. 
        // If you don't, they think your server is down and will keep resending the same webhook every 5 minutes.
        return res.status(200).send('Webhook Processed Successfully');

    } catch (error) {
        console.error("❌ Webhook Processing Error:", error);
        return res.status(500).send('Internal Server Error');
    }
});

module.exports = router;