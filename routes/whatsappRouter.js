// routes/whatsappRouter.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const axios = require('axios');
const sgMail = require('@sendgrid/mail'); 
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 🛠️ Modular Imports
const { sendWhatsApp } = require('../services/twilioClient');
const { evaluateQuiz } = require('../services/aiQuizEvaluator');
const { getAISupportReply } = require('../services/aiSupport');
const { handleSocietyMessage } = require('../bots/societyBot');
const { handleChurchMessage } = require('../bots/churchBot');
const { processTwilioClaim } = require('../services/aiClaimWorker');

let userSession = {}; 

router.post('/', (req, res) => {
    const incomingMsg = (req.body.Body || '').trim().toLowerCase();
    const cleanPhone = (req.body.From || '').replace('whatsapp:', '');

    // 1. Respond to Twilio IMMEDIATELY
    res.type('text/xml').send('<Response></Response>');

    (async () => {
        try {
            if (!userSession[cleanPhone]) userSession[cleanPhone] = {};
            const session = userSession[cleanPhone];
            const numMedia = parseInt(req.body.NumMedia || '0'); 

            const member = await prisma.member.findUnique({
                where: { phone: cleanPhone },
                include: { church: true, society: true }
            });

            // ================================================
            // 🎓 LMS: AI QUIZ EVALUATOR
            // ================================================
            if (member) {
                const pendingQuiz = await prisma.enrollment.findFirst({
                    where: { memberId: member.id, quizState: 'AWAITING_QUIZ', status: 'ACTIVE' },
                    include: { course: { include: { modules: true } } }
                });
                if (pendingQuiz) {
                    await evaluateQuiz(incomingMsg, cleanPhone, member, pendingQuiz, sendWhatsApp);
                    return;
                }
            }

            // ================================================
            // 🛠️ ADMIN TRIGGER: SECURE EMAIL REPORT
            // ================================================
            if (incomingMsg.startsWith('report ')) {
                const targetCode = incomingMsg.split(' ')[1]?.toUpperCase();
                if (!targetCode) {
                    await sendWhatsApp(cleanPhone, "⚠️ Please specify a code. Example: *Report AFM*");
                } else {
                    const org = await prisma.church.findUnique({
                        where: { code: targetCode },
                        include: { transactions: { where: { status: 'SUCCESS' }, orderBy: { date: 'desc' }, take: 100 } }
                    });
                    if (!org) {
                        await sendWhatsApp(cleanPhone, `🚫 Organization *${targetCode}* not found.`);
                    } else {
                        let csvContent = "Date,Phone,Type,Amount,Reference\n";
                        let total = 0;
                        org.transactions.forEach(t => {
                            csvContent += `${t.date.toISOString().split('T')[0]},${t.phone},${t.type},${t.amount.toFixed(2)},${t.reference}\n`;
                            total += t.amount;
                        });
                        const msg = {
                            to: org.email,
                            from: process.env.EMAIL_FROM || 'admin@seabe.tech',
                            subject: `📊 Monthly Report: ${org.name}`,
                            text: `Total Processed: R${total.toFixed(2)}`,
                            attachments: [{ content: Buffer.from(csvContent).toString('base64'), filename: `Report_${targetCode}.csv`, type: 'text/csv' }]
                        };
                        await sgMail.send(msg);
                        await sendWhatsApp(cleanPhone, `✅ Report for *${org.name}* sent to *${org.email}*.`);
                    }
                }
                return; 
            }

            // ================================================
            // 🚦 SESSION RESET & JOIN FLOW
            // ================================================
            if (incomingMsg === 'exit' || incomingMsg === 'cancel') {
                delete userSession[cleanPhone];
                await sendWhatsApp(cleanPhone, "🔄 Session cleared. Reply *Join* or *Hi*.");
                return;
            }

            const joinSteps = ['SEARCH', 'JOIN_SELECT', 'CHOOSE_MEMBER_TYPE', 'ENTER_POLICY_NUMBER', 'SELECT_QUOTE_PLAN'];
            if (incomingMsg === 'join' || joinSteps.includes(session.step)) {
                // ... [This is where your searching/quoting logic lives] ...
                // Re-insert your SEARCH and JOIN_SELECT code here if it was overwritten
                return;
            }

            // ================================================
            // 🖼️ MULTIMEDIA (CLAIMS)
            // ================================================
            if (numMedia > 0 && session.step === 'AWAITING_CLAIM_DOCUMENT') {
                processTwilioClaim(cleanPhone, req.body.MediaUrl0, member?.societyCode || member?.churchCode);
                await sendWhatsApp(cleanPhone, "⏳ *Document Received!* AI Processing...");
                return;
            }

            // ================================================
            // 🏛️ BRANCH ROUTING (CHURCH vs SOCIETY)
            // ================================================
            if (incomingMsg === 'society' || session.mode === 'SOCIETY') {
                session.mode = 'SOCIETY';
                await handleSocietyMessage(cleanPhone, incomingMsg, session, member);
                return;
            }

            const churchTriggers = ['hi', 'menu', 'hello', 'pay', 'amen'];
            if (churchTriggers.includes(incomingMsg) || session.mode === 'CHURCH') {
                session.mode = 'CHURCH';
                await handleChurchMessage(cleanPhone, incomingMsg, session, member);
                return;
            }

            // ================================================
            // 🤖 AI FALLBACK
            // ================================================
            const aiResponse = await getAISupportReply(incomingMsg, cleanPhone, member?.firstName);
            await sendWhatsApp(cleanPhone, aiResponse);

        } catch (e) {
            console.error("❌ ROUTER CRASH:", e);
        }
    })();
});

module.exports = router;