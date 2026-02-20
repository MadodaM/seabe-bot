const express = require('express');
const router = express.Router();
const { sendWhatsApp } = require('../services/whatsapp'); // Adjust path if your service is elsewhere

module.exports = (app, { prisma }) => {

    // --- SEABE COLLECT WEBHOOK ---
    // Point your new Twilio Collections number to: https://seabe.tech/webhook/collections
    router.post('/webhook/collections', async (req, res) => {
        // Clean the incoming phone number (Twilio sends 'whatsapp:+2783...')
        const incomingPhone = req.body.From ? req.body.From.replace('whatsapp:+', '') : '';
        const userMessage = req.body.Body ? req.body.Body.trim() : '';

        if (!incomingPhone) return res.status(200).send('Ignored');

        try {
            // Check if this number has a recent outstanding collection blast
            const activeDebt = await prisma.collection.findFirst({
                where: { 
                    phone: incomingPhone, 
                    status: { in: ['SENT', 'PROMISE_TO_PAY', 'DISPUTED'] } 
                },
                orderBy: { id: 'desc' }
            });

            if (activeDebt) {
                // User chose Option 1: Promise to Pay
                if (userMessage === '1') {
                    await prisma.collection.update({ where: { id: activeDebt.id }, data: { status: 'PROMISE_TO_PAY' }});
                    await sendWhatsApp(incomingPhone, "✅ *Promise to Pay Recorded*\n\nThank you. We have updated your account profile. Please ensure the settlement is made shortly using the secure link provided earlier to avoid further action.");
                } 
                
                // User chose Option 2: Dispute
                else if (userMessage === '2') {
                    await prisma.collection.update({ where: { id: activeDebt.id }, data: { status: 'DISPUTED' }});
                    await sendWhatsApp(incomingPhone, "⚠️ *Dispute Logged*\n\nWe have paused further automated collections for this invoice. The billing team has been notified and will contact you directly to resolve this query.");
                } 
                
                // If they just typed "Hi" or complained, show them the menu
                else {
                    await sendWhatsApp(incomingPhone, "Hello. This is the automated accounts assistant.\n\nTo help us manage your outstanding statement, please select an option:\n\nReply *1* to make a Promise to Pay.\nReply *2* to Dispute this invoice.\n\n👉 *Or scroll up to click your secure payment link to settle it now.*");
                }
                
                return res.status(200).send('Event Handled');
            } else {
                // If a random person texts the collections number
                await sendWhatsApp(incomingPhone, "Hello. We currently don't have any active outstanding statements linked to this number. If you have a query, please contact the billing department directly.");
                return res.status(200).send('Event Handled');
            }

        } catch (error) {
            console.error("Collections Webhook Error:", error);
            return res.status(500).send('Internal Server Error');
        }
    });

    // Mount the router
    app.use('/', router);
};