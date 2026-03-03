// ==========================================
// routes/collectionbot.js - Accounts Assistant
// ==========================================
const express = require('express');
const router = express.Router();
const { sendWhatsApp } = require('../services/whatsapp'); 

module.exports = (app, { prisma }) => {

    // --- SEABE COLLECT WEBHOOK ---
    // Point your Twilio Collections number to: https://seabe-bot-test.onrender.com/webhook/collections
    router.post('/webhook/collections', async (req, res) => {
        // 1. Clean the incoming phone number securely (strips 'whatsapp:+' and leaves pure digits like '27821234567')
        const incomingPhone = req.body.From ? req.body.From.replace(/\D/g, '') : '';
        const userMessage = req.body.Body ? req.body.Body.trim() : '';

        if (!incomingPhone) return res.status(200).send('Ignored');

        try {
            // 2. Check if this number has an active debt (Looking for REMINDER_1, FINAL_NOTICE, etc.)
            const activeDebt = await prisma.collection.findFirst({
                where: { 
                    phone: incomingPhone, 
                    status: { in: ['REMINDER_1', 'FINAL_NOTICE', 'PROMISE_TO_PAY', 'DISPUTED'] } 
                },
                orderBy: { id: 'desc' }
            });

            if (activeDebt) {
                // Fetch the Organization to personalize the chat!
                const org = await prisma.church.findUnique({ where: { code: activeDebt.churchCode } });
                const orgName = org ? org.name : "our billing department";

                // User chose Option 2: Promise to Pay
                if (userMessage === '2') {
                    await prisma.collection.update({ where: { id: activeDebt.id }, data: { status: 'PROMISE_TO_PAY' }});
                    await sendWhatsApp(incomingPhone, `✅ *Promise to Pay Recorded*\n\nThank you. We have updated your account profile with ${orgName}. Please ensure the settlement is made shortly using the secure Netcash link provided earlier to avoid further action.`);
                } 
                
                // User chose Option 3: Dispute
                else if (userMessage === '3') {
                    await prisma.collection.update({ where: { id: activeDebt.id }, data: { status: 'DISPUTED' }});
                    await sendWhatsApp(incomingPhone, `⚠️ *Dispute Logged*\n\nWe have paused further automated collections for this invoice. The team at ${orgName} has been notified and will contact you directly to resolve this query.`);
                } 
                
                // If they typed "1" (Assistance) or literally anything else like "Hi"
                else {
                    await sendWhatsApp(incomingPhone, `Hello. This is the automated accounts assistant for *${orgName}*.\n\nTo help us manage your outstanding premium of *R${activeDebt.amount.toFixed(2)}*, please select an option:\n\nReply *2* to make a Promise to Pay.\nReply *3* to Dispute this invoice.\n\n👉 *Or scroll up to click your secure payment link to settle it now.*`);
                }
                
                return res.status(200).send('Event Handled');
            } else {
                // If a random person texts the collections number
                await sendWhatsApp(incomingPhone, "Hello. We currently don't have any active outstanding statements linked to this number. If you have a query, please contact your organization directly.");
                return res.status(200).send('Event Handled');
            }

        } catch (error) {
            console.error("Collections Webhook Error:", error);
            return res.status(500).send('Internal Server Error');
        }
    });

    app.use('/', router);
};