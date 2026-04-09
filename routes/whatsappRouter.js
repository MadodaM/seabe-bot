// routes/whatsappRouter.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { Resend } = require('resend');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 🛠️ Modular Imports
const { sendWhatsApp } = require('../services/twilioClient');
const { getAISupportReply } = require('../services/aiSupport');
const { handleSocietyMessage } = require('../bots/societyBot');
const { handleChurchMessage } = require('../bots/churchBot');
const { handleNPOMessage } = require('../bots/NPOCbot'); 
const { handleStokvelMessage } = require('../bots/stokvelBot');
const { processGroomingMessage } = require('../bots/groomingBot');
const { processLmsMessage } = require('../bots/LMSlogicBot'); 
const adminBot = require('../bots/adminBot');
const vendorBot = require('../bots/vendorBot');
const { t } = require('../utils/i18n');
const { processBookingMessage } = require('../bots/bookingBot');
const { processBarcodeScan } = require('../bots/scannerBot');
const { generateStatement } = require('../services/pdfGenerator');
const { handleServiceProviderMessage, processProviderTrigger } = require('../bots/serviceProviderBot');
const { handleSupportOrTypo } = require('../services/supportEngine');
const { processTwilioClaim } = require('../services/aiClaimWorker');
const { calculateTransaction } = require('../services/pricingEngine');
const resend = new Resend(process.env.RESEND_API_KEY);

router.post('/', (req, res) => {
    const rawMsg = req.body.Body || '';
    const incomingMsg = rawMsg.trim().toLowerCase();
    const cleanPhone = (req.body.From || '').replace('whatsapp:', '');
    
    // Extract and split the WhatsApp Profile Name
    const profileName = req.body.ProfileName || '';
    let fName = 'Member';
    let lName = '.'; // Fallback

    if (profileName && profileName.trim() !== '') {
        const nameParts = profileName.trim().split(' ');
        fName = nameParts[0];
        lName = nameParts.slice(1).join(' ') || '.';
    }

    // 1. Respond to Twilio IMMEDIATELY
    res.type('text/xml').send('<Response></Response>');

    (async () => {
        let session = {};
        let clearSessionFlag = false; 

        try {
            // ================================================
            // 🧠 LOAD SESSION FROM DATABASE & CHECK TTL
            // ================================================
            const dbSession = await prisma.botSession.findUnique({ where: { phone: cleanPhone } });
            
            // 1. Define the Time-To-Live (24 Hours in milliseconds)
            const SESSION_TTL = 24 * 60 * 60 * 1000; 

            if (dbSession) {
                const lastUpdate = new Date(dbSession.updatedAt).getTime();
                const now = Date.now();

                // 2. Check if the session has expired (older than 24h)
                if (now - lastUpdate > SESSION_TTL) {
                    console.log(`🧹 [SESSION] Expired session wiped for ${cleanPhone}.`);
                    session = {}; // Start fresh
                    clearSessionFlag = true; // Tell the DB to wipe it at the end of the route
                } else {
                    // Session is valid, load it
                    session = { step: dbSession.step, mode: dbSession.mode, ...(dbSession.data || {}) };
                }
            }

            const numMedia = parseInt(req.body.NumMedia || '0'); 
            
            // ================================================
            // 🔄 MULTI-TENANT CONTEXT SWITCHER
            // ================================================
            const switchKeywords = { 'society': 'BURIAL_SOCIETY', 'amen': 'CHURCH', 'npo': 'NON_PROFIT', 'stokvel': 'STOKVEL_SAVINGS' };
            let explicitType = switchKeywords[incomingMsg];
            let member;

            if (explicitType) {
                member = await prisma.member.findFirst({
                    where: { phone: cleanPhone, church: { type: explicitType } },
                    orderBy: { id: 'desc' },
                    include: { church: true, society: true }
                });

                if (member) {
                    // 🚀 FIXED: Wipe the Barber's identity and force the new Organization's identity
                    session.churchCode = member.churchCode;
                    session.orgCode = member.churchCode;
                    session.orgName = member.church?.name;
                    
                    if (explicitType === 'BURIAL_SOCIETY') session.mode = 'SOCIETY';
                    else if (explicitType === 'STOKVEL_SAVINGS') session.mode = 'STOKVEL';
                    else if (explicitType === 'NON_PROFIT') session.mode = 'NPO';
                    else session.mode = 'CHURCH';
                    
                    session.step = null; 
					} else {
						// 🔒 If they don't belong to a church, block them and ask them to Join
						const labels = { 'BURIAL_SOCIETY': 'Burial Society', 'CHURCH': 'Church', 'NON_PROFIT': 'Non-Profit', 'STOKVEL_SAVINGS': 'Stokvel / Savings Club' };
						await sendWhatsApp(cleanPhone, `⚠️ You are not currently linked to a ${labels[explicitType]}.\n\nReply *Join* to search for one.`);
						return;
                }
            } else {
                const activeOrgCode = session.churchCode || session.orgCode;
                if (activeOrgCode) {
                    member = await prisma.member.findFirst({
                        where: { phone: cleanPhone, churchCode: activeOrgCode },
                        include: { church: true, society: true }
                    });
                }
                if (!member) {
                    member = await prisma.member.findFirst({
                        where: { phone: cleanPhone },
                        orderBy: { id: 'desc' },
                        include: { church: true, society: true }
                    });
                    if (member) session.churchCode = member.churchCode;
                }
            }
            
            // Upgrade default names silently
            if (member && (member.firstName === 'Member' || member.firstName === 'Pending')) {
                if (fName !== 'Member') { 
                    member = await prisma.member.update({
                        where: { id: member.id },
                        data: { firstName: fName, lastName: lName },
                        include: { church: true, society: true }
                    });
                }
            }
			
			// --- NEW: TOUCH LAST INTERACTION ---
            if (member) {
                // Background update so it doesn't slow down the bot response
                prisma.member.update({
                    where: { id: member.id },
                    data: { lastInteractionAt: new Date(), engagementScore: 100 }
                }).catch(err => console.error("Failed to touch interaction date:", err));
            }
			
			// --- 1. ADMIN OVERRIDE CHECK ---
			if (incomingMsg.startsWith('admin')) {
				const handledByAdmin = await adminBot.process(incomingMsg, cleanPhone, member, sendWhatsApp, session);
				if (handledByAdmin) return; // FIX: Just return to exit the function
			}

			// 2. Check if it's a Vendor Submitting a Quote
			const handledByVendor = await vendorBot.process(incomingMsg, cleanPhone, sendWhatsApp);
			if (handledByVendor) return; // FIX: Just return to exit the function

			// ================================================
            // 📄 UNIVERSAL MEMBER STATEMENT GENERATOR
            // ================================================
            if (incomingMsg === 'statement') {
                if (!member || !member.churchId) {
                    await sendWhatsApp(cleanPhone, "⚠️ We couldn't find an active profile for you. Reply *Join* to get started.");
                    return;
                }

                await sendWhatsApp(cleanPhone, "⏳ *Generating Statement...*\nGathering your payment history. This will take a few seconds.");

                try {
                    // Fetch last 12 months of successful transactions
                    const transactions = await prisma.transaction.findMany({
                        where: { 
                            phone: cleanPhone, 
                            churchId: member.churchId,
                            status: 'SUCCESS'
                        },
                        orderBy: { date: 'desc' },
                        take: 50 // Limit to last 50 to keep the PDF clean
                    });

                    // Generate the PDF
                    const pdfUrl = await generateStatement(member, transactions, member.church);

                    // Send the PDF via Twilio
                    // Note: Ensure your sendWhatsApp function accepts a mediaUrl as the third parameter!
                    await sendWhatsApp(cleanPhone, `✅ *Statement Ready*\n\nHere is your official payment history for *${member.church.name}*.`, pdfUrl);

                } catch (err) {
                    console.error("Statement Generation Error:", err);
                    await sendWhatsApp(cleanPhone, "❌ Sorry, we encountered an error while generating your statement. Please try again later.");
                }
                return;
            }

            // ================================================
            // 🚦 GLOBAL RESET & COURSE SNOOZE
            // ================================================
            const exitKeywords = ['exit', 'cancel', 'home', 'lobby'];
            if (exitKeywords.includes(incomingMsg)) {
                clearSessionFlag = true; 
                
                if (member) {
                    await prisma.enrollment.updateMany({
                        where: { memberId: member.id, quizState: { in: ['AWAITING_QUIZ', 'AWAITING_ANSWER'] } },
                        data: { quizState: 'IDLE', updatedAt: new Date() } 
                    });
                }
                
                let resetMsg = "🔄 Session cleared & courses paused.\n\nReply *Join* to switch organizations.";
                if (member && member.church) {
                    if (member.church.type === 'BURIAL_SOCIETY') resetMsg += "\nReply *Society* for your main menu.";
                    else if (member.church.type === 'CHURCH') resetMsg += "\nReply *Amen* for your church menu, or *Courses* to learn.";
                    else if (member.church.type === 'NON_PROFIT') resetMsg += "\nReply *NPO* for your dashboard, or *Courses* for our learning center.";
                    else if (member.church.type === 'SERVICE_PROVIDER' || member.church.type === 'PERSONAL_CARE') resetMsg += "\nReply *Menu* to access your service dashboard.";
                    else resetMsg += "\nReply *Menu* for your dashboard.";
                } else {
                    resetMsg += "\nReply *Menu* to access your dashboard.";
                }
                
                await sendWhatsApp(cleanPhone, resetMsg);
                return;
            }
			
			// ================================================
            // 🌐 MULTI-LANGUAGE TOGGLE INTERCEPTOR
            // ================================================
            const langKeywords = ['language', 'ulimi', 'puo'];
            
            if (langKeywords.includes(incomingMsg) || session.step === 'AWAITING_LANGUAGE') {
                if (!member) {
                    await sendWhatsApp(cleanPhone, "⚠️ Please reply *Join* first to register your profile.");
                    return;
                }

                if (langKeywords.includes(incomingMsg)) {
                    session.step = 'AWAITING_LANGUAGE';
                    await sendWhatsApp(cleanPhone, "🌐 Choose your language / Khetha ulimi lwakho / Khetha puo ea hau:\n\n1️⃣ English\n2️⃣ isiZulu\n3️⃣ Sesotho");
                    return;
                }

                if (session.step === 'AWAITING_LANGUAGE') {
                    let newLang = 'en';
                    if (incomingMsg === '1' || incomingMsg === 'english') newLang = 'en';
                    else if (incomingMsg === '2' || incomingMsg === 'zulu' || incomingMsg === 'isizulu') newLang = 'zu';
                    else if (incomingMsg === '3' || incomingMsg === 'sotho' || incomingMsg === 'sesotho') newLang = 'st';
                    else {
                        await sendWhatsApp(cleanPhone, "⚠️ Invalid choice. Reply 1, 2, or 3.");
                        return;
                    }

                    // Save to Database
                    await prisma.member.update({ where: { id: member.id }, data: { language: newLang } });
                    member.language = newLang; // Update local object for the rest of the flow
                    clearSessionFlag = true;

                    // Confirm and redirect
                    const confirmMsg = t('lang_changed', newLang);
                    const promptMsg = member.church.type === 'BURIAL_SOCIETY' ? '\n\nReply *Society* for your menu.' : '\n\nReply *Menu* to continue.';
                    
                    await sendWhatsApp(cleanPhone, confirmMsg + promptMsg);
                    return;
                }
            }

            // ================================================
            // ✂️ PERSONAL CARE / GROOMING INTERCEPTOR
            // ================================================
            const handledByGrooming = await processGroomingMessage(incomingMsg, cleanPhone, session, sendWhatsApp);
            if (handledByGrooming) {
                session = {}; 
                return; 
            }

            // ================================================
            // 🛠️ SERVICE PROVIDER INTERCEPTOR
            // ================================================
            const handledByProvider = await processProviderTrigger(incomingMsg, cleanPhone, session, sendWhatsApp);
            if (handledByProvider) {
                session = {}; 
                return; 
            }

            // ================================================
            // 🎓 LMS / ACADEMY ROUTER
            // ================================================
            const lmsResult = await processLmsMessage(cleanPhone, incomingMsg, session, member) || {};
            
            if (lmsResult.handled) {
                if (lmsResult.clearSessionFlag) clearSessionFlag = true;
                return; 
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
                            from: process.env.EMAIL_FROM || 'info@seabe.tech',
                            subject: `📊 Monthly Report: ${org.name}`,
                            text: `Attached is the latest transaction report for ${org.name}.\n\nTotal Processed: R${total.toFixed(2)}`,
                            attachments: [{
                                content: Buffer.from(csvContent).toString('base64'),
                                filename: `Report_${targetCode}.csv`,
                                type: 'text/csv',
                                disposition: 'attachment'
                            }]
                        };

                        // --- SEND VIA RESEND ---
                        try {
                            await resend.emails.send({
                                to: org.email, // ⚠️ Must be your verified Resend email on the free tier
                                from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
                                subject: `📊 Monthly Report: ${org.name}`,
                                text: `Attached is the latest transaction report for ${org.name}.\n\nTotal Processed: R${total.toFixed(2)}`,
                                attachments: [{
                                    content: Buffer.from(csvContent).toString('base64'),
                                    filename: `Report_${targetCode}.csv`
                                    // Resend doesn't need 'type' or 'disposition'
                                }]
                            });
                            
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
            // 📅 FACILITIES & VENUE BOOKING INTERCEPTOR
            // ================================================
            const bookingResult = await processBookingMessage(incomingMsg, cleanPhone, session, member, sendWhatsApp);
            if (bookingResult.handled) {
                if (bookingResult.clearSessionFlag) clearSessionFlag = true;
                return;
            }

            // ================================================
            // 🔍 UNIVERSAL JOIN & QUOTE FLOW (Smart Search)
            // ================================================
            const joinSteps = ['SEARCH', 'JOIN_SELECT', 'CHOOSE_MEMBER_TYPE', 'ENTER_POLICY_NUMBER', 'SELECT_QUOTE_PLAN', 'AWAITING_QUOTE_ACCEPTANCE'];
            
            // 🚀 SMART SEARCH: "Join [Name]" or "Search [Name]"
            if (incomingMsg.startsWith('join ') || incomingMsg.startsWith('search ')) {
                const searchTerm = incomingMsg.substring(incomingMsg.indexOf(' ') + 1).trim();
                
                let org = await prisma.church.findUnique({ where: { code: searchTerm.toUpperCase() } });
                
                if (!org) {
                    const results = await prisma.church.findMany({
                        where: { name: { contains: searchTerm, mode: 'insensitive' } },
                        take: 5
                    });

                    if (results.length === 1) {
                        org = results[0]; 
                    } else if (results.length > 1) {
                        session.searchResults = results;
                        let reply = `🔍 Found ${results.length} matches for "${searchTerm}":\n\n` + 
                                results.map((r, i) => `*${i+1}.* ${r.type === 'BURIAL_SOCIETY' ? '🛡️' : (r.type === 'SERVICE_PROVIDER' ? '🛠️' : '⛪')} ${r.name}`).join('\n') +
                                `\n\nReply with the number to connect.`;
                        session.step = 'JOIN_SELECT';
                        await sendWhatsApp(cleanPhone, reply);
                        return;
                    } else {
                        await sendWhatsApp(cleanPhone, `⚠️ We couldn't find an organization matching "${searchTerm}". Please try another name, or ask them for their direct Join Code.`);
                        return;
                    }
                }

                if (org) {
                    if (org.type === 'BURIAL_SOCIETY') {
                        session.churchId = org.id;
                        session.churchCode = org.code;
                        session.step = 'CHOOSE_MEMBER_TYPE';
                        await sendWhatsApp(cleanPhone, `Welcome to *${org.name}*!\n\nHow can we help you today?\n\n1️⃣ I am an Existing Member\n2️⃣ I am a New Member (Get a Quote)`);
                        return;
                    } else {
                        let existingMember = await prisma.member.findFirst({
                            where: { phone: cleanPhone, churchCode: org.code },
                            include: { church: true } 
                        });
                        
                        if (!existingMember) {
                            existingMember = await prisma.member.create({
                                data: { phone: cleanPhone, firstName: fName, lastName: lName, church: { connect: { id: org.id } }, status: 'ACTIVE' },
                                include: { church: true }
                            });
                        }
                        
                        await sendWhatsApp(cleanPhone, `✅ Successfully linked to *${org.name}*! Retrieving your dashboard...`);
                        
                        member = existingMember;
                        session.churchCode = org.code;
                        session.step = null;
                        
                        if (org.type === 'NON_PROFIT') session.mode = 'NPO';
                        else if (org.type === 'SERVICE_PROVIDER' || org.type === 'PERSONAL_CARE') session.mode = 'PROVIDER';
                        else if (org.type === 'STOKVEL_SAVINGS') session.mode = 'STOKVEL';
                        else session.mode = 'CHURCH';

                        if (session.mode === 'NPO') await handleNPOMessage(cleanPhone, 'menu', session, member);
                        else if (session.mode === 'PROVIDER') await handleServiceProviderMessage(cleanPhone, 'menu', session, member);
                        else if (session.mode === 'STOKVEL') await handleStokvelMessage(cleanPhone, 'menu', session, member);
                        else await handleChurchMessage(cleanPhone, 'menu', session, member);

                        return;
                    }
                }
            }
            // 🔄 Original 2-Step Join Flow (Fallback)
            else if (incomingMsg === 'join' || joinSteps.includes(session.step)) {
                
                if (incomingMsg === 'join') {
                    session.step = 'SEARCH';
                    await sendWhatsApp(cleanPhone, "🔍 Let's find your organization!\n\nPlease reply with their name (e.g., 'your Church name' or 'organization name'):");
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
                        if (org.type === 'BURIAL_SOCIETY') {
                            session.churchId = org.id;
                            session.churchCode = org.code;
                            session.step = 'CHOOSE_MEMBER_TYPE';
                            await sendWhatsApp(cleanPhone, `Welcome to *${org.name}*!\n\nHow can we help you today?\n\n1️⃣ I am an Existing Member\n2️⃣ I am a New Member (Get a Quote)`);
                            return;
                        } else {
                            let existingMember = await prisma.member.findFirst({
                                where: { phone: cleanPhone, churchCode: org.code },
                                include: { church: true }
                            });
                            
                            if (!existingMember) {
                                existingMember = await prisma.member.create({
                                    data: { phone: cleanPhone, firstName: fName, lastName: lName, church: { connect: { id: org.id } }, status: 'ACTIVE' },
                                    include: { church: true }
                                });
                            }
                            
                            await sendWhatsApp(cleanPhone, `✅ Successfully linked to *${org.name}*! Retrieving your dashboard...`);
                            
                            member = existingMember;
                            session.churchCode = org.code;
                            session.step = null;
                            
                            if (org.type === 'NON_PROFIT') session.mode = 'NPO';
                            else if (org.type === 'SERVICE_PROVIDER' || org.type === 'PERSONAL_CARE') session.mode = 'PROVIDER';
                            else if (org.type === 'STOKVEL_SAVINGS') session.mode = 'STOKVEL';
                            else session.mode = 'CHURCH';

                            if (session.mode === 'NPO') await handleNPOMessage(cleanPhone, 'menu', session, member);
                            else if (session.mode === 'PROVIDER') await handleServiceProviderMessage(cleanPhone, 'menu', session, member);
                            else if (session.mode === 'STOKVEL') await handleStokvelMessage(cleanPhone, 'menu', session, member);
                            else await handleChurchMessage(cleanPhone, 'menu', session, member);

                            return;
                        }
                    } else {
                        await sendWhatsApp(cleanPhone, "⚠️ Invalid selection. Please reply with a valid number from the list, or type *Exit*.");
                        return;
                    }
                }

                if (session.step === 'CHOOSE_MEMBER_TYPE') {
                    if (incomingMsg === '1') {
                        session.step = 'ENTER_POLICY_NUMBER';
                        await sendWhatsApp(cleanPhone, `Great! Please reply with your exact *ID Number* so we can locate your existing profile.`);
                    } else if (incomingMsg === '2') {
                        const plans = await prisma.policyPlan.findMany({ where: { churchId: session.churchId } });
                        if (plans.length === 0) {
                            clearSessionFlag = true;
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

                if (session.step === 'ENTER_POLICY_NUMBER') {
                    const memberMatch = await prisma.member.findFirst({
                        where: { churchCode: session.churchCode, idNumber: incomingMsg }
                    });
                    if (memberMatch) {
                        await prisma.member.update({ where: { id: memberMatch.id }, data: { phone: cleanPhone } });
                        clearSessionFlag = true;
                        await sendWhatsApp(cleanPhone, `✅ Profile Linked!\n\nWelcome back, ${memberMatch.firstName}.\n\nReply *Society* to access your main menu (View Policy, Payments, Claims).`);
                    } else {
                        await sendWhatsApp(cleanPhone, `❌ We couldn't find a policy matching "${incomingMsg}". Please check your ID number and try again, or type *Exit* to restart.`);
                    }
                    return;
                }

                if (session.step === 'SELECT_QUOTE_PLAN') {
                    const plans = await prisma.policyPlan.findMany({ where: { churchId: session.churchId } });
                    const selectedIndex = parseInt(incomingMsg) - 1;

                    if (selectedIndex >= 0 && selectedIndex < plans.length) {
                        const plan = plans[selectedIndex];
                        const host = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
                        const botNum = process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '');
                        const quoteLink = `${host}/quote.html?code=${session.churchCode}&phone=${cleanPhone}&bot=${botNum}`;

                        const pricing = await calculateTransaction(plan.monthlyPremium, 'STANDARD', 'DEBIT_ORDER', true);

                        const msg = `*Quote: ${plan.planName}*\n` +
                                    `Premium: R${plan.monthlyPremium.toFixed(2)}\n` +
                                    `Admin Fee: R${pricing.totalFees.toFixed(2)}\n` +
                                    `*Total Monthly: R${pricing.totalChargedToUser.toFixed(2)}*\n\n` +
                                    `*Benefits Included:*\n${plan.benefitsSummary}\n\n` +
                                    `To add extended family (children/adults) and complete your registration, click your secure link below:\n👉 ${quoteLink}\n\n` +
                                    `Reply *Exit* to return to the start.`;
                        
                        session.step = 'AWAITING_QUOTE_ACCEPTANCE';
                        session.monthlyPremium = plan.monthlyPremium; 
                        await sendWhatsApp(cleanPhone, msg);
                    } else {
                        await sendWhatsApp(cleanPhone, `Invalid selection. Please reply with a valid plan number.`);
                    }
                    return;
                }
            }

            // ================================================
            // 🛡️ KYC & ONBOARDING UPLOADS (AI OCR)
            // ================================================
            if (incomingMsg.includes('accept the quote') || session.step === 'AWAITING_QUOTE_ACCEPTANCE') {
                session.step = 'AWAITING_MEMBER_ID';
                
                const premiumMatch = incomingMsg.match(/r(\d+(\.\d+)?)\/month/);
                if (premiumMatch) {
                    session.monthlyPremium = parseFloat(premiumMatch[1]);
                }

                if (session.churchCode) {
                    let draftMember = await prisma.member.findFirst({
                        where: { phone: cleanPhone, churchCode: session.churchCode }
                    });
                    
                    if (draftMember) {
                        await prisma.member.update({
                            where: { id: draftMember.id },
                            data: { monthlyPremium: session.monthlyPremium }
                        });
                    } else {
                        await prisma.member.create({
                            data: {
                                phone: cleanPhone,
                                firstName: fName, 
                                lastName: lName,  
                                church: { connect: { id: session.churchId } }, 
                                status: 'PENDING_KYC',
                                kycStatus: 'PENDING',
                                monthlyPremium: session.monthlyPremium
                            }
                        });
                    }
                }

                await sendWhatsApp(cleanPhone, "🎉 Fantastic! Your quote has been accepted.\n\nTo finalize your policy registration, we must complete a quick KYC compliance check.\n\nPlease reply directly to this message with a clear photo of your *ID Document* (Green Book or Smart ID).");
                return;
            }

            if (numMedia > 0 && session.step === 'AWAITING_MEMBER_ID') {
                if (!session.churchCode) {
                    await sendWhatsApp(cleanPhone, "⚠️ Your session has expired. Please reply with *Join* to restart your registration.");
                    return;
                }
                const idUrl = req.body.MediaUrl0; 
                const mimeType = req.body.MediaContentType0 || 'image/jpeg';
                await sendWhatsApp(cleanPhone, "⏳ *AI Processing...*\nReading your ID document. Please wait a moment.");

                try {
                    const authHeader = 'Basic ' + Buffer.from(`${process.env.TWILIO_SID}:${process.env.TWILIO_AUTH}`).toString('base64');
                    const imgResponse = await fetch(idUrl, { headers: { 'Authorization': authHeader } });
                    const arrayBuffer = await imgResponse.arrayBuffer();
                    const base64Image = Buffer.from(arrayBuffer).toString('base64');

                    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
                    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 
                    
                    const prompt = `You are a strict KYC compliance bot for an insurance company. Read this South African ID (Green book or Smart Card). Extract the person's first name(s), last name (surname), and 13-digit ID number. Return ONLY a raw JSON object with no markdown formatting. Format: {"firstName": "John", "lastName": "Doe", "idNumber": "1234567890123", "confidenceScore": 95}`;
                    
                    const result = await model.generateContent([ prompt, { inlineData: { data: base64Image, mimeType: mimeType } } ]);
                    const extractedData = JSON.parse(result.response.text().replace(/```json/gi, '').replace(/```/g, '').trim());

                    if (extractedData.confidenceScore > 75) {
                        let draftMember = await prisma.member.findFirst({
                            where: { phone: cleanPhone, churchCode: session.churchCode }
                        });
                        
                        if (draftMember) {
                            await prisma.member.update({
                                where: { id: draftMember.id },
                                data: { 
                                    idPhotoUrl: idUrl, 
                                    firstName: extractedData.firstName, 
                                    lastName: extractedData.lastName, 
                                    idNumber: extractedData.idNumber, 
                                    isIdVerified: true, 
                                    kycStatus: 'APPROVED', 
                                    monthlyPremium: session.monthlyPremium,
                                    policyNumber: session.policyNumber
                                }
                            });
                        }
                        
                        session.step = 'AWAITING_MEMBER_ADDRESS';
                        await sendWhatsApp(cleanPhone, `✅ *ID Verified Successfully!*\n\nWelcome, *${extractedData.firstName} ${extractedData.lastName}*\n(ID: ${extractedData.idNumber})\n\nAlmost done! Finally, please reply with a photo of your *Proof of Address* (e.g., a utility bill or bank statement).`);
                    } else {
                        throw new Error("AI Confidence too low.");
                    }
                } catch (error) {
                    let draftMember = await prisma.member.findFirst({
                        where: { phone: cleanPhone, churchCode: session.churchCode }
                    });
                    if (draftMember) {
                        await prisma.member.update({
                            where: { id: draftMember.id },
                            data: { idPhotoUrl: idUrl, isIdVerified: false, status: 'PENDING_KYC', monthlyPremium: session.monthlyPremium, policyNumber: session.policyNumber }
                        });
                    }
                    session.step = 'AWAITING_MEMBER_ADDRESS';
                    await sendWhatsApp(cleanPhone, "⚠️ *Automatic Verification Failed*\n\nWe couldn't clearly read the ID automatically. It has been securely forwarded for manual review.\n\nTo continue, please reply with a photo of your *Proof of Address*.");
                }
                return;
            }

            if (numMedia > 0 && session.step === 'AWAITING_MEMBER_ADDRESS') {
                const addressUrl = req.body.MediaUrl0;
                try {
                    const memberRecord = await prisma.member.findFirst({ 
                        where: { phone: cleanPhone, churchCode: session.churchCode },
                        orderBy: { id: 'desc' },
                        include: { church: true } 
                    });
                    
                    if (memberRecord) {
                        const newStatus = memberRecord.isIdVerified ? 'ACTIVE' : 'PENDING_KYC';
                        const orgName = memberRecord.church?.name || "the organization";
                        const orgType = memberRecord.church?.type || "CHURCH";
                        
                        let welcomeMsg = "";

                        if (memberRecord.isIdVerified) {
                            if (orgType === 'BURIAL_SOCIETY') {
                                welcomeMsg = `🎉 *REGISTRATION COMPLETE & POLICY ACTIVE!*\n\nPolicy Number: *${memberRecord.policyNumber || 'N/A'}*\nMonthly Premium: *R${(memberRecord.monthlyPremium || 0).toFixed(2)}*\n\nYour policy is now fully active. You can reply with *Menu* at any time to view your policy details or make a payment.`;
                            } else if (orgType === 'STOKVEL_SAVINGS') {
                                welcomeMsg = `🎉 *STOKVEL REGISTRATION COMPLETE!*\n\nWelcome to *${orgName}*. Your savings profile is now fully active and verified.\n\nReply *Stokvel* or *Menu* at any time to view your contributions, access your digital card, or make a payment.`;
                            } else if (orgType === 'NON_PROFIT') {
                                welcomeMsg = `🎉 *REGISTRATION COMPLETE!*\n\nWelcome to *${orgName}*. Your member profile is now fully active and verified.\n\nReply *NPO* or *Menu* at any time to access your dashboard.`;
                            } else if (orgType === 'SERVICE_PROVIDER' || orgType === 'PERSONAL_CARE') {
                                welcomeMsg = `🎉 *REGISTRATION COMPLETE!*\n\nWelcome to *${orgName}*. Your profile is now fully active and verified.\n\nReply *Menu* at any time to access your dashboard.`;
                            } else {
                                welcomeMsg = `🎉 *REGISTRATION COMPLETE!*\n\nWelcome to *${orgName}*. Your member profile is now fully active and verified.\n\nReply *Amen* or *Menu* at any time to access your dashboard and courses.`;
                            }
                        } else {
                            const accountLabel = orgType === 'BURIAL_SOCIETY' ? 'policy' : (orgType === 'STOKVEL_SAVINGS' ? 'savings profile' : 'account');
                            welcomeMsg = `✅ *Documents Received!*\n\nYour Proof of Address and ID have been securely vaulted for Admin Review. You will receive a WhatsApp notification as soon as your ${accountLabel} is officially activated!`;
                        }

                        await prisma.member.update({
                            where: { id: memberRecord.id },
                            data: { 
                                proofOfAddressUrl: addressUrl, 
                                status: newStatus, 
                                joinedAt: new Date(), 
                                ...(memberRecord.isIdVerified && { verifiedAt: new Date() }) 
                            }
                        });
                        
                        clearSessionFlag = true; 
                        await sendWhatsApp(cleanPhone, welcomeMsg);
                    }
                } catch (error) {
                    await sendWhatsApp(cleanPhone, "⚠️ There was an issue saving your document. Please try sending the photo again.");
                }
                return;
            }
			
			// ================================================
            // 📸 AI INVENTORY: BARCODE SCANNER INTERCEPTOR
            // ================================================
            const scanResult = await processBarcodeScan(req.body, cleanPhone, session, member, sendWhatsApp);
            if (scanResult.handled) {
                if (scanResult.clearSessionFlag) clearSessionFlag = true;
                return;
            }

            // ================================================
            // 🖼️ MULTIMEDIA (CLAIMS)
            // ================================================
            if (numMedia > 0 && session.step === 'AWAITING_CLAIM_DOCUMENT') {
                const code = member?.church?.code || member?.society?.code || session.churchCode;
                const churchId = member?.churchId || 1;
                
                try {
                    const { getPrice } = require('../services/pricing');
                    const claimCost = await getPrice('CLAIM_AI'); 
                    
                    await prisma.transaction.create({ 
                        data: {
                            amount: -claimCost, 
                            type: 'CLAIM_FEE',       
                            status: 'SUCCESS',
                            reference: `FEE-${Date.now()}`,
                            method: 'INTERNAL', 
                            description: 'Forensic Death Claim Analysis',
                            phone: cleanPhone, 
                            date: new Date(),
                            church: { connect: { id: Number(churchId) } }
                        }
                    });
                    console.log(`💰 [BILLING] Charged Org #${churchId} R${claimCost} for AI Claim Analysis`);
                } catch (e) {
                    console.error("🛑 BILLING FAILED (CRITICAL):", e.message);
                }

                processTwilioClaim(cleanPhone, req.body.MediaUrl0, code);
                clearSessionFlag = true;
                await sendWhatsApp(cleanPhone, "⏳ *Document Received!*\n\nOur Gemini AI is now processing the claim. This usually takes 10-15 seconds. I will message you once the scan is complete.");
                return;
            }

            // ================================================
            // ⛔ UNREGISTERED & ORPHAN CATCHERS
            // ================================================
            if (!member) {
                await sendWhatsApp(cleanPhone, "👋 Welcome to Seabe! Please reply with *Join* to find your organization.");
                return;
            }

            if (!member.church) {
                await sendWhatsApp(cleanPhone, "⚠️ You are not currently linked to any organization. Please reply *Join* to search for yours.");
                return;
            }

            // ================================================
            // 🏛️ BRANCH ROUTING (CHURCH, NPO, PROVIDERS)
            // ================================================
            
            // 🚀 Ensure session mode is perfectly aligned BEFORE resolving keywords
            if (!session.mode && member.church) {
                if (member.church.type === 'BURIAL_SOCIETY') session.mode = 'SOCIETY';
                else if (member.church.type === 'STOKVEL_SAVINGS') session.mode = 'STOKVEL';
                else if (member.church.type === 'NON_PROFIT') session.mode = 'NPO';
                else if (member.church.type === 'SERVICE_PROVIDER' || member.church.type === 'PERSONAL_CARE') session.mode = 'PROVIDER';
                else session.mode = 'CHURCH';
            }

            // Safe, strictly-isolated keyword mapping
            const genericMenuKeywords = ['hi', 'hello', 'menu', 'dashboard', 'help'];
            let mappedMsg = incomingMsg;

            if (genericMenuKeywords.includes(incomingMsg)) {
                mappedMsg = 'menu';
            } else if (incomingMsg === 'amen' && session.mode === 'CHURCH') {
                mappedMsg = 'menu'; // Amen ONLY works for Churches
            } else if (incomingMsg === 'society' && session.mode === 'SOCIETY') {
                mappedMsg = 'menu'; // Society ONLY works for Burial Societies
            } else if (incomingMsg === 'npo' && session.mode === 'NPO') {
                mappedMsg = 'menu';
            } else if (incomingMsg === 'stokvel' && session.mode === 'STOKVEL') {
                mappedMsg = 'menu';
            } else if ((incomingMsg === 'provider' || incomingMsg === 'salon') && session.mode === 'PROVIDER') {
                mappedMsg = 'menu';
            }

            // 🚀 ROUTES
            let botResult = { handled: false };

            if (session.mode === 'SOCIETY') {
                botResult = await handleSocietyMessage(cleanPhone, mappedMsg, session, member) || {};
            } 
            else if (session.mode === 'CHURCH') {
                botResult = await handleChurchMessage(cleanPhone, mappedMsg, session, member) || {};
            } 
            else if (session.mode === 'STOKVEL') {
                botResult = await handleStokvelMessage(cleanPhone, mappedMsg, session, member) || {};
            } 
            else if (session.mode === 'NPO') {
                botResult = await handleNPOMessage(cleanPhone, mappedMsg, session, member) || {};
            }
            else if (session.mode === 'PROVIDER') {
                botResult = await handleServiceProviderMessage(cleanPhone, mappedMsg, session, member) || {};
            }

            // If the domain bot knew the answer, stop here!
            if (botResult.handled) {
                return; 
            }

            // ================================================
            // 🤖 AI NLP FALLBACK & TYPO CATCHER
            // ================================================
            const orgName = member?.church?.name || 'Seabe';
            await handleSupportOrTypo(incomingMsg, cleanPhone, orgName);
            return;

        } catch (e) { 
            console.error("❌ ROUTER CRASH:", e);
        } finally {
        
            // ================================================
            // 💾 THE MAGIC: AUTO-SAVE SESSION TO DATABASE
            // ================================================
            try {
                if (clearSessionFlag) {
                    await prisma.botSession.deleteMany({ where: { phone: cleanPhone } });
                } else if (Object.keys(session).length > 0) {
                    const { step, mode, ...dataObj } = session;
                    await prisma.botSession.upsert({
                        where: { phone: cleanPhone },
                        update: { step: step || null, mode: mode || null, data: dataObj },
                        create: { phone: cleanPhone, step: step || null, mode: mode || null, data: dataObj }
                    });
                }
            } catch (saveErr) {
                console.error("❌ Failed to save session state to database:", saveErr);
            }
        }
    })();
});

module.exports = router;