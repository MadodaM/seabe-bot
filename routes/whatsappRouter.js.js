// routes/whatsappRouter.js
// PURPOSE: Catch and route all incoming WhatsApp messages from Twilio
const express = require('express');
const router = express.Router();
const prisma = require('../services/prisma'); 

// POST: Twilio sends incoming messages here
router.post('/incoming', async (req, res) => {
    const incomingMsg = (req.body.Body || '').trim().toLowerCase();
    const senderPhone = (req.body.From || '').replace('whatsapp:', ''); // Clean the number

    console.log(`📩 Message from ${senderPhone}: ${incomingMsg}`);

    try {
        let responseMessage = "";

        // 1. Check if this is a known Church Admin or Member
        const churchMember = await prisma.member.findFirst({
            where: { phone: senderPhone },
            include: { church: true }
        });

        // 2. Check if this is a Society Member
        const societyMember = await prisma.member.findFirst({
            where: { phone: senderPhone, societyCode: { not: null } }
        });

        // --- ROUTING LOGIC ---

        // A. Trigger Church Menu
        if (incomingMsg === 'church' || incomingMsg === 'hi') {
            if (churchMember) {
                responseMessage = `Welcome back to ${churchMember.church?.name || 'your Church'}.\n\n1. Pay Tithes\n2. View Events\n3. Contact Pastor`;
            } else {
                responseMessage = "Welcome to SEABE. You aren't linked to a church yet. Please reply with your Church Code to join.";
            }
        } 
        
        // B. Trigger Society Menu
        else if (incomingMsg === 'society') {
            if (societyMember) {
                responseMessage = `SOCIETY MENU:\n\n1. Check Benefits\n2. Pay Premium\n3. Log Death Claim`;
            } else {
                responseMessage = "You are not currently linked to a Burial Society.";
            }
        }

        // C. Fallback / Gemini AI Support
        else {
            responseMessage = "I received your message. Type 'Church' for ministry tools or 'Society' for insurance services.";
        }

        // Send the response back to Twilio
        const twiml = `
            <Response>
                <Message>${responseMessage}</Message>
            </Response>
        `;

        res.set('Content-Type', 'text/xml');
        res.send(twiml);

    } catch (error) {
        console.error("❌ Routing Error:", error);
        res.status(500).send('<Response><Message>System error. Please try again later.</Message></Response>');
    }
});

module.exports = router;