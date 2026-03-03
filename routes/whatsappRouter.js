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

router.post('/', (req, res) => {
    const incomingMsg = (req.body.Body || '').trim().toLowerCase();
    const cleanPhone = (req.body.From || '').replace('whatsapp:', '');

    // 1. Respond to Twilio IMMEDIATELY
    res.type('text/xml').send('<Response></Response>');

    (async () => {
        let session = {};
        let clearSessionFlag = false; 

        try {
            // ================================================
            // 🧠 LOAD SESSION FROM DATABASE
            // ================================================
            const dbSession = await prisma.botSession.findUnique({ where: { phone: cleanPhone } });
            if (dbSession) {
                session = { step: dbSession.step, mode: dbSession.mode, ...(dbSession.data || {}) };
            }

            const numMedia = parseInt(req.body.NumMedia || '0'); 
            
            const member = await prisma.member.findFirst({
                where: { phone: cleanPhone },
                orderBy: { id: 'desc' },
                include: { church: true, society: true }
            });

            // ================================================
            // 🚦 GLOBAL RESET & COURSE SNOOZE
            // ================================================
            const exitKeywords = ['exit', 'cancel', 'menu', 'home'];
            if (exitKeywords.includes(incomingMsg)) {
                clearSessionFlag = true; 
                
                if (member) {
                    await prisma.enrollment.updateMany({
                        where: { memberId: member.id, quizState: 'AWAITING_QUIZ' },
                        data: { quizState: 'IDLE', updatedAt: new Date() } 
                    });
                }
                
                let resetMsg = "🔄 Session cleared & courses paused.\n\nReply *Join* to switch organizations.";
                if (member && member.church) {
                    if (member.church.type === 'BURIAL_SOCIETY') resetMsg += "\nReply *Society* for your main menu.";
                    else if (member.church.type === 'CHURCH') resetMsg += "\nReply *Amen* for your church menu, or *Courses* to learn.";
                    else resetMsg += "\nReply *Menu* for your dashboard, or *Courses* for our learning center.";
                } else {
                    resetMsg += "\nReply *Amen* for Church, *Society* for Burial, or *Menu* for NGOs/Providers.";
                }
                
                await sendWhatsApp(cleanPhone, resetMsg);
                return;
            }

            // ================================================
            // 🎓 LMS Phase B: AI QUIZ EVALUATOR
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
            // 🎓 LMS Phase A: COURSE ENROLLMENT
            // ================================================
            const lmsTriggers = ['mentorship', 'grow', 'learn', 'courses'];
            if (lmsTriggers.includes(incomingMsg)) {
                if (!member || !member.church) {
                    await sendWhatsApp(cleanPhone, "⚠️ You must be linked to an organization to view courses. Reply *Join* first.");
                    return;
                }
                const courses = await prisma.course.findMany({
                    where: { churchId: member.church.id },
                    orderBy: { price: 'asc' }
                });

                if (courses.length === 0) {
                    await sendWhatsApp(cleanPhone, "📚 *Learning Centre*\n\nThere are currently no active courses available. Check back later!");
                    return;
                }

                let msg = `📚 *Learning & Mentorship Centre*\nSelect a course to enroll:\n\n`;
                courses.forEach((c, index) => {
                    msg += `*${index + 1}. ${c.title}*\nCost: ${c.price === 0 ? 'FREE' : 'R' + c.price}\n\n`;
                });
                msg += `Reply with the *Number* of the course you wish to join.`;

                session.step = 'AWAITING_COURSE_SELECTION';
                session.availableCourses = courses; 
                await sendWhatsApp(cleanPhone, msg);
                return;
            }

            if (session.step === 'AWAITING_COURSE_SELECTION') {
                const selectedIndex = parseInt(incomingMsg) - 1;
                const courses = session.availableCourses;

                if (selectedIndex >= 0 && selectedIndex < courses.length) {
                    const selectedCourse = courses[selectedIndex];
                    const enrollment = await prisma.enrollment.create({
                        data: {
                            memberId: member.id,
                            courseId: selectedCourse.id,
                            status: selectedCourse.price === 0 ? 'ACTIVE' : 'PENDING_PAYMENT'
                        }
                    });

                    if (selectedCourse.price === 0) {
                        session.step = 'LMS_ACTIVE';
                        await sendWhatsApp(cleanPhone, `🎉 You are now enrolled in *${selectedCourse.title}*!\n\nLook out for your first module tomorrow morning at 07:00 AM.`);
                    } else {
                        const host = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
                        const paymentLink = `${host}/pay?enrollmentId=${enrollment.id}&amount=${selectedCourse.price}`;
                        await sendWhatsApp(cleanPhone, `🎓 *${selectedCourse.title}*\n\nTo unlock your modules, please complete your subscription payment of *R${selectedCourse.price}*.\n\n💳 *Pay securely here:*\n👉 ${paymentLink}\n\nOnce paid, your modules will unlock automatically!`);
                    }
                    clearSessionFlag = true; 
                } else {
                    await sendWhatsApp(cleanPhone, "Invalid selection. Please reply with a valid course number.");
                }
                return;
            }

            // ================================================
            // 🔍 UNIVERSAL JOIN & QUOTE FLOW
            // ================================================
            const joinSteps = ['SEARCH', 'JOIN_SELECT', 'CHOOSE_MEMBER_TYPE', 'ENTER_POLICY_NUMBER', 'SELECT_QUOTE_PLAN', 'AWAITING_QUOTE_ACCEPTANCE'];
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
                        if (org.type === 'BURIAL_SOCIETY') {
                            session.churchId = org.id;
                            session.churchCode = org.code;
                            session.step = 'CHOOSE_MEMBER_TYPE';
                            await sendWhatsApp(cleanPhone, `Welcome to *${org.name}*!\n\nHow can we help you today?\n\n1️⃣ I am an Existing Member\n2️⃣ I am a New Member (Get a Quote)`);
                            return;
                        } else {
                            let existingMember = await prisma.member.findFirst({
                                where: { phone: cleanPhone, churchCode: org.code }
                            });
                            
                            if (!existingMember) {
                                // 🚀 FIXED: No redundant churchCode here
                                await prisma.member.create({
                                    data: { 
                                        phone: cleanPhone, 
                                        firstName: 'Member', 
                                        lastName: 'New', 
                                        church: { connect: { id: org.id } }, 
                                        status: 'ACTIVE' 
                                    }
                                });
                            }
                            
                            clearSessionFlag = true; 
                            const welcomeType = org.type === 'NON_PROFIT' ? "📚 Reply *Courses* to view our digital learning programs" : "Reply *Amen* to access your church menu";
                            await sendWhatsApp(cleanPhone, `✅ Successfully linked to *${org.name}*!\n\n${welcomeType}, or *Menu* to access your dashboard.`);
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

                        const msg = `*Quote: ${plan.planName}*\nBase Premium: *R${plan.monthlyPremium} / month*\n\n*Benefits Included:*\n${plan.benefitsSummary}\n\nTo add extended family (children/adults) and complete your registration, click your secure link below:\n👉 ${quoteLink}\n\nReply *Exit* to return to the start.`;
                        
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
                        // 🚀 FIXED: No redundant churchCode here
                        await prisma.member.create({
                            data: {
                                phone: cleanPhone,
                                firstName: 'Pending',
                                lastName: 'Member',
                                church: { connect: { id: session.churchId } }, 
                                status: 'PENDING_KYC',
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
                        orderBy: { id: 'desc' }
                    });
                    
                    if (memberRecord) {
                        const newStatus = memberRecord.isIdVerified ? 'ACTIVE' : 'PENDING_KYC';
                        
                        const welcomeMsg = memberRecord.isIdVerified 
                            ? `🎉 *REGISTRATION COMPLETE & POLICY ACTIVE!*\n\nPolicy Number: *${memberRecord.policyNumber || 'N/A'}*\nMonthly Premium: *R${(memberRecord.monthlyPremium || 0).toFixed(2)}*\n\nYour policy is now fully active. You can reply with *Menu* at any time to view your policy details or make a payment.`
                            : "✅ *Documents Received!*\n\nYour Proof of Address and ID have been vaulted for Admin Review. You will receive a WhatsApp notification as soon as your policy is officially activated!";

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
            // 🖼️ MULTIMEDIA (CLAIMS)
            // ================================================
            if (numMedia > 0 && session.step === 'AWAITING_CLAIM_DOCUMENT') {
                const code = member?.church?.code || member?.society?.code || session.churchCode;
                processTwilioClaim(cleanPhone, req.body.MediaUrl0, code);
                clearSessionFlag = true;
                await sendWhatsApp(cleanPhone, "⏳ *Document Received!*\n\nOur Gemini AI is now processing the claim. I will message you once the scan is complete.");
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
            
            const menuKeywords = ['society', 'amen', 'hi', 'hello', 'menu', 'dashboard'];
            const mappedMsg = menuKeywords.includes(incomingMsg) ? 'menu' : incomingMsg;

            if (incomingMsg === 'society') session.mode = 'SOCIETY';
            if (incomingMsg === 'amen') session.mode = 'CHURCH';

            if (menuKeywords.includes(incomingMsg) && !session.mode && member.church) {
                session.mode = member.church.type === 'BURIAL_SOCIETY' ? 'SOCIETY' : 'CHURCH';
            }

            if (session.mode === 'SOCIETY') {
                if (member.church && member.church.type === 'BURIAL_SOCIETY') {
                    await handleSocietyMessage(cleanPhone, mappedMsg, session, member);
                    return;
                } else {
                    await sendWhatsApp(cleanPhone, "⚠️ You are not linked to a Burial Society. Reply *Join* to find one.");
                    return;
                }
            }

            if (session.mode === 'CHURCH') {
                if (member.church && member.church.type !== 'BURIAL_SOCIETY') {
                    await handleChurchMessage(cleanPhone, mappedMsg, session, member);
                    return;
                } else {
                    await sendWhatsApp(cleanPhone, "⚠️ You are not linked to an organization. Reply *Join* to search for yours.");
                    return;
                }
            }

            // ================================================
            // 🤖 AI FALLBACK
            // ================================================
            const aiResponse = await getAISupportReply(incomingMsg, cleanPhone, member?.firstName);
            await sendWhatsApp(cleanPhone, aiResponse);

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