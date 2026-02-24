// routes/whatsappRouter.js
const express = require('express');
const router = express.Router();
const { MessagingResponse } = require('twilio').twiml;
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const sgMail = require('@sendgrid/mail'); 
const axios = require('axios');

// Bot Imports
const { getAISupportReply } = require('../services/aiSupport');
const { handleSocietyMessage } = require('../societyBot');
const { handleChurchMessage } = require('../churchBot');
const paymentBot = require('../paymentBot');

let userSession = {}; 

router.post('/', async (req, res) => {
    const twiml = new MessagingResponse();
    const incomingMsg = (req.body.Body || '').trim().toLowerCase();
    const cleanPhone = (req.body.From || '').replace('whatsapp:', '');

    // 1. Respond to Twilio IMMEDIATELY to prevent timeouts
    res.type('text/xml').send('<Response></Response>');

    // 2. Handle logic in background
    try {
        if (!userSession[cleanPhone]) userSession[cleanPhone] = {};
        const session = userSession[cleanPhone];

        const member = await prisma.member.findUnique({
            where: { phone: cleanPhone },
            include: { church: true, society: true }
        });

        // ------------------------------------------------
        // 🛠️ ADMIN TRIGGERS & REPORTS
        // ------------------------------------------------
        if (incomingMsg.startsWith('report ')) {
            // ... (Your existing Report CSV logic remains intact here) ...
            return;
        }

        if (incomingMsg.startsWith('verify ')) {
            // ... (Your existing Paystack Verify logic remains intact here) ...
            return;
        }

        // ------------------------------------------------
        // 🚦 BOT ROUTING
        // ------------------------------------------------
        if (!member) {
            // User is not in DB yet
            if (session.step === 'JOIN_SELECT' || session.step === 'SEARCH' || incomingMsg === 'join') {
                // ... (Your Onboarding/Search logic remains intact here) ...
            } else {
                await paymentBot.sendMessage(cleanPhone, "👋 Welcome! Reply *Join* to start.");
            }
            return;
        }

        // Global Cancel
        if (incomingMsg === 'exit' || incomingMsg === 'cancel') {
            delete userSession[cleanPhone];
            await paymentBot.sendMessage(cleanPhone, "🔄 Session cleared. Reply *Hi* to see the main menu.");
            return;
        }

        // Route to Society Bot
        if (incomingMsg === 'society' || session.mode === 'SOCIETY' || session.flow === 'SOCIETY_PAYMENT') {
            if (member.societyCode) {
                session.mode = 'SOCIETY';
                return handleSocietyMessage(cleanPhone, incomingMsg, session, member);
            }
        }

        // Route to Church Bot
        if (incomingMsg === 'hi' || incomingMsg === 'menu' || session.mode === 'CHURCH' || session.flow === 'CHURCH_PAYMENT') {
            if (member.churchCode) {
                session.mode = 'CHURCH';
                return handleChurchMessage(incomingMsg, cleanPhone, session, member);
            }
        }

        // ================================================
        // 🤖 FALLBACK: AI CATCH-ALL
        // ================================================
        console.log(`🤖 AI Support Triggered for: ${incomingMsg}`);
        try {
            const aiResponse = await getAISupportReply(incomingMsg, cleanPhone, member?.firstName);
            await paymentBot.sendMessage(cleanPhone, aiResponse);
        } catch (error) {
            await paymentBot.sendMessage(cleanPhone, "🤔 I didn't quite catch that. Reply *Menu* to see available options.");
        }

    } catch (e) {
        console.error("Router Error:", e);
    }
});

module.exports = router;