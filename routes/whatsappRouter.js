// routes/whatsappRouter.js
// PURPOSE: Catch and route all incoming WhatsApp messages from Twilio
const express = require('express');
const router = express.Router();
const prisma = require('../services/prisma'); 
const { MessagingResponse } = require('twilio').twiml;

// 📦 Import the Payment Bot from the root folder
const paymentBot = require('../paymentBot');

// POST: Twilio sends incoming messages here
router.post('/incoming', async (req, res) => {
    const twiml = new MessagingResponse();
    const incomingMsg = (req.body.Body || '').trim().toLowerCase();
    const senderPhone = (req.body.From || '').replace('whatsapp:', ''); // Clean the number

    console.log(`📩 Message from ${senderPhone}: ${incomingMsg}`);

    try {
        // 1. Check if this is a known Church Admin or Member
        const churchMember = await prisma.member.findFirst({
            where: { phone: senderPhone },
            include: { church: true }
        });

        // 2. Check if this is a Society Member
        const societyMember = await prisma.member.findFirst({
            where: { phone: senderPhone, societyCode: { not: null } }
        });

        // Combine into a single member object for the bots to read
        const member = churchMember || societyMember;

        // --- ROUTING LOGIC ---

        // 💳 A. Trigger Payment Bot FIRST
        // If the user typed 'pay', 'tithe', etc., paymentBot will generate the Ozow link and handle it.
        const isPaymentHandled = await paymentBot.process(incomingMsg, senderPhone, member, twiml);
        
        if (isPaymentHandled) {
            res.set('Content-Type', 'text/xml');
            return res.send(twiml.toString());
        }

        // ⛪ B. Trigger Church Menu
        let responseMessage = "";
        if (incomingMsg === 'church' || incomingMsg === 'hi') {
            if (churchMember) {
                responseMessage = `Welcome back to ${churchMember.church?.name || 'your Church'}.\n\n1. Pay Tithes\n2. View Events\n3. Contact Pastor`;
            } else {
                responseMessage = "Welcome to SEABE. You aren't linked to a church yet. Please reply with your Church Code to join.";
            }
            twiml.message(responseMessage);
        } 
        
        // 🛡️ C. Trigger Society Menu
        else if (incomingMsg === 'society') {
            if (societyMember) {
                responseMessage = `SOCIETY MENU:\n\n1. Check Benefits\n2. Pay Premium\n3. Log Death Claim`;
            } else {
                responseMessage = "You are not currently linked to a Burial Society.";
            }
            twiml.message(responseMessage);
        }

        // 🤖 D. Fallback / Support
        else {
            responseMessage = "I received your message. Type 'Church' for ministry tools, 'Society' for insurance services, or 'Pay' to make a payment.";
            twiml.message(responseMessage);
        }

        // Send the response back to Twilio
        res.set('Content-Type', 'text/xml');
        res.send(twiml.toString());

    } catch (error) {
        console.error("❌ Routing Error:", error);
        res.status(500).send('<Response><Message>System error. Please try again later.</Message></Response>');
    }
});

module.exports = router;