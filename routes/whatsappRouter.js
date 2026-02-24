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
       // ================================================
            // 🚦 USER ROUTING LOGIC & MENUS
            // ================================================
            if (!member) {
                // User is not in DB yet - Handle Onboarding
                if (session.step === 'JOIN_SELECT' || session.step === 'SEARCH' || incomingMsg === 'join') {
                    if (session.step !== 'JOIN_SELECT') {
                         const results = await prisma.church.findMany({
                             where: { name: { contains: incomingMsg, mode: 'insensitive' } },
                             take: 5
                         });

                         if (results.length > 0) {
                             session.searchResults = results;
                             let reply = `🔍 Found ${results.length} matches:\n\n` + 
                                     results.map((r, i) => `*${i+1}.* ${r.type === 'BURIAL_SOCIETY' ? '🛡️' : '⛪'} ${r.name}`).join('\n') +
                                     `\n\nReply with the number to join.`;
                             session.step = 'JOIN_SELECT';
                             await sendWhatsApp(cleanPhone, reply);
                         } else {
                             session.step = 'SEARCH';
                             await sendWhatsApp(cleanPhone, "👋 Welcome to Seabe Pay! Please reply with the name of your organization (e.g. 'AFM'):");
                         }
                    } else if (session.step === 'JOIN_SELECT') {
                        const index = parseInt(incomingMsg) - 1;
                        const org = session.searchResults ? session.searchResults[index] : null;

                        if (org) {
                             const updateData = {};
                             let reply = "";
                             
                             if (org.type === 'BURIAL_SOCIETY') {
                                 updateData.societyCode = org.code;
                                 reply = `✅ Linked to Society: *${org.name}*\n\nReply *Society* to access your policy menu.`;
                             } else {
                                 updateData.churchCode = org.code;
                                 reply = `✅ Linked to Church: *${org.name}*\n\nReply *Hi* to see the main menu.`;
                             }

                             await prisma.member.upsert({
                                 where: { phone: cleanPhone },
                                 update: updateData,
                                 create: { phone: cleanPhone, firstName: 'Member', lastName: 'New', ...updateData }
                             });
                             
                             delete userSession[cleanPhone]; 
                             await sendWhatsApp(cleanPhone, reply);
                        } else {
                            session.step = 'SEARCH';
                            await sendWhatsApp(cleanPhone, "⚠️ Invalid selection. Try searching again.");
                        }
                    }
                } else {
                    // ✅ FIXED: Using sendWhatsApp
                    await sendWhatsApp(cleanPhone, "👋 Welcome! It looks like you aren't registered yet. Please reply with *Join* to find your organization.");
                }
                return;
            }

            // 1. Handle Global "Cancel" or "Reset"
            if (incomingMsg === 'exit' || incomingMsg === 'cancel') {
                delete userSession[cleanPhone];
                // ✅ FIXED: Using sendWhatsApp
                await sendWhatsApp(cleanPhone, "🔄 Session cleared. Reply *Hi* to see the main menu.");
                return;
            }

            // 2. Handle Burial Society Flows
            if (session.flow === 'SOCIETY_PAYMENT' || incomingMsg === 'society') {
                if (member.societyCode) {
                    session.mode = 'SOCIETY';
                    return handleSocietyMessage(cleanPhone, incomingMsg, session, member);
                } else {
                    // ✅ FIXED: Using sendWhatsApp
                    await sendWhatsApp(cleanPhone, "⚠️ You are not linked to a Burial Society. Reply *Join* to search for one.");
                    return;
                }
            }

            // 3. Handle Church / Payment Flows 
            // ✅ FIXED: Added all your church triggers so they route correctly!
            const churchTriggers = ['amen', 'hi', 'menu', 'hello', 'npo', 'donate', 'help', 'pay'];
            
            if (churchTriggers.includes(incomingMsg) || session.mode === 'CHURCH' || session.flow === 'CHURCH_PAYMENT') {
                if (member.churchCode) {
                    session.mode = 'CHURCH';
                    return handleChurchMessage(cleanPhone, incomingMsg, session, member);
                }
            }

            // ================================================
            // 🤖 FALLBACK: AI CATCH-ALL
            // ================================================
            console.log(`🤖 AI Support Triggered for: ${incomingMsg}`);
            try {
                const aiResponse = await getAISupportReply(incomingMsg, cleanPhone, member?.firstName);
                // ✅ FIXED: Using sendWhatsApp instead of paymentBot
                await sendWhatsApp(cleanPhone, aiResponse);
            } catch (error) {
                console.error("AI Fallback Error:", error);
                await sendWhatsApp(cleanPhone, "🤔 I didn't quite catch that. Reply *Menu* to see available options.");
            }

        } catch (e) {
            console.error("Router Error:", e);
        }
    })();
});

module.exports = router;