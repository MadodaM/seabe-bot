// bots/LMSlogicBot.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { calculateTransaction } = require('../services/pricingEngine');

// 🧠 THE SOCRATIC PROMPT
const generateTutorPrompt = (grade, language) => `
You are Lwazi, an expert, patient, and highly encouraging AI Tutor designed for South African students.
You strictly adhere to the South African Department of Basic Education CAPS curriculum.

CURRENT STUDENT CONTEXT:
- Grade Level: Grade ${grade || 'Unknown (Assume High School)'}
- Preferred Language: ${language === 'af' ? 'Afrikaans' : language === 'zu' ? 'isiZulu' : language === 'st' ? 'Sesotho' : 'English'}
Respond entirely in the student's preferred language, adapting your vocabulary to match their grade level.

STRICT GUARDRAILS & SOCRATIC METHOD:
1. NEVER GIVE THE FINAL ANSWER: You are a teacher, not an answer key. If a student asks you to solve a problem or writes "what is the answer to...", you MUST refuse to give the final number.
2. USE THE SOCRATIC METHOD: Break complex problems into smaller, manageable steps. Ask the student a guiding question to help them figure out the *first step* on their own. 
3. PRAISE AND PIVOT: If the student makes a mistake, gently explain where the logical error occurred, praise their effort, and ask them to try that specific step again.
4. SOUTH AFRICAN CONTEXT: Use localized examples (ZAR, local cities, metric system). 

FORMATTING RULES FOR WHATSAPP:
- Keep responses concise (under 150 words).
- Use line breaks and emojis to make the text friendly.
- Use bolding for key terms (e.g., *Denominator*).
`;

// 🛡️ SEABE FALLBACK SENDER (Used ONLY if LMS is accessed via Seabe)
let twilioClient;
const getTwilioClient = () => {
    if (!twilioClient && process.env.TWILIO_SID) {
        twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
    }
    return twilioClient;
};

const sendFallbackWhatsApp = async (to, body, mediaUrl = null) => {
    const client = getTwilioClient();
    if (!client) return console.log("⚠️ Twilio Keys Missing! Could not send message.");
    
    let sender = `whatsapp:${process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '')}`;
    const formattedTo = `whatsapp:+${to.replace('whatsapp:', '').replace('+', '').trim()}`;
    const MAX_LENGTH = 1500;
    const messageChunks = [];

    if (body.length > MAX_LENGTH) {
        let remainingText = body;
        while (remainingText.length > 0) {
            if (remainingText.length <= MAX_LENGTH) { messageChunks.push(remainingText); break; }
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
            const options = { from: sender, to: formattedTo, body: chunk };
            if (mediaUrl) options.mediaUrl = [mediaUrl];
            await client.messages.create(options);
            await new Promise(res => setTimeout(res, 500)); 
        } catch (err) { console.error("❌ Twilio Send Error:", err.message); }
    }
};

async function logStudentActivity(studentId, actionType, subject, score = null) {
    try {
        await prisma.studyLog.create({
            data: { memberId: studentId, actionType, subject, score }
        });
    } catch (e) { console.error("Failed to log study activity:", e); }
}

/**
 * Handles all LMS / Academy logic. 
 * 🚀 FIX: Accepts injectedSender to preserve the Lwazi Number Firewall!
 */
async function processLmsMessage(cleanPhone, incomingMsg, session, member, mediaUrl = null, injectedSender = null) {
    
    // 🧠 THE SMART ROUTER: Use Lwazi's sender if injected, otherwise fallback to Seabe
    const reply = injectedSender ? injectedSender : (phone, text, media) => sendFallbackWhatsApp(phone, text, media);
    const orgCode = member ? member.churchCode : null;

    const rawMsg = incomingMsg; 
    const cleanMsg = (incomingMsg || '').toLowerCase().trim();
    
    const systemCommands = [
        'menu', 'profile', 'my profile', 'my courses', 'courses', 
        'exit', 'cancel', 'home', 'join', 'stokvel', 'npo', 
        'society', 'amen', 'help', 'support', 'next', 'resume',
        'tutor', 'ask', 'solve', '2', '3'
    ];
    
    const activeMenuSteps = [
        'AWAITING_COURSE_SELECTION', 'PROFILE_MENU', 'COURSE_ACTIONS', 
        'UPDATE_NAME_FIRST', 'UPDATE_NAME_LAST', 'AWAITING_TUTOR_QUESTION' 
    ];

    const isSystemCommand = systemCommands.includes(cleanMsg);
    const isInMenu = activeMenuSteps.includes(session.step);

	if (member && (member.status === 'DROPPED' || member.status === 'CANCELLED' || member.status === 'UNSUBSCRIBED') && session.step !== 'AWAITING_COURSE_SELECTION') {
        const courses = await prisma.course.findMany({
            where: { churchId: member.churchId },
            orderBy: { price: 'asc' }
        });

        let msg = `👋 *Welcome back, ${member.firstName}!*\n\nYour account is currently inactive. To restore your access and continue learning, please select your program below:\n\n`;
        
        courses.forEach((c, index) => {
            msg += `*${index + 1}. ${c.title}*\n`;
        });
        
        msg += `\n_Reply with the number to reactivate your subscription._`;

        session.step = 'AWAITING_COURSE_SELECTION';
        session.availableCourses = courses;
        await reply(cleanPhone, msg);
        return { handled: true, clearSessionFlag: false };
    }

    // ================================================
    // 🧠 MULTIMODAL AI TUTOR (Protected Lwazi Feature)
    // ================================================
    const tutorTriggers = ['2', 'tutor', 'ask', 'solve', 'ask tutor']; // 👈 Included '2' here!
    
    if (tutorTriggers.includes(cleanMsg)) {
        // 🛡️ PAYWALL: Only Active Lwazi students get the expensive AI API
        if (orgCode !== 'LWAZI_HQ' || member.status !== 'ACTIVE') {
            await reply(cleanPhone, "⚠️ The Premium AI Tutor is a Lwazi exclusive feature. Please ensure your subscription is active.");
            return { handled: true, clearSessionFlag: false };
        }

        session.step = 'AWAITING_TUTOR_QUESTION';
        await reply(cleanPhone, "🧠 *AI Tutor Mode*\n\nSend me your question, or upload a clear photo of a math/logic problem. I'll break it down and show you how to solve it step-by-step!\n\n_Reply *Exit* to go back to main menu._");
        return { handled: true, clearSessionFlag: false };
    }
    
    if (session.step === 'AWAITING_TUTOR_QUESTION') {
        if (cleanMsg === 'cancel' || cleanMsg === 'exit') {
            session.step = null;
            await reply(cleanPhone, "🔙 Exited Tutor Mode. Reply *Menu* to see your options.");
            return { handled: true, clearSessionFlag: false };
        }

        if (!rawMsg && !mediaUrl) {
            await reply(cleanPhone, "⚠️ Please type a question or send a photo of a problem.");
            return { handled: true, clearSessionFlag: false };
        }

        await reply(cleanPhone, "⏳ *Analyzing your problem...*");

        try {
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const systemInstruction = generateTutorPrompt(session.grade, member?.language);

            const aiModel = genAI.getGenerativeModel({ 
                model: "gemini-2.5-flash",
                systemInstruction: { parts: [{ text: systemInstruction }] },
                generationConfig: { temperature: 0.3 }
            });
    
            const promptParts = [ `Student's Input: "${rawMsg || '[No text provided, rely entirely on the image]'}"` ];

            if (mediaUrl) {
                const authHeader = 'Basic ' + Buffer.from(`${process.env.TWILIO_SID}:${process.env.TWILIO_AUTH}`).toString('base64');
                const response = await fetch(mediaUrl, { headers: { 'Authorization': authHeader } });
                if (!response.ok) throw new Error("Failed to fetch media from Twilio");
                
                const arrayBuffer = await response.arrayBuffer();
                promptParts.push({
                    inlineData: {
                        data: Buffer.from(arrayBuffer).toString("base64"),
                        mimeType: response.headers.get("content-type") || "image/jpeg"
                    }
                });
            }

            const result = await aiModel.generateContent(promptParts);
            
            if (member && member.id) {
                await logStudentActivity(member.id, 'QUESTION_ASKED', 'AI Tutor');
            }
            
            await reply(cleanPhone, `🎓 *Tutor Solution:*\n\n${result.response.text().trim()}\n\n_Send another question or reply *Cancel* to exit._`);
            return { handled: true, clearSessionFlag: false };

        } catch (error) {
            console.error("Tutor AI Error:", error);
            await reply(cleanPhone, "⚠️ I had trouble analyzing that. Please ensure the photo is clear, or try typing the question out.");
            return { handled: true, clearSessionFlag: false };
        }
    }

    // ================================================
    // 🛑 LMS INTERCEPTOR: AI Quiz Evaluator
    // ================================================
    if (member && !isSystemCommand && !isInMenu) {
        const activeEnrollment = await prisma.enrollment.findFirst({
            where: { member: { phone: cleanPhone }, status: 'ACTIVE', quizState: 'AWAITING_ANSWER' },
            include: { course: true, member: true }
        });

        if (activeEnrollment) {
            let currentModule;
            
            if (activeEnrollment.currentModuleId) {
                currentModule = await prisma.module.findUnique({ where: { id: activeEnrollment.currentModuleId } });
            } else {
                const modules = await prisma.module.findMany({
                    where: { courseId: activeEnrollment.courseId },
                    orderBy: { order: 'asc' }
                });
                const targetIndex = activeEnrollment.progress > 0 ? activeEnrollment.progress - 1 : 0;
                currentModule = modules[targetIndex];
            }

            if (!currentModule || !currentModule.quizQuestion) {
                return { handled: false, clearSessionFlag: false };
            }

            await reply(cleanPhone, "⏳ *Grading your answer...*");

            try {
                const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
                // 🚀 FIX: Force Gemini to ONLY output standard JSON, removing parsing crashes
                const aiModel = genAI.getGenerativeModel({ 
                    model: "gemini-2.5-flash",
                    generationConfig: { responseMimeType: "application/json" } 
                });

                const prompt = `You are an encouraging teacher evaluating a student's answer.
                Course: ${activeEnrollment.course.title}
                Lesson Material: ${currentModule.dailyLessonText || currentModule.content || 'General Knowledge'}
                Question: ${currentModule.quizQuestion}
                Correct Answer Context: ${currentModule.quizAnswer || 'Use your own knowledge'}
                
                Student's Answer: "${rawMsg}"

                Evaluate if the student's answer is fundamentally correct.
                Return ONLY JSON using this exact schema: {"isCorrect": boolean, "feedback": "string"}`;

                let result;
                let retries = 3;
                
                while (retries > 0) {
                    try {
                        result = await aiModel.generateContent(prompt);
                        break; 
                    } catch (apiError) {
                        if (apiError.status === 503 && retries > 1) {
                            await new Promise(resolve => setTimeout(resolve, 2000)); 
                            retries--;
                        } else { throw apiError; }
                    }
                }
                
                // Pure JSON parse since we forced the mimeType
                const aiResponse = JSON.parse(result.response.text());

                await prisma.assessmentLog.create({
                    data: {
                        enrollmentId: activeEnrollment.id,
                        moduleId: currentModule.id,
                        response: rawMsg,
                        isCorrect: aiResponse.isCorrect 
                    }
                });
                
                if (member && member.id) {
                    await logStudentActivity(
                        member.id, 
                        'QUIZ_TAKEN', 
                        activeEnrollment.course.title || 'General Subject', 
                        aiResponse.isCorrect ? 100 : 0
                    );
                }

                if (aiResponse.isCorrect) {
                    await prisma.enrollment.update({
                        where: { id: activeEnrollment.id },
                        data: { 
                            quizState: 'IDLE', 
                            updatedAt: new Date(),
                            reminderCount: 0,              
                            lastActivityAt: new Date()     
                        }
                    });

                    await reply(cleanPhone, `✅ *Correct!*\n\n${aiResponse.feedback}\n\n_Your next lesson will arrive automatically tomorrow, or reply *Next* to continue right now!_ 🚀🎓`);
                } else {
                    await reply(cleanPhone, `❌ *Not quite!*\n\n${aiResponse.feedback}\n\n_Please try again. Reply with your new answer!_ 💡`);
                }
            } catch (error) {
                console.error("AI Evaluation Error:", error);
                await reply(cleanPhone, "⚠️ I had a little trouble grading that just now. Please try sending your answer again.");
            }
            return { handled: true, clearSessionFlag: false };
        }
    }
    
    // ================================================
    // 🎓 1. COURSE ENROLLMENT (Phase A)
    // ================================================
    const lmsTriggers = ['mentorship', 'grow', 'learn', 'courses'];
    
    if (lmsTriggers.includes(incomingMsg)) {
        if (!member || !member.church) {
            await reply(cleanPhone, "⚠️ You must be linked to an organization to view courses. Reply *Join* first.");
            return { handled: true, clearSessionFlag: false };
        }
        const courses = await prisma.course.findMany({
            where: { churchId: member.church.id },
            orderBy: { price: 'asc' }
        });

        if (courses.length === 0) {
            await reply(cleanPhone, "📚 *Learning Centre*\n\nThere are currently no active courses available. Check back later!");
            return { handled: true, clearSessionFlag: false };
        }

        let msg = `📚 *Learning & Mentorship Centre*\nSelect a course to enroll:\n\n`;
        courses.forEach((c, index) => {
            msg += `*${index + 1}. ${c.title}*\nCost: ${c.price == 0 ? 'FREE' : 'R' + c.price}\n\n`;
        });
        msg += `Reply with the *Number* of the course you wish to join.`;

        session.step = 'AWAITING_COURSE_SELECTION';
        session.availableCourses = courses; 
        await reply(cleanPhone, msg);
        return { handled: true, clearSessionFlag: false };
    }

    if (session.step === 'AWAITING_COURSE_SELECTION') {
        const selectedIndex = parseInt(incomingMsg) - 1;
        const courses = session.availableCourses || [];

        if (selectedIndex >= 0 && selectedIndex < courses.length) {
            const selectedCourse = courses[selectedIndex];
			const existingDroppedEnrollment = await prisma.enrollment.findFirst({
                where: { 
                    memberId: member.id, 
                    courseId: selectedCourse.id,
                    status: { in: ['DROPPED', 'CANCELLED', 'UNSUBSCRIBED'] }
                }
            });

            if (existingDroppedEnrollment) {
                // 1. Reactivate the Course Enrollment
                await prisma.enrollment.update({
                    where: { id: existingDroppedEnrollment.id },
                    data: { 
                        status: 'ACTIVE', 
                        reminderCount: 0,
                        lastActivityAt: new Date(),
                        updatedAt: new Date()
                    }
                });

                // 2. Reactivate the Main User Profile
                await prisma.member.update({
                    where: { id: member.id },
                    data: { status: 'ACTIVE' }
                });

                await reply(cleanPhone, `🎉 *Welcome Back!* Your subscription to *${selectedCourse.title}* has been restored.\n\nYour progress has been saved. Reply *Resume* to pick up exactly where you left off!`);
                return { handled: true, clearSessionFlag: true };
            }
            const existingEnrollment = await prisma.enrollment.findFirst({
                where: { memberId: member.id, courseId: selectedCourse.id },
                include: { course: { include: { modules: { orderBy: { order: 'asc' } } } } }
            });

            if (existingEnrollment) {
                if (existingEnrollment.status === 'COMPLETED') {
                    await reply(cleanPhone, `🎓 You have already completed *${selectedCourse.title}*!\n\nCheck your dashboard to download your certificate, or type *Courses* to learn something new.`);
                    return { handled: true, clearSessionFlag: true };
                }

                if (existingEnrollment.status === 'ACTIVE') {
                    await reply(cleanPhone, `✅ You are already actively enrolled in *${selectedCourse.title}*.\n\n_Check the messages above for your latest lesson, or wait for your next daily drop!_`);
                    return { handled: true, clearSessionFlag: true };
                }

                if (existingEnrollment.status === 'PENDING_PAYMENT') {
                    const pricing = calculateTransaction(selectedCourse.price, 'LMS_COURSE', 'DEFAULT', true);
                    const host = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
                    const paymentLink = `${host}/pay?enrollmentId=${existingEnrollment.id}&amount=${pricing.totalChargedToUser}`;
                    
                    await reply(cleanPhone, `⏳ You have an unpaid enrollment for *${selectedCourse.title}*.\n\n*Total Due: R${pricing.totalChargedToUser.toFixed(2)}*\n\n💳 *Resume your checkout securely here:*\n👉 ${paymentLink}\n\nOnce paid, your modules will unlock automatically!`);
                    return { handled: true, clearSessionFlag: true };
                }

                if (existingEnrollment.status === 'UNSUBSCRIBED' || existingEnrollment.status === 'DROPPED') {
                    await prisma.enrollment.update({
                        where: { id: existingEnrollment.id },
                        data: { status: 'ACTIVE', reminderCount: 0, updatedAt: new Date() }
                    });

                    const currentProgress = existingEnrollment.progress || 0;
                    const resumedModule = existingEnrollment.course.modules[currentProgress];

                    let resumeMsg = `🎉 *Welcome back!*\n\nYour enrollment in *${selectedCourse.title}* has been reactivated. Let's pick up exactly where you left off (Day ${currentProgress + 1}).\n\n`;
                    
                    if (resumedModule) {
                        resumeMsg += `*${resumedModule.title}*\n\n${resumedModule.content || resumedModule.dailyLessonText}\n\n`;
                        if (resumedModule.quizQuestion || resumedModule.quiz) {
                            resumeMsg += `🧠 *Your Pending Quiz:*\n${resumedModule.quizQuestion || resumedModule.quiz}\n\n_Reply with your answer to continue!_`;
                        }
                    }
                    await reply(cleanPhone, resumeMsg); 
                    return { handled: true, clearSessionFlag: true };
                }
            }

            const enrollment = await prisma.enrollment.create({
                data: {
                    memberId: member.id,
                    courseId: selectedCourse.id,
                    progress: 0,
                    status: selectedCourse.price == 0 ? 'ACTIVE' : 'PENDING_PAYMENT',
                    quizState: 'IDLE'
                }
            });

            if (selectedCourse.price == 0) {
                await reply(cleanPhone, `🎉 You are now enrolled in *${selectedCourse.title}*!\n\nLook out for your first module arriving shortly.`);
            } else {
                const pricing = calculateTransaction(selectedCourse.price, 'LMS_COURSE', 'DEFAULT', true);
                const host = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
                const paymentLink = `${host}/pay?enrollmentId=${enrollment.id}&amount=${pricing.totalChargedToUser}`;
                
                await reply(cleanPhone, `🎓 *${selectedCourse.title}*\n\nCourse Fee: *R${pricing.baseAmount.toFixed(2)}*\nService Fee: *R${pricing.totalFees.toFixed(2)}*\n*Total Due: R${pricing.totalChargedToUser.toFixed(2)}*\n\n💳 *Pay securely here:*\n👉 ${paymentLink}\n\nOnce paid, your modules will unlock automatically!`);
            }
            return { handled: true, clearSessionFlag: true }; 
        } else {
            await reply(cleanPhone, "Invalid selection. Please reply with a valid course number.");
            return { handled: true, clearSessionFlag: false };
        }
    }

    // ================================================
    // 🚀 BINGE LEARNING (The "Next" Trigger)
    // ================================================
    const bingeKeywords = ['next', 'next lesson', 'continue'];
    if (bingeKeywords.includes(incomingMsg)) {
        const enrollment = await prisma.enrollment.findFirst({
            where: { member: { phone: cleanPhone }, status: 'ACTIVE' },
            include: { course: { include: { modules: { orderBy: { order: 'asc' } } } } } 
        });

        if (!enrollment) {
            await reply(cleanPhone, "❌ You are not enrolled in any active courses.\n\nReply *Courses* to browse our catalogue.");
            return { handled: true, clearSessionFlag: false };
        }

        if (enrollment.quizState === 'AWAITING_ANSWER') {
            await reply(cleanPhone, "⚠️ Hold up! You need to answer and pass your current quiz before I can give you the next lesson! 🧠");
            return { handled: true, clearSessionFlag: false };
        }

        const nextModuleIndex = enrollment.progress || 0; 
        const nextModule = enrollment.course.modules[nextModuleIndex];

        if (nextModule) {
            let lessonMessage = `🎓 *${enrollment.course.title}* (Day ${nextModuleIndex + 1})\n\n*${nextModule.title}*\n\n${nextModule.content || nextModule.dailyLessonText}\n\n`;

            if (nextModule.quizQuestion || nextModule.quiz) {
                lessonMessage += `🧠 *Today's Quiz:*\n${nextModule.quizQuestion || nextModule.quiz}\n\n_Reply with your answer!_`;
            } else {
                lessonMessage += `_Reply *Next* when you are ready to continue!_`; 
            }

            await reply(cleanPhone, lessonMessage); 

            await prisma.enrollment.update({
                where: { id: enrollment.id },
                data: {
                    progress: nextModuleIndex + 1,
                    currentModuleId: nextModule.id,
                    quizState: (nextModule.quizQuestion || nextModule.quiz) ? 'AWAITING_ANSWER' : 'IDLE',
                    updatedAt: new Date()
                }
            });
        } else {
            await reply(cleanPhone, `🎉 *CONGRATULATIONS, ${member.firstName}!* 🎉\n\nYou have completed *${enrollment.course.title}*!\n\nReply *Menu* to explore more resources.`);
            await prisma.enrollment.update({ where: { id: enrollment.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
        }
        return { handled: true, clearSessionFlag: false };
    }

    // ================================================
    // 🎓 2. ON-DEMAND LESSONS (Phase C: Resume/Replay)
    // ================================================
    const lessonKeywords = ['resume', 'replay', 'lesson']; 
    if (lessonKeywords.includes(incomingMsg)) {
        const enrollment = await prisma.enrollment.findFirst({
            where: { member: { phone: cleanPhone }, status: 'ACTIVE' },
            include: { course: { include: { modules: true } } }
        });

        if (!enrollment) {
            await reply(cleanPhone, "❌ You are not enrolled in any active courses.");
            return { handled: true, clearSessionFlag: false };
        }

        let module;
        if (enrollment.currentModuleId) {
            module = enrollment.course.modules.find(m => m.id === enrollment.currentModuleId);
        } else {
            const sortedModules = enrollment.course.modules.sort((a, b) => a.order - b.order);
            const targetIndex = enrollment.progress > 0 ? enrollment.progress - 1 : 0;
            module = sortedModules[targetIndex] || sortedModules[0];
        }
        
        const targetDay = enrollment.progress === 0 ? 1 : enrollment.progress;

        if (module) {
            let msg = `🎓 *${incomingMsg === 'replay' ? 'REPLAY' : 'RESUMING'}: ${enrollment.course.title}* (Day ${targetDay})\n\n*${module.title}*\n\n${module.content || module.dailyLessonText}\n\n`;
            
            if (module.quizQuestion || module.quiz) {
                msg += `🧠 *Quiz:* ${module.quizQuestion || module.quiz}\n_Reply with your answer to get instant feedback!_`;
                await prisma.enrollment.update({ where: { id: enrollment.id }, data: { quizState: 'AWAITING_ANSWER' } });
            }
            await reply(cleanPhone, msg); 
        } else {
            await reply(cleanPhone, `✅ You are all caught up! The next lesson will arrive tomorrow.`);
        }
        return { handled: true, clearSessionFlag: false };
    }

    // ================================================
    // 👤 3. MY PROFILE & COURSES MENU
    // ================================================
    const profileKeywords = ['3', 'my profile', 'profile', 'my courses', 'settings']; // 👈 Included '3' here!
    if (profileKeywords.includes(incomingMsg)) {
        if (!member) {
            await reply(cleanPhone, "⚠️ You are not registered yet. Reply *Join* to start.");
            return { handled: true, clearSessionFlag: false };
        }

        const enrollments = await prisma.enrollment.findMany({
            where: { member: { phone: cleanPhone }, status: 'ACTIVE' },
            include: { course: true }
        });

        let menuMsg = `👤 *USER PROFILE: ${member.firstName} ${member.lastName}*\n\n`;
        menuMsg += `*Active Courses:* ${enrollments.length}\n`;
        
        if (enrollments.length > 0) {
            enrollments.forEach((e, i) => {
                menuMsg += `\n📚 *${i + 1}. ${e.course.title}*\n   - Current Day: ${e.progress || 0}\n   - Status: Active`;
            });
            menuMsg += `\n\n👇 *Reply with an option:*\n*View 1* - To open course #1\n*Update Name* - To change your profile name`;
        } else {
            menuMsg += `\nYou have no active courses.\nReply *Courses* to browse catalog.\n\n👇 *Options:*\n*Update Name* - Change profile details`;
        }

        session.step = 'PROFILE_MENU';
        session.myCourses = enrollments.map(e => ({ id: e.id, title: e.course.title, progress: e.progress || 0 }));
        await reply(cleanPhone, menuMsg);
        return { handled: true, clearSessionFlag: false };
    }

    if (session.step === 'PROFILE_MENU') {
        if (incomingMsg.startsWith('view ')) {
            const index = parseInt(incomingMsg.split(' ')[1]) - 1;
            const courses = session.myCourses || [];

            if (courses[index]) {
                const selectedCourse = courses[index];
                session.selectedEnrollmentId = selectedCourse.id;
                session.step = 'COURSE_ACTIONS';
                
                let msg = `📚 *${selectedCourse.title}*\nYou are currently on Day ${selectedCourse.progress}.\n\n👇 *What would you like to do?*\n`;
                msg += `1. *Resume* (Get today's lesson)\n2. *Previous* (Go back to yesterday's lesson)\n3. *Back* (Return to profile)`;
                
                await reply(cleanPhone, msg);
            } else {
                await reply(cleanPhone, "⚠️ Invalid course number. Please reply with 'View 1', 'View 2', etc.");
            }
            return { handled: true, clearSessionFlag: false };
        }

        if (incomingMsg === 'update name') {
            session.step = 'UPDATE_NAME_FIRST';
            await reply(cleanPhone, "📝 Please reply with your *First Name*:");
            return { handled: true, clearSessionFlag: false };
        }
    }

    if (session.step === 'COURSE_ACTIONS') {
        const enrollmentId = session.selectedEnrollmentId;
        const enrollment = await prisma.enrollment.findUnique({
            where: { id: enrollmentId },
            include: { course: { include: { modules: true } } }
        });

        if (!enrollment) {
            await reply(cleanPhone, "⚠️ Error loading course. Type *Profile* to restart.");
            return { handled: true, clearSessionFlag: false };
        }

        if (incomingMsg === '1' || incomingMsg === 'resume') {
            let module;
            if (enrollment.currentModuleId) {
                module = enrollment.course.modules.find(m => m.id === enrollment.currentModuleId);
            } else {
                const sortedModules = enrollment.course.modules.sort((a, b) => a.order - b.order);
                const targetIndex = enrollment.progress > 0 ? enrollment.progress - 1 : 0;
                module = sortedModules[targetIndex] || sortedModules[0];
            }
            
            const targetDay = enrollment.progress === 0 ? 1 : enrollment.progress;
            
            if (module) {
                let msg = `🎓 *RESUMING: ${enrollment.course.title}* (Day ${targetDay})\n\n*${module.title}*\n\n${module.content || module.dailyLessonText}`;
                
                if (module.quizQuestion || module.quiz) {
                    msg += `\n\n🧠 *Quiz:* ${module.quizQuestion || module.quiz}\n_Reply with answer!_`;
                    await prisma.enrollment.update({ where: { id: enrollment.id }, data: { quizState: 'AWAITING_ANSWER' }});
                }
                
                await reply(cleanPhone, msg); 
                session.step = null; 
            } else {
                await reply(cleanPhone, "✅ You are up to date!");
            }
            return { handled: true, clearSessionFlag: false };
        }

        if (incomingMsg === '2' || incomingMsg === 'previous') {
            const currentDay = enrollment.progress || 1;
            if (currentDay <= 1) {
                await reply(cleanPhone, "⚠️ You are on Day 1. There is no previous lesson.");
                return { handled: true, clearSessionFlag: false };
            }

            const prevIndex = currentDay - 2; 
            const sortedModules = enrollment.course.modules.sort((a, b) => a.order - b.order);
            const module = sortedModules[prevIndex];

            if (module) {
                await reply(cleanPhone, `⏮️ *PREVIOUS LESSON: ${enrollment.course.title}* (Day ${currentDay - 1})\n\n*${module.title}*\n\n${module.content || module.dailyLessonText}`); 
            } else {
                await reply(cleanPhone, `⚠️ Could not find content for Day ${currentDay - 1}.`);
            }
            return { handled: true, clearSessionFlag: false };
        }

        if (incomingMsg === '3' || incomingMsg === 'back') {
            session.step = null;
            await reply(cleanPhone, "🔙 Returned to main menu. Reply *Profile* to see your list again.");
            return { handled: true, clearSessionFlag: false };
        }
    }

    if (session.step === 'UPDATE_NAME_FIRST') {
        session.newFirstName = rawMsg.trim(); 
        session.step = 'UPDATE_NAME_LAST';
        await reply(cleanPhone, `Thanks ${session.newFirstName}. Now, please reply with your *Surname*:`);
        return { handled: true, clearSessionFlag: false };
    }

    if (session.step === 'UPDATE_NAME_LAST') {
        const newLastName = rawMsg.trim();
        await prisma.member.updateMany({
            where: { phone: cleanPhone },
            data: { firstName: session.newFirstName, lastName: newLastName }
        });
        await reply(cleanPhone, `✅ Profile Updated!\n\nNice to meet you, *${session.newFirstName} ${newLastName}*.\n\nReply *Menu* to continue.`);
        return { handled: true, clearSessionFlag: true }; 
    }

    return { handled: false, clearSessionFlag: false };
}

module.exports = { processLmsMessage };