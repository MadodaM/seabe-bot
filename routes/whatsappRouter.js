// routes/whatsappRouter.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const sgMail = require('@sendgrid/mail'); 
const axios = require('axios');

// Bot & AI Imports
const { getAISupportReply } = require('../services/aiSupport');
const { handleSocietyMessage } = require('../bots/societyBot');
const { handleChurchMessage } = require('../bots/churchBot');
const { processTwilioClaim } = require('../services/aiClaimWorker');

// Safely initialize Twilio for background messaging
let twilioClient;
if (process.env.TWILIO_SID && process.env.TWILIO_AUTH) {
    twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
}

const sendWhatsApp = async (to, body) => {
    if (!twilioClient) return console.log("⚠️ Twilio Keys Missing! Could not send message.");
    const cleanTwilioNumber = process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '');
    try {
        await twilioClient.messages.create({
            from: `whatsapp:${cleanTwilioNumber}`, 
            to: `whatsapp:${to}`,
            body: body
        });
        console.log(`✅ Text delivered to ${to}`);
    } catch (err) {
        console.error("❌ Twilio Send Error:", err.message);
    }
};

let userSession = {}; 

router.post('/', (req, res) => {
    const incomingMsg = (req.body.Body || '').trim().toLowerCase();
    const cleanPhone = (req.body.From || '').replace('whatsapp:', '');

    // 1. Respond to Twilio IMMEDIATELY (Prevents 15s timeout)
    res.type('text/xml').send('<Response></Response>');

    // 2. Handle all logic safely in the background
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
            // 🛠️ ADMIN TRIGGER: SECURE EMAIL REPORT
            // ================================================
            if (incomingMsg.startsWith('report ')) {
                const targetCode = incomingMsg.split(' ')[1]?.toUpperCase();

                if (!targetCode) {
                    await sendWhatsApp(cleanPhone, "⚠️ Please specify a code. Example: *Report AFM*");
                } else {
                    const org = await prisma.church.findUnique({
                        where: { code: targetCode },
                        include: { 
                            transactions: {
                                where: { status: 'SUCCESS' },
                                orderBy: { date: 'desc' },
                                take: 100
                            }
                        }
                    });

                    if (!org) {
                        await sendWhatsApp(cleanPhone, `🚫 Organization *${targetCode}* not found.`);
                    } else if (org.transactions.length === 0) {
                        await sendWhatsApp(cleanPhone, `📉 No transactions found for *${org.name}*.`);
                    } else if (!org.email) {
                        await sendWhatsApp(cleanPhone, `⚠️ *${org.name}* has no email address configured.`);
                    } else {
                        let csvContent = "Date,Phone,Type,Amount,Reference\n";
                        let total = 0;

                        org.transactions.forEach(t => {
                            const date = t.date.toISOString().split('T')[0];
                            const amount = t.amount.toFixed(2);
                            csvContent += `${date},${t.phone},${t.type},${amount},${t.reference}\n`;
                            total += t.amount;
                        });
                        csvContent += `\nTOTAL,,,${total.toFixed(2)},`;

                        const msg = {
                            to: org.email,
                            from: process.env.EMAIL_FROM || 'admin@seabe.io',
                            subject: `📊 Monthly Report: ${org.name}`,
                            text: `Attached is the latest transaction report for ${org.name}.\n\nTotal Processed: R${total.toFixed(2)}`,
                            attachments: [{
                                content: Buffer.from(csvContent).toString('base64'),
                                filename: `Report_${targetCode}.csv`,
                                type: 'text/csv',
                                disposition: 'attachment'
                            }]
                        };

                        try {
                            await sgMail.send(msg);
                            await sendWhatsApp(cleanPhone, `✅ Report for *${org.name}* has been emailed to *${org.email}*.`);
                        } catch (error) {
                            console.error("Email Error:", error);
                            await sendWhatsApp(cleanPhone, "⚠️ Error sending email.");
                        }
                    }
                }
                return; 
            }

            // ================================================
            // 🖼️ MULTIMEDIA HANDLER (AI CLAIM OCR)
            // ================================================
            if (numMedia > 0 && session.step === 'AWAITING_CLAIM_DOCUMENT') {
                const imageUrl = req.body.MediaUrl0;
                const orgCode = member?.societyCode || member?.churchCode;
                processTwilioClaim(cleanPhone, imageUrl, orgCode);
                await sendWhatsApp(cleanPhone, "⏳ *Document Received!*\n\nOur Gemini AI is now processing the claim. I will message you once the scan is complete.");
                return;
            }

            // ================================================
            // 🛠️ ADMIN TRIGGER: MANUAL VERIFY (PAYSTACK)
            // ================================================
            if (incomingMsg.startsWith('verify ')) {
                const reference = incomingMsg.split(' ')[1];
                if (!reference) {
                    await sendWhatsApp(cleanPhone, "⚠️ Please specify a reference.");
                } else {
                    try {
                        const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
                            headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
                        });
                        if (response.data.data.status === 'success') {
                            await prisma.transaction.update({ where: { reference }, data: { status: 'SUCCESS' } });
                            await sendWhatsApp(cleanPhone, `✅ Verified! Status updated to *SUCCESS*.`);
                        } else {
                            await sendWhatsApp(cleanPhone, `❌ Payment is still: *${response.data.data.status}*.`);
                        }
                    } catch (error) {
                        await sendWhatsApp(cleanPhone, "⚠️ Could not verify reference.");
                    }
                }
                return;
            }

            // ================================================
            // 🚦 USER ROUTING LOGIC
            // ================================================
            if (!member) {
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
                             await sendWhatsApp(cleanPhone, "👋 Welcome! Please reply with the name of your organization:");
                         }
                    } else if (session.step === 'JOIN_SELECT') {
                        const index = parseInt(incomingMsg) - 1;
                        const org = session.searchResults ? session.searchResults[index] : null;
                        if (org) {
                             const updateData = org.type === 'BURIAL_SOCIETY' ? { societyCode: org.code } : { churchCode: org.code };
                             await prisma.member.upsert({
                                 where: { phone: cleanPhone },
                                 update: updateData,
                                 create: { phone: cleanPhone, firstName: 'Member', lastName: 'New', ...updateData }
                             });
                             delete userSession[cleanPhone]; 
                             await sendWhatsApp(cleanPhone, `✅ Successfully linked to *${org.name}*!`);
                        }
                    }
                } else {
                    await sendWhatsApp(cleanPhone, "👋 Welcome! Please reply with *Join* to find your organization.");
                }
                return;
            }

            if (incomingMsg === 'exit' || incomingMsg === 'cancel') {
                delete userSession[cleanPhone];
                await sendWhatsApp(cleanPhone, "🔄 Session cleared.");
                return;
            }

            // Route to Society
            if (incomingMsg === 'society' || session.mode === 'SOCIETY') {
                if (member.societyCode) {
                    session.mode = 'SOCIETY';
                    await handleSocietyMessage(cleanPhone, incomingMsg, session, member);
                    return;
                }
            }

            // Route to Church
            const churchTriggers = ['amen', 'hi', 'menu', 'hello', 'pay'];
            if (churchTriggers.includes(incomingMsg) || session.mode === 'CHURCH') {
                if (member.churchCode) {
                    session.mode = 'CHURCH';
                    await handleChurchMessage(cleanPhone, incomingMsg, session, member);
                    return;
                }
            }

            // AI Fallback
            const aiResponse = await getAISupportReply(incomingMsg, cleanPhone, member?.firstName);
            await sendWhatsApp(cleanPhone, aiResponse);

        } catch (e) {
            console.error("❌ ROUTER CRASH:", e);
        }
    })();
});

module.exports = router;