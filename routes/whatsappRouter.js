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
                            from: process.env.EMAIL_FROM || 'admin@seabe.tech',
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
            // 🚦 USER ROUTING LOGIC & ONBOARDING
            // ================================================
            
            // 1. Global Reset (Put this first so users can ALWAYS escape a loop)
            if (incomingMsg === 'exit' || incomingMsg === 'cancel') {
                delete userSession[cleanPhone];
                await sendWhatsApp(cleanPhone, "🔄 Session cleared. Reply *Join* to switch organizations, *Hi* for Church, or *Society* for Burial menus.");
                return;
            }

            // 2. The Universal "Join" Flow (UPDATED WITH QUOTING ENGINE)
            const joinSteps = ['SEARCH', 'JOIN_SELECT', 'CHOOSE_MEMBER_TYPE', 'ENTER_POLICY_NUMBER', 'SELECT_QUOTE_PLAN'];
            
            if (incomingMsg === 'join' || joinSteps.includes(session.step)) {
                
                if (incomingMsg === 'join') {
                    session.step = 'SEARCH';
                    await sendWhatsApp(cleanPhone, "🔍 Let's find your organization!\n\nPlease reply with their name (e.g., 'AFM' or 'Kgosigadi'):");
                    return;
                }

                if (session.step === 'SEARCH') {
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
                        await sendWhatsApp(cleanPhone, "⚠️ We couldn't find an organization with that name. Please try another search term:");
                    }
                    return;
                }

                if (session.step === 'JOIN_SELECT') {
                    const index = parseInt(incomingMsg) - 1;
                    const org = session.searchResults ? session.searchResults[index] : null;
                    
                    if (org) {
                        // 🚀 NEW: Intercept the flow if it's a Burial Society
                        if (org.type === 'BURIAL_SOCIETY') {
                            session.churchId = org.id;
                            session.churchCode = org.code;
                            session.step = 'CHOOSE_MEMBER_TYPE';
                            
                            const msg = `Welcome to *${org.name}*!\n\nHow can we help you today?\n\n1️⃣ I am an Existing Member\n2️⃣ I am a New Member (Get a Quote)`;
                            await sendWhatsApp(cleanPhone, msg);
                            return;
                        } else {
                            // OLD logic: If it's a church, link them immediately
                            const updateData = { churchCode: org.code };
                            await prisma.member.upsert({
                                where: { phone: cleanPhone },
                                update: updateData,
                                create: { phone: cleanPhone, firstName: 'Member', lastName: 'New', ...updateData }
                            });
                            
                            delete userSession[cleanPhone]; 
                            await sendWhatsApp(cleanPhone, `✅ Successfully linked to *${org.name}*!\n\nReply *Hi* to access your menu.`);
                            return;
                        }
                    } else {
                        await sendWhatsApp(cleanPhone, "⚠️ Invalid selection. Please reply with a valid number from the list, or type *Exit*.");
                        return;
                    }
                }

                // 🚀 NEW: Handling the New vs Existing Split
                if (session.step === 'CHOOSE_MEMBER_TYPE') {
                    if (incomingMsg === '1') {
                        session.step = 'ENTER_POLICY_NUMBER';
                        await sendWhatsApp(cleanPhone, `Great! Please reply with your exact *ID Number* so we can locate your existing profile.`);
                    } else if (incomingMsg === '2') {
                        // Fetch dynamic plans from the database for the quote
                        const plans = await prisma.policyPlan.findMany({ 
                            where: { churchId: session.churchId } 
                        });

                        if (plans.length === 0) {
                            delete userSession[cleanPhone];
                            await sendWhatsApp(cleanPhone, `We are currently updating our digital plans. Please contact the office directly.\n\nReply *Join* to start over.`);
                        } else {
                            session.step = 'SELECT_QUOTE_PLAN';
                            let planMsg = `*Available Plans:*\n\n`;
                            plans.forEach((p, index) => {
                                planMsg += `${index + 1}️⃣ *${p.planName}* - R${p.monthlyPremium}/pm\n_Covers: ${p.targetGroup}_\n\n`;
                            });
                            planMsg += `Reply with the number of the plan to see full benefits and get your quote.`;
                            await sendWhatsApp(cleanPhone, planMsg);
                        }
                    } else {
                        await sendWhatsApp(cleanPhone, `Invalid option. Please reply 1 or 2.`);
                    }
                    return;
                }

                // 🚀 NEW: The "Existing Member" Lookup
                if (session.step === 'ENTER_POLICY_NUMBER') {
                    // Search the database for this ID number under this specific society
                    const memberMatch = await prisma.member.findFirst({
                        where: {
                            societyCode: session.churchCode,
                            idNumber: incomingMsg 
                        }
                    });

                    if (memberMatch) {
                        // Success! Link this WhatsApp number to the member profile
                        await prisma.member.update({ 
                            where: { id: memberMatch.id }, 
                            data: { phone: cleanPhone } 
                        });
                        
                        delete userSession[cleanPhone];
                        await sendWhatsApp(cleanPhone, `✅ Profile Linked!\n\nWelcome back, ${memberMatch.firstName}.\n\nReply *Society* to access your main menu (View Policy, Payments, Claims).`);
                    } else {
                        await sendWhatsApp(cleanPhone, `❌ We couldn't find a policy matching "${incomingMsg}". Please check your ID number and try again, or type *Exit* to restart.`);
                    }
                    return;
                }

                // 🚀 NEW: The "New Member" Dynamic Quoter
                // 🚀 NEW: The "New Member" Dynamic Quoter
                if (session.step === 'SELECT_QUOTE_PLAN') {
                    const plans = await prisma.policyPlan.findMany({ 
                        where: { churchId: session.churchId } 
                    });
                    
                    const selectedIndex = parseInt(incomingMsg) - 1;

                    if (selectedIndex >= 0 && selectedIndex < plans.length) {
                        const plan = plans[selectedIndex];
                        
                        // Generate the link with the user's phone and bot number included
                        const host = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
                        const botNum = process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '');
                        const quoteLink = `${host}/quote.html?code=${session.churchCode}&phone=${cleanPhone}&bot=${botNum}`;

                        const msg = `*Quote: ${plan.planName}*\nBase Premium: *R${plan.monthlyPremium} / month*\n\n*Benefits Included:*\n${plan.benefitsSummary}\n\nTo add extended family (children/adults) and complete your registration, click your secure link below:\n👉 ${quoteLink}\n\nReply *Exit* to return to the start.`;
                        
                        delete userSession[cleanPhone]; // Reset state after quoting
                        await sendWhatsApp(cleanPhone, msg);
                    } else {
                        await sendWhatsApp(cleanPhone, `Invalid selection. Please reply with a valid plan number.`);
                    }
                    return;
                }
            }
			
			// 🚀 NEW: Catch Quote Acceptance
                if (incomingMsg.includes('accept the quote')) {
                    session.step = 'AWAITING_MEMBER_ID';
                    await sendWhatsApp(cleanPhone, "🎉 Fantastic! Your quote has been accepted.\n\nTo finalize your policy registration, we must complete a quick KYC compliance check.\n\nPlease reply directly to this message with a clear photo of your *ID Document* (Green Book or Smart ID).");
                    return;
                }

                // 🚀 NEW: Catch KYC ID Upload
                if (numMedia > 0 && session.step === 'AWAITING_MEMBER_ID') {
                    const idUrl = req.body.MediaUrl0; // Twilio Media URL
                    
                    // Save the ID photo to the member's profile
                    await prisma.member.update({
                        where: { phone: cleanPhone },
                        data: { idPhotoUrl: idUrl, status: 'PENDING_KYC' }
                    });

                    session.step = 'AWAITING_MEMBER_ADDRESS';
                    await sendWhatsApp(cleanPhone, "✅ ID Document received safely.\n\nFinally, please reply with a photo of your *Proof of Address* (e.g., a utility bill or bank statement not older than 3 months).");
                    return;
                }

                // 🚀 NEW: Catch KYC Proof of Address Upload
                if (numMedia > 0 && session.step === 'AWAITING_MEMBER_ADDRESS') {
                    const addressUrl = req.body.MediaUrl0;
                    
                    // Save the address photo and flag for Admin Review
                    await prisma.member.update({
                        where: { phone: cleanPhone },
                        data: { proofOfAddressUrl: addressUrl }
                    });

                    delete userSession[cleanPhone]; // Done onboarding
                    await sendWhatsApp(cleanPhone, "✅ Proof of Address received.\n\n🎉 *Registration Complete!*\nYour documents have been securely vaulted for Admin Review. You will be notified once your policy is fully activated.\n\nReply *Hi* anytime to view your policy details.");
                    return;
                }

            // 3. Catch completely unregistered users
            if (!member) {
                await sendWhatsApp(cleanPhone, "👋 Welcome to Seabe Pay! Please reply with *Join* to find your organization.");
                return;
            }

            // 4. Catch "Orphaned" users (In DB, but no code attached)
            if (!member.churchCode && !member.societyCode) {
                await sendWhatsApp(cleanPhone, "⚠️ You are not currently linked to any organization. Please reply *Join* to search for yours.");
                return;
            }

            // 5. Route to Society
            if (incomingMsg === 'society' || session.mode === 'SOCIETY') {
                if (member.societyCode) {
                    session.mode = 'SOCIETY';
                    await handleSocietyMessage(cleanPhone, incomingMsg, session, member);
                    return;
                } else {
                    await sendWhatsApp(cleanPhone, "⚠️ You are not linked to a Burial Society. Reply *Join* to find one.");
                    return;
                }
            }

            // 6. Route to Church
            const churchTriggers = ['amen', 'hi', 'menu', 'hello', 'pay'];
            if (churchTriggers.includes(incomingMsg) || session.mode === 'CHURCH') {
                if (member.churchCode) {
                    session.mode = 'CHURCH';
                    await handleChurchMessage(cleanPhone, incomingMsg, session, member);
                    return;
                } else {
                    await sendWhatsApp(cleanPhone, "⚠️ You are not linked to a Church. Reply *Join* to find one.");
                    return;
                }
            }

            // ================================================
            // 🤖 FALLBACK: AI CATCH-ALL
            // ================================================
            const aiResponse = await getAISupportReply(incomingMsg, cleanPhone, member?.firstName);
            await sendWhatsApp(cleanPhone, aiResponse);

        } catch (e) {
            console.error("❌ ROUTER CRASH:", e);
        }
    })();
});

module.exports = router;