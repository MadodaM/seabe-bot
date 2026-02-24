// routes/whatsappRouter.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const sgMail = require('@sendgrid/mail'); 
const axios = require('axios');

// Bot & AI Imports
const { getAISupportReply } = require('../services/aiSupport');
const { handleSocietyMessage } = require('../societyBot');
const { handleChurchMessage } = require('../churchBot');

// Safely initialize Twilio for background messaging
let twilioClient;
if (process.env.TWILIO_SID && process.env.TWILIO_AUTH) {
    twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
}

const sendWhatsApp = async (to, body) => {
    if (!twilioClient) return console.log("⚠️ Twilio not configured. Could not send:", body);
    try {
        await twilioClient.messages.create({
            from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
            to: `whatsapp:${to}`,
            body: body
        });
    } catch (err) {
        console.error("Twilio Send Error:", err.message);
    }
};

let userSession = {}; 

router.post('/', (req, res) => {
    const incomingMsg = (req.body.Body || '').trim().toLowerCase();
    const cleanPhone = (req.body.From || '').replace('whatsapp:', '');

    // 1. Respond to Twilio IMMEDIATELY to prevent the 15s timeout
    res.type('text/xml').send('<Response></Response>');

    // 2. Handle all logic safely in the background
    (async () => {
        try {
            if (!userSession[cleanPhone]) userSession[cleanPhone] = {};
            const session = userSession[cleanPhone];

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
                                filename: `Report_${targetCode}_${new Date().toISOString().split('T')[0]}.csv`,
                                type: 'text/csv',
                                disposition: 'attachment'
                            }]
                        };

                        try {
                            await sgMail.send(msg);
                            await sendWhatsApp(cleanPhone, `✅ Report for *${org.name}* has been emailed to *${org.email}*.`);
                        } catch (error) {
                            console.error("Email Error:", error);
                            await sendWhatsApp(cleanPhone, "⚠️ Error sending email. Please check server logs.");
                        }
                    }
                }
                return; 
            }

            // ================================================
            // 🛠️ ADMIN TRIGGER: MANUAL VERIFY (PAYSTACK)
            // ================================================
            if (incomingMsg.startsWith('verify ')) {
                const reference = incomingMsg.split(' ')[1];

                if (!reference) {
                    await sendWhatsApp(cleanPhone, "⚠️ Please specify a reference. Example: *Verify REF-123*");
                } else {
                    try {
                        const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
                            headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
                        });

                        const status = response.data.data.status;
                        const amount = response.data.data.amount / 100;

                        if (status === 'success') {
                            await prisma.transaction.update({
                                where: { reference: reference },
                                data: { status: 'SUCCESS' }
                            });
                            await sendWhatsApp(cleanPhone, `✅ **Verified!**\nReference: ${reference}\nAmount: R${amount}\nStatus updated to *SUCCESS*.`);
                        } else {
                            await sendWhatsApp(cleanPhone, `❌ **Payment Failed.**\nPaystack says this transaction is still: *${status}*.`);
                        }
                    } catch (error) {
                        console.error("Verify Error:", error);
                        await sendWhatsApp(cleanPhone, "⚠️ Could not verify. Check the reference number.");
                    }
                }
                return;
            }

// ================================================
            // 🚦 USER ROUTING LOGIC & MENUS
            // ================================================
            console.log(`🧭 ROUTER: Processing message "${incomingMsg}" from ${cleanPhone}`);

            if (!member) {
                console.log("🧭 ROUTER: User not found in DB. Starting Onboarding.");
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
                    await sendWhatsApp(cleanPhone, "👋 Welcome! It looks like you aren't registered yet. Please reply with *Join* to find your organization.");
                }
                return;
            }

            console.log("🧭 ROUTER: User identified as", member.firstName);

            // 1. Handle Global "Cancel" or "Reset"
            if (incomingMsg === 'exit' || incomingMsg === 'cancel') {
                delete userSession[cleanPhone];
                await sendWhatsApp(cleanPhone, "🔄 Session cleared. Reply *Hi* to see the main menu.");
                return;
            }

            // 2. Handle Burial Society Flows
            if (session.flow === 'SOCIETY_PAYMENT' || incomingMsg === 'society') {
                if (member.societyCode) {
                    session.mode = 'SOCIETY';
                    console.log("🚀 ROUTER: Handing off to Society Bot!");
                    await handleSocietyMessage(cleanPhone, incomingMsg, session, member); // ✅ Added Await
                    return;
                } else {
                    await sendWhatsApp(cleanPhone, "⚠️ You are not linked to a Burial Society. Reply *Join* to search for one.");
                    return;
                }
            }

            // 3. Handle Church / Payment Flows
            const churchTriggers = ['amen', 'hi', 'menu', 'hello', 'npo', 'donate', 'help', 'pay'];
            
            if (churchTriggers.includes(incomingMsg) || session.mode === 'CHURCH' || session.flow === 'CHURCH_PAYMENT') {
                if (member.churchCode) {
                    session.mode = 'CHURCH';
                    console.log("🚀 ROUTER: Handing off to Church Bot!");
                    await handleChurchMessage(cleanPhone, incomingMsg, session, member); // ✅ Added Await
                    return;
                } else {
                     console.log("⚠️ ROUTER: User used a church trigger but has NO churchCode in DB.");
                     await sendWhatsApp(cleanPhone, "⚠️ You are not currently linked to a Ministry. Reply *Join* to find yours!");
                     return;
                }
            }

            // ================================================
            // 🤖 FALLBACK: AI CATCH-ALL
            // ================================================
            console.log(`🤖 ROUTER: Message didn't match any menus. Triggering AI Support for: ${incomingMsg}`);
            try {
                const aiResponse = await getAISupportReply(incomingMsg, cleanPhone, member?.firstName);
                console.log(`🤖 AI Responded: ${aiResponse}`);
                await sendWhatsApp(cleanPhone, aiResponse);
            } catch (error) {
                console.error("AI Fallback Error:", error);
                await sendWhatsApp(cleanPhone, "🤔 I didn't quite catch that. Reply *Menu* to see available options.");
            }

        } catch (e) {
            console.error("❌ ROUTER CRASH:", e);
        }
    })();
});

module.exports = router;