// bots/lwaziBot.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { calculateTransaction } = require('../services/pricingEngine');
const { processLmsMessage } = require('./LMSlogicBot'); 
const crypto = require('crypto');

// Generates a consistent 32-byte locking key using your Twilio Auth token
const SECRET_KEY = crypto.scryptSync(process.env.TWILIO_AUTH || 'seabe-fallback-key', 'seabe-salt', 32);

// 🚀 THE SLEDGEHAMMER FIX: Isolate Lwazi's Twilio Connection!
const twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
const LWAZI_NUMBER = 'whatsapp:+27875511057'; // Force the Lwazi number

// 📬 Dedicated Lwazi Sender (Includes smart chunking)
const sendLwazi = async (to, body, mediaUrl = null) => {
    if (!process.env.TWILIO_SID) return console.log("⚠️ Twilio Keys Missing!");
    
    const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:+${to.replace('+', '')}`;
    const MAX_LENGTH = 1500;
    const messageChunks = [];

    if (body.length > MAX_LENGTH) {
        let remainingText = body;
        while (remainingText.length > 0) {
            if (remainingText.length <= MAX_LENGTH) {
                messageChunks.push(remainingText);
                break;
            }
            let splitIndex = MAX_LENGTH;
            let chunk = remainingText.substring(0, MAX_LENGTH);
            let lastDoubleNewline = chunk.lastIndexOf('\n\n');
            let lastNewline = chunk.lastIndexOf('\n');
            let lastSpace = chunk.lastIndexOf(' ');

            if (lastDoubleNewline > MAX_LENGTH - 300) splitIndex = lastDoubleNewline; 
            else if (lastNewline > MAX_LENGTH - 200) splitIndex = lastNewline;       
            else if (lastSpace > MAX_LENGTH - 100) splitIndex = lastSpace;         

            messageChunks.push(remainingText.substring(0, splitIndex).trim());
            remainingText = remainingText.substring(splitIndex).trim();
        }
    } else {
        messageChunks.push(body);
    }

    for (const chunk of messageChunks) {
        try {
            const options = { from: LWAZI_NUMBER, to: formattedTo, body: chunk };
            if (mediaUrl) options.mediaUrl = [mediaUrl];
            await twilioClient.messages.create(options);
            await new Promise(res => setTimeout(res, 500));
        } catch (e) { 
            console.error("❌ Lwazi Send Error:", e.message); 
        }
    }
};

// Notice we just ignore the global sendWhatsApp parameter now!
async function processLwaziMessage(phone, msg, session, mediaUrl, _ignoredGlobalSender) {
    
    // 1. Fetch or Create the Payer User
    let member = await prisma.member.findFirst({
        where: { phone: phone, churchCode: 'LWAZI_HQ' },
        include: { church: true } 
    });

    if (!member) {
        let lwaziOrg = await prisma.church.findUnique({ where: { code: 'LWAZI_HQ' } });
        if (!lwaziOrg) {
            lwaziOrg = await prisma.church.create({
                data: { name: 'Lwazi Caps Tutor', code: 'LWAZI_HQ', type: 'ACADEMY', accountStatus: 'ACTIVE' }
            });
        }
        member = await prisma.member.create({
            data: { 
                phone: phone, 
                firstName: 'Student', 
                lastName: '.', 
                church: { connect: { id: lwaziOrg.id } }, 
                status: 'PENDING_SUBSCRIPTION' 
            },
            include: { church: true }
        });
    }

    // ================================================
    // 🛒 NOMINATION & CHECKOUT FLOW
    // ================================================
    if (msg === 'subscribe' || msg === 'buy' || msg === '4') {
        session.step = 'LWAZI_CHOOSE_PLAN';
        session.nominatedNumbers = [];
        await sendLwazi(phone, "📚 *Lwazi Premium Subscription*\n\n1️⃣ *Subscribe for Myself*\n2️⃣ *Nominate Students* (Add up to 5 numbers)\n3️⃣ *Check Subscription Status*\n4️⃣ *Change Program*\n5️⃣ *Restore Previous Program*\n\n_Reply 1, 2, 3, 4, or 5_");
        return;
    }

    if (session.step === 'LWAZI_CHOOSE_PLAN') {
        if (msg === '1') {
            session.nominatedNumbers = [phone];
            return await generateLwaziCheckout(phone, member, session, sendLwazi);
        } else if (msg === '2') {
            session.step = 'LWAZI_COLLECT_NUMBERS';
            await sendLwazi(phone, "📱 Please reply with the *WhatsApp number* of the first student (e.g., 0821234567):");
            return;
        } else if (msg === '3') {
            // Option 3: Verify Subscription Status
            session.step = null;
            
            const activeEnrollmentCount = await prisma.enrollment.count({
                where: { memberId: member.id, status: 'ACTIVE' }
            });
            
            let statusText = "🔴 *Inactive*";
            if (member.status === 'ACTIVE') {
                if (activeEnrollmentCount > 0) {
                    statusText = "🟢 *Active*";
                } else {
                    statusText = "⚠️ *Paid, but no Program selected!*";
                }
            } else if (member.status === 'PENDING_SUBSCRIPTION' || member.status === 'PENDING_PAYMENT') {
                statusText = "⏳ *Pending Payment*";
            } else if (member.status === 'CANCELED') {
                statusText = "🛑 *Canceled*";
            }
            
            let statusMsg = `📊 *Subscription Status*\n\nYour Account: ${statusText}\n`;

            // Display Explicit Active Program
            if (member.activeProgramId) {
                const activeProgram = await prisma.program.findUnique({ where: { id: member.activeProgramId } });
                if (activeProgram) {
                    statusMsg += `\n🎓 *Current Program:* ${activeProgram.title} _(Selected: ${member.programSelectedAt ? member.programSelectedAt.toLocaleDateString('en-ZA') : 'N/A'})_\n`;
                }
            }
            
            const dependents = await prisma.member.findMany({
                where: { parentId: member.id, churchCode: 'LWAZI_HQ' }
            });
            
            if (dependents.length > 0) {
                statusMsg += `\n👨‍👩‍👧‍👦 *Linked Students:*\n`;
                dependents.forEach(d => {
                    const dStatus = d.status === 'ACTIVE' ? "🟢" : (d.status === 'CANCELED' ? "🛑" : "🔴");
                    statusMsg += `${dStatus} ${d.firstName} (${d.phone})\n`;
                });
            }
            
            if (member.status !== 'ACTIVE') {
                statusMsg += `\n_Reply *Subscribe* and choose Option 1 or 2 to activate your account!_`;
            } else if (activeEnrollmentCount === 0) {
                statusMsg += `\n_Reply *Start* to select your learning program!_`;
            } else {
                statusMsg += `\n_Reply *Menu* to return to the learning dashboard._`;
            }
            
            await sendLwazi(phone, statusMsg);
            return;

        } else if (msg === '4') {
            // Option 4: Change Program
            const programs = await prisma.program.findMany({
                where: { churchId: member.churchId, status: 'LIVE' }
            });
            if (programs.length === 0) {
                await sendLwazi(phone, "⚠️ There are currently no alternative programs available to switch to.");
                return;
            }
            session.step = 'LWAZI_CHANGE_PROGRAM';
            session.availablePrograms = programs.map(p => p.id);
            
            let progMsg = `🔄 *Change Program*\n\nPlease select a new Program to enroll in. (Note: This will pause your current active program).\n\n`;
            programs.forEach((p, idx) => {
                progMsg += `${idx + 1}️⃣ *${p.title}*\n`;
            });
            progMsg += `\n_Reply with the number of the new program._`;
            
            await sendLwazi(phone, progMsg);
            return;

        } else if (msg === '5') {
            // Option 5: Restore Previous Program
            const inactiveEnrollments = await prisma.enrollment.findMany({
                where: { memberId: member.id, status: { in: ['DROPPED', 'ARCHIVED', 'CANCELED'] } },
                select: { course: { select: { programId: true } } }
            });
            
            const pastProgramIds = [...new Set(inactiveEnrollments.map(e => e.course?.programId).filter(Boolean))];
            
            if (pastProgramIds.length === 0) {
                await sendLwazi(phone, "⚠️ You don't have any previously paused or dropped programs to restore.");
                return;
            }

            const programs = await prisma.program.findMany({
                where: { id: { in: pastProgramIds }, status: 'LIVE' }
            });

            if (programs.length === 0) {
                await sendLwazi(phone, "⚠️ Your previous programs are no longer active.");
                return;
            }

            session.step = 'LWAZI_RESTORE_PROGRAM';
            session.availablePrograms = programs.map(p => p.id);
            
            let progMsg = `⏪ *Restore Program*\n\nWhich program would you like to restore? (Your previous progress will be safely picked back up).\n\n`;
            programs.forEach((p, idx) => {
                progMsg += `${idx + 1}️⃣ *${p.title}*\n`;
            });
            progMsg += `\n_Reply with the number of the program._`;
            
            await sendLwazi(phone, progMsg);
            return;

        } else {
            await sendLwazi(phone, "⚠️ Please reply with 1, 2, 3, 4, or 5.");
            return;
        }
    }

    if (session.step === 'LWAZI_COLLECT_NUMBERS') {
        let targetPhone = msg.replace(/\D/g, ''); 
        if (targetPhone.startsWith('0')) targetPhone = '27' + targetPhone.substring(1);
        
        if (targetPhone.length < 10) {
             await sendLwazi(phone, "⚠️ Invalid number. Please enter a valid South African mobile number (e.g., 0821234567).");
             return;
        }

        if (!session.nominatedNumbers) session.nominatedNumbers = [];
        if (!session.nominatedNumbers.includes(targetPhone)) {
             session.nominatedNumbers.push(targetPhone);
        }

        if (session.nominatedNumbers.length >= 5) {
             await sendLwazi(phone, "✅ Maximum of 5 students reached! Generating your checkout link...");
             return await generateLwaziCheckout(phone, member, session, sendLwazi);
        } else {
             session.step = 'LWAZI_MORE_NUMBERS';
             await sendLwazi(phone, `✅ Added +${targetPhone}.\n\nYou have added ${session.nominatedNumbers.length}/5 students.\n\nReply *1* to add another student.\nReply *2* to proceed to checkout.`);
             return;
        }
    }

    if (session.step === 'LWAZI_MORE_NUMBERS') {
        if (msg === '1') {
             session.step = 'LWAZI_COLLECT_NUMBERS';
             await sendLwazi(phone, "📱 Please reply with the *WhatsApp number* of the next student:");
        } else if (msg === '2') {
             return await generateLwaziCheckout(phone, member, session, sendLwazi);
        } else {
             await sendLwazi(phone, "⚠️ Please reply with 1 or 2.");
        }
        return;
    }

    // ================================================
    // 🔄 PROGRAM MANAGEMENT (CHANGE & RESTORE)
    // ================================================
    if (session.step === 'LWAZI_CHANGE_PROGRAM') {
        const selection = parseInt(msg) - 1;
        if (isNaN(selection) || selection < 0 || !session.availablePrograms || selection >= session.availablePrograms.length) {
            await sendLwazi(phone, "⚠️ Invalid selection. Please reply with the number of the program.");
            return;
        }
        const selectedProgramId = session.availablePrograms[selection];
        
        // 1. Pause current active enrollments
        await prisma.enrollment.updateMany({
            where: { memberId: member.id, status: 'ACTIVE' },
            data: { status: 'DROPPED' }
        });

        // 2. Fetch new courses and activate them
        const programCourses = await prisma.course.findMany({
            where: { programId: selectedProgramId, status: 'LIVE' }
        });

        if (programCourses.length > 0) {
            for(const c of programCourses) {
                const existing = await prisma.enrollment.findFirst({
                    where: { memberId: member.id, courseId: c.id }
                });
                if (existing) {
                    await prisma.enrollment.update({
                        where: { id: existing.id },
                        data: { status: 'ACTIVE' }
                    });
                } else {
                    await prisma.enrollment.create({
                        data: { memberId: member.id, courseId: c.id, status: 'ACTIVE' }
                    });
                }
            }
        }
        
        // 3. Update Explicit Program Tracking
        await prisma.member.update({
            where: { id: member.id },
            data: { 
                activeProgramId: selectedProgramId,
                programSelectedAt: new Date() 
            }
        });

        session.step = null;
        delete session.availablePrograms;
        await sendLwazi(phone, "✅ *Program Changed Successfully!*\n\nYou are now enrolled in your new program. Reply *Menu* to open your learning dashboard.");
        return;
    }

    if (session.step === 'LWAZI_RESTORE_PROGRAM') {
        const selection = parseInt(msg) - 1;
        if (isNaN(selection) || selection < 0 || !session.availablePrograms || selection >= session.availablePrograms.length) {
            await sendLwazi(phone, "⚠️ Invalid selection. Please reply with the number of the program.");
            return;
        }
        const selectedProgramId = session.availablePrograms[selection];

        // 1. Pause current active enrollments to prevent clutter
        await prisma.enrollment.updateMany({
            where: { memberId: member.id, status: 'ACTIVE' },
            data: { status: 'DROPPED' }
        });
        
        // 2. Restore enrollments for the selected program
        const programCourses = await prisma.course.findMany({
            where: { programId: selectedProgramId }
        });

        const courseIds = programCourses.map(c => c.id);

        if (courseIds.length > 0) {
            await prisma.enrollment.updateMany({
                where: { memberId: member.id, courseId: { in: courseIds } },
                data: { status: 'ACTIVE' }
            });
        }

        // 3. Update Explicit Program Tracking
        await prisma.member.update({
            where: { id: member.id },
            data: { 
                activeProgramId: selectedProgramId,
                programSelectedAt: new Date() 
            }
        });

        session.step = null;
        delete session.availablePrograms;
        await sendLwazi(phone, "⏪ *Program Restored Successfully!*\n\nYour previous progress is ready. Reply *Menu* to open your learning dashboard.");
        return;
    }

    // ================================================
    // 🛑 THE UNSUBSCRIBE TRAPDOOR
    // ================================================
    if (msg === 'cancel' || msg === 'unsubscribe' || msg === 'stop billing') {
        session.step = 'CONFIRM_CANCEL';
        await sendLwazi(phone, "⚠️ *Cancel Subscription*\n\nAre you sure you want to cancel your Lwazi Premium subscription? You will lose access to the AI Tutor and daily quizzes immediately.\n\nReply *YES* to confirm cancellation, or *NO* to keep learning.");
        return;
    }

    if (session.step === 'CONFIRM_CANCEL') {
        if (msg === 'yes') {
            await prisma.member.update({ where: { id: member.id }, data: { status: 'CANCELED' } });
            await prisma.paymentMethod.updateMany({ where: { memberId: member.id }, data: { isDefault: false } });

            session.step = null;
            await sendLwazi(phone, "🛑 *Subscription Canceled*\n\nYour automatic billing has been securely stopped, and your card has been unlinked. We are sorry to see you go!\n\nIf you ever want to return, just reply *Subscribe*.");
            return;
        } else if (msg === 'no') {
            session.step = null;
            await sendLwazi(phone, "✅ Cancellation aborted. We are glad you're staying! Reply *Menu* to continue learning.");
            return;
        }
    }

    // ================================================
    // 🛡️ THE PREMIUM PAYWALL GATEKEEPER
    // ================================================
    if (member.status !== 'ACTIVE') {
        const paywallMsg = `🦉 *Welcome to Lwazi Caps Micro-Tutor!*\n\n` +
                           `Unlock your full academic potential with Lwazi Premium! For only *R69/month*, you get:\n\n` +
                           `🧠 *Unlimited AI Tutor:* 24/7 help with Math, Science, and more.\n` +
                           `📚 *CAPS-Aligned Courses:* Step-by-step daily lessons.\n` +
                           `📝 *Smart Quizzes:* Instant grading and feedback.\n` +
                           `👨‍👩‍👧‍👦 *Family Plan:* Discounts when adding multiple students.\n\n` +
                           `_Reply *Subscribe* to activate your account and start learning today!_`;
        
        await sendLwazi(phone, paywallMsg);
        return;
    }

    // ================================================
    // 🚀 1-TIME ONBOARDING FLOW
    // ================================================
    if (member.idType !== 'ONBOARDED') {
        
        // 1. Instantly capture "start" or "onboard" and reset the flow
        if (['start', 'onboard', 'menu', 'hi', 'hello'].includes(msg)) {
            session.step = null;
        }

        // 2. Is this a direct reply to the Webhook's auto-welcome message? (e.g. "10")
        const isPotentialGrade = !session.step && !isNaN(parseInt(msg)) && parseInt(msg) >= 4 && parseInt(msg) <= 12;

        // 3. Start the flow if they just arrived or typed a keyword
        if (!session.step && !isPotentialGrade) {
            session.step = 'ONB_GRADE';
            await sendLwazi(phone, "🎉 *Welcome to Lwazi Premium!*\n\nLet's customize your learning experience.\n\nWhat grade are you in?\n_Reply with a number between 4 and 12 (e.g., 10)_");
            return;
        }

        // 4. Safely process the Grade
        if (session.step === 'ONB_GRADE' || isPotentialGrade) {
            const grade = parseInt(msg);
            if (isNaN(grade) || grade < 4 || grade > 12) {
                await sendLwazi(phone, "⚠️ Please reply with a valid grade number between 4 and 12.");
                return;
            }
            session.grade = grade; 
            session.step = 'ONB_LANG';
            await sendLwazi(phone, `Great! Grade ${grade}.\n\nWhat language do you prefer for your explanations?\n\n1️⃣ English\n2️⃣ Afrikaans\n3️⃣ Zulu\n4️⃣ Sotho\n\n_Reply with a number 1-4_`);
            return;
        }

        if (session.step === 'ONB_LANG') {
            const langs = { '1': 'en', '2': 'af', '3': 'zu', '4': 'st' };
            const langNames = { '1': 'English', '2': 'Afrikaans', '3': 'Zulu', '4': 'Sotho' };
            
            if (!langs[msg]) {
                await sendLwazi(phone, "⚠️ Please reply with 1, 2, 3, or 4.");
                return;
            }
            
            await prisma.member.update({
                where: { id: member.id },
                data: { language: langs[msg] }
            });

            const programs = await prisma.program.findMany({
                where: { churchId: member.churchId, status: 'LIVE' }
            });
            
            if (programs.length === 0) {
                await prisma.member.update({ where: { id: member.id }, data: { idType: 'ONBOARDED' } });
                session.step = null;
                await sendLwazi(phone, `✅ Language set to ${langNames[msg]}!\n\nThere are no programs currently available. Reply *Menu* to open your dashboard.`);
                return;
            }
            
            session.step = 'ONB_PROGRAM';
            let progMsg = `✅ Language set to ${langNames[msg]}!\n\nPlease select a Program to enroll in:\n\n`;
            programs.forEach((p, idx) => {
                progMsg += `${idx + 1}️⃣ *${p.title}*\n`;
            });
            progMsg += `\n_Reply with the number of the program._`;
            
            session.availablePrograms = programs.map(p => p.id);
            await sendLwazi(phone, progMsg);
            return;
        }

        if (session.step === 'ONB_PROGRAM') {
            const selection = parseInt(msg) - 1;
            if (isNaN(selection) || selection < 0 || !session.availablePrograms || selection >= session.availablePrograms.length) {
                await sendLwazi(phone, "⚠️ Invalid selection. Please reply with the number of the program.");
                return;
            }
            
            const selectedProgramId = session.availablePrograms[selection];
            
            const programCourses = await prisma.course.findMany({
                where: { programId: selectedProgramId, status: 'LIVE' }
            });

            if (programCourses.length > 0) {
                const enrollmentsData = programCourses.map(c => ({
                    memberId: member.id,
                    courseId: c.id,
                    status: 'ACTIVE'
                }));
                await prisma.enrollment.createMany({ data: enrollmentsData });
            }
            
            // Explicit tracking update
            await prisma.member.update({
                where: { id: member.id },
                data: { 
                    idType: 'ONBOARDED',
                    activeProgramId: selectedProgramId,
                    programSelectedAt: new Date()
                }
            });

            session.step = null;
            delete session.availablePrograms;
            
            await sendLwazi(phone, "🎉 *Setup Complete!*\n\nYou are fully enrolled in your selected program.\n\nReply *Menu* to open your learning dashboard.");
            return;
        }

        // Force trap inside the onboarding flow if not onboarded
        return; 
    }

    // ================================================
    // 🎓 MAIN MENU (Active & Onboarded Members)
    // ================================================
    if (msg === 'menu' || msg === 'hi') {
        session.step = null; 
        await sendLwazi(phone, "🦉 *Lwazi Main Menu*\n\n1️⃣ *Request a Lesson* - Search your enrolled topics\n2️⃣ *Tutor* - Send a photo of a math problem for AI help\n3️⃣ *Profile* - View your progress\n4️⃣ *Subscribe* - Manage Family Plan\n\n_Reply with a word or number above._");
        return;
    }
	
	// ================================================
    // 🎓 MAIN MENU (Active & Onboarded Members)
    // ================================================
    if (msg === 'menu' || msg === 'hi') {
        session.step = null; 
        await sendLwazi(phone, "🦉 *Lwazi Main Menu*\n\n1️⃣ *Request a Lesson* - Search your enrolled topics\n2️⃣ *Tutor* - Send a photo of a math problem for AI help\n3️⃣ *Profile* - View your progress\n4️⃣ *Subscribe* - Manage Family Plan\n\n_Reply with a word or number above._");
        return;
    }

    // 🚀 THE FIX: Catch 'Start' for onboarded users to select a program
    if (msg === 'start') {
        const programs = await prisma.program.findMany({
            where: { churchId: member.churchId, status: 'LIVE' }
        });
        
        if (programs.length === 0) {
            await sendLwazi(phone, "⚠️ There are currently no learning programs available.");
            return;
        }

        // We route them into the CHANGE_PROGRAM step so it safely pauses any old bugs and sets the activeProgramId cleanly
        session.step = 'LWAZI_CHANGE_PROGRAM';
        session.availablePrograms = programs.map(p => p.id);
        
        let progMsg = `🔄 *Select your Learning Program*\n\nChoose a curriculum to begin:\n\n`;
        programs.forEach((p, idx) => {
            progMsg += `${idx + 1}️⃣ *${p.title}*\n`;
        });
        progMsg += `\n_Reply with the number of the program._`;
        
        await sendLwazi(phone, progMsg);
        return;
    }

    // ================================================
    // 🔍 REQUEST A LESSON (PROGRAM-SCOPED SEARCH)
    // ================================================
    if (!session.step && (msg === '1' || msg === 'request a lesson' || msg === 'request' || msg === 'lesson')) {
        session.step = 'LWAZI_SEARCH_LESSON';
        await sendLwazi(phone, "🔍 *Request a Lesson*\n\nWhat topic would you like to learn about today? (e.g., 'Fractions', 'Photosynthesis', 'History')\n\n_Type your search term below, or reply *Menu* to cancel._");
        return;
    }

    if (session.step === 'LWAZI_SEARCH_LESSON') {
        const userEnrollments = await prisma.enrollment.findMany({
            where: { memberId: member.id },
            select: { course: { select: { programId: true } } }
        });
        
        const subscribedProgramIds = [...new Set(userEnrollments.map(e => e.course?.programId).filter(Boolean))];

        if (subscribedProgramIds.length === 0) {
            const programs = await prisma.program.findMany({
                where: { churchId: member.churchId, status: 'LIVE' }
            });
            
            if (programs.length === 0) {
                session.step = null;
                await sendLwazi(phone, "⚠️ You are not enrolled in any programs, and there are none currently active. Please contact support.");
                return;
            }

            session.step = 'ONB_PROGRAM';
            session.availablePrograms = programs.map(p => p.id);
            
            let progMsg = `⚠️ You are an active member, but you haven't selected a learning program yet!\n\nPlease select a Program to enroll in now:\n\n`;
            programs.forEach((p, idx) => {
                progMsg += `${idx + 1}️⃣ *${p.title}*\n`;
            });
            progMsg += `\n_Reply with the number of the program._`;
            
            await sendLwazi(phone, progMsg);
            return;
        }

        const modules = await prisma.module.findMany({
            where: {
                course: { 
                    programId: { in: subscribedProgramIds },
                    status: 'LIVE' 
                },
                title: { contains: msg, mode: 'insensitive' }
            },
            take: 5,
            include: { course: true }
        });

        if (modules.length === 0) {
            await sendLwazi(phone, `No lessons found for "${msg}" in your program. Try a different keyword, or reply *Menu* to cancel.`);
            return;
        }

        session.step = 'LWAZI_SELECT_LESSON';
        session.searchResults = modules.map(m => m.id);

        let resultMsg = `📚 *Search Results for "${msg}"*\n\n`;
        modules.forEach((m, idx) => {
            resultMsg += `${idx + 1}️⃣ *${m.title}* _(${m.course.title})_\n`;
        });
        resultMsg += `\n_Reply with a number (1-${modules.length}) to receive the lesson, or *Menu* to cancel._`;
        
        await sendLwazi(phone, resultMsg);
        return;
    }

    if (session.step === 'LWAZI_SELECT_LESSON') {
        const selection = parseInt(msg) - 1;
        
        if (isNaN(selection) || selection < 0 || !session.searchResults || selection >= session.searchResults.length) {
            await sendLwazi(phone, "⚠️ Invalid selection. Please reply with the number of the lesson you want, or *Menu* to cancel.");
            return;
        }

        const moduleId = session.searchResults[selection];
        const moduleData = await prisma.module.findUnique({ where: { id: moduleId } });

        if (!moduleData) {
            session.step = null;
            await sendLwazi(phone, "⚠️ Error loading lesson. Reply *Menu* to go back.");
            return;
        }

        const existingEnrollment = await prisma.enrollment.findFirst({
            where: { memberId: member.id, courseId: moduleData.courseId }
        });

        if (!existingEnrollment) {
            await prisma.enrollment.create({
                data: {
                    memberId: member.id,
                    courseId: moduleData.courseId,
                    status: 'ACTIVE',
                    progress: moduleData.order,
                    currentModuleId: moduleData.id
                }
            });
        } else {
            await prisma.enrollment.update({
                where: { id: existingEnrollment.id },
                data: { 
                    status: 'ACTIVE', 
                    progress: moduleData.order,
                    currentModuleId: moduleData.id,
                    updatedAt: new Date() 
                }
            });
        }

        let lessonText = `📖 *${moduleData.title}*\n\n${moduleData.dailyLessonText || moduleData.content || "Content not available."}`;
        
        let mUrl = null;
        if (moduleData.contentUrl && moduleData.contentUrl.startsWith('http')) {
            mUrl = moduleData.contentUrl;
        }

        await sendLwazi(phone, lessonText, mUrl);

        if (moduleData.quizQuestion) {
            await new Promise(res => setTimeout(res, 1500));
            session.currentQuizAnswer = moduleData.quizAnswer; 
            session.step = 'LWAZI_AWAITING_QUIZ';
            await sendLwazi(phone, `🧠 *Quick Quiz!*\n\n${moduleData.quizQuestion}\n\n_Reply with your answer._`);
        } else {
            session.step = null;
            await sendLwazi(phone, "_Reply *Menu* to request another lesson._");
        }
        return;
    }
    
    if (session.step === 'LWAZI_AWAITING_QUIZ') {
        session.step = null; 
        const correctAnswer = session.currentQuizAnswer || "Not provided";
        await sendLwazi(phone, `✅ *Feedback*\n\nHere is the correct answer:\n${correctAnswer}\n\n_Reply *Menu* to request another lesson, or continue chatting with the AI Tutor!_`);
        return;
    }

    // ================================================
    // 🧠 AI TUTOR FALLBACK
    // ================================================
    const lmsResult = await processLmsMessage(phone, msg, session, member, mediaUrl, sendLwazi);
    if (!lmsResult.handled) {
        await sendLwazi(phone, "I didn't quite catch that. Reply *Menu* to return to the main dashboard.");
    }
} 

/**
 * 🧮 Dynamic Checkout Generator (Flat Price - Lwazi Absorbs Fees)
 */
async function generateLwaziCheckout(payerPhone, payerMember, session, sendLwazi) {
    let totalBaseCost = 0;
    let targetIds = [];

    for (let i = 0; i < session.nominatedNumbers.length; i++) {
        const num = session.nominatedNumbers[i];
        let cost = 69.00;
        if (i === 3 || i === 4) cost = 69.00 * 0.95; 
        totalBaseCost += cost;

        let student = await prisma.member.findFirst({ where: { phone: num, churchCode: 'LWAZI_HQ' } });
        if (!student) {
            let lwaziOrg = await prisma.church.findUnique({ where: { code: 'LWAZI_HQ' } });
            student = await prisma.member.create({
                 data: { 
                     phone: num, 
                     firstName: 'Lwazi', 
                     lastName: 'Student', 
                     church: { connect: { id: lwaziOrg.id } }, 
                     status: 'PENDING_SUBSCRIPTION',
                     parent: { connect: { id: payerMember.id } } 
                 }
            });
        }
        targetIds.push(student.id);
    }

    let breakdownMsg = "🛒 *Subscription Summary*\n\n";
    breakdownMsg += `👨‍👩‍👧‍👦 Total Students: ${session.nominatedNumbers.length}\n`;
    if (session.nominatedNumbers.length >= 4) breakdownMsg += `_Includes Family Discount for students 4 & 5!_\n`;
    
    breakdownMsg += `\n*Total Monthly Subscription: R${totalBaseCost.toFixed(2)}*\n\n`;

    const host = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
    
    const payload = { 
        t: targetIds.join(','), 
        p: payerMember.id, 
        a: totalBaseCost, 
        y: 'LWAZI_MULTI' 
    };

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', SECRET_KEY, iv);
    let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'base64url');
    encrypted += cipher.final('base64url');
    
    const token = `${iv.toString('base64url')}.${encrypted}`;
    const payLink = `${host}/pay?token=${token}`;

    breakdownMsg += `💳 *Tap to securely activate subscriptions:*\n👉 ${payLink}\n\n`;
    breakdownMsg += `_Students will receive a welcome message instantly upon payment._`;

    await sendLwazi(payerPhone, breakdownMsg);
    
    session.step = null; 
    session.nominatedNumbers = [];
}

/**
 * 🚀 EXPORTED TRIGGER: Call this from your Payment Webhook on SUCCESS
 */
async function sendLwaziWelcome(phone) {
    const welcomeMsg = "🎉 *Payment Successful!*\n\nWelcome to Lwazi Premium! Let's customize your learning experience.\n\nWhat grade are you in?\n_Reply with a number between 4 and 12 (e.g., 10)_";
    await sendLwazi(phone, welcomeMsg);
}

module.exports = { processLwaziMessage, sendLwaziWelcome };