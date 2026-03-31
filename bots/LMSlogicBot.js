// bots/LMSlogicBot.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 🛠️ Modular Imports
const { calculateTransaction } = require('../services/pricingEngine');

// Safely initialize Twilio
let twilioClient;
if (process.env.TWILIO_SID && process.env.TWILIO_AUTH) {
    twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
}

// Background Sender with Smart Chunking to bypass Twilio's 1600 char limit
const sendWhatsApp = async (to, body) => {
    if (!twilioClient) return console.log("⚠️ Twilio Keys Missing! Could not send message.");
    const cleanTwilioNumber = process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '');

    // Twilio's hard limit is 1600. We use 1500 to be perfectly safe.
    const MAX_LENGTH = 1500;
    const messageChunks = [];

    // 1. Chunk the message securely without breaking words
    if (body.length > MAX_LENGTH) {
        let remainingText = body;
        while (remainingText.length > 0) {
            if (remainingText.length <= MAX_LENGTH) {
                messageChunks.push(remainingText);
                break;
            }
            
            // Try to find a natural break (like a double newline or space) near the limit
            let chunk = remainingText.substring(0, MAX_LENGTH);
            let splitIndex = MAX_LENGTH;
            
            let lastDoubleNewline = chunk.lastIndexOf('\n\n');
            let lastNewline = chunk.lastIndexOf('\n');
            let lastSpace = chunk.lastIndexOf(' ');

            if (lastDoubleNewline > MAX_LENGTH - 300) { 
                splitIndex = lastDoubleNewline; // Best: Break at a paragraph
            } else if (lastNewline > MAX_LENGTH - 200) { 
                splitIndex = lastNewline;       // Good: Break at a line
            } else if (lastSpace > MAX_LENGTH - 100) { 
                splitIndex = lastSpace;         // Fallback: Break at a word
            }

            messageChunks.push(remainingText.substring(0, splitIndex).trim());
            remainingText = remainingText.substring(splitIndex).trim();
        }
    } else {
        messageChunks.push(body); // Short message, no chunking needed
    }

    // 2. Send chunks sequentially with a tiny delay so they arrive in perfect order
    for (const chunk of messageChunks) {
        try {
            await twilioClient.messages.create({
                from: `whatsapp:${cleanTwilioNumber}`, 
                to: `whatsapp:${to}`,
                body: chunk
            });
            // 500ms delay to guarantee WhatsApp delivers them in the correct order
            await new Promise(resolve => setTimeout(resolve, 500)); 
        } catch (err) {
            console.error("❌ Twilio Send Error:", err.message);
        }
    }
};

/**
 * Handles all LMS / Academy logic. 
 * Returns { handled: true, clearSessionFlag: boolean } if the message was processed here.
 */
// 🚀 FIXED: Function signature exactly matches the router!
async function processLmsMessage(cleanPhone, incomingMsg, session, member) {
    
    // Create a raw message for the AI grader to read proper capitalization/punctuation
    const rawMsg = incomingMsg; // The router passes lowercased, but the AI is smart enough to read it.
    
    // 🚀 THE ESCAPE HATCH: Don't grade system commands!
    const systemCommands = ['menu', 'profile', 'my profile', 'my courses', 'courses', 'exit', 'cancel', 'home', 'join', 'stokvel', 'npo', 'society', 'amen'];

    // ================================================
    // 🛑 0. LMS INTERCEPTOR: AI Quiz Evaluator
    // ================================================
    if (member && !systemCommands.includes(incomingMsg)) {
        // Find enrollment securely locked in a quiz
        const activeEnrollment = await prisma.enrollment.findFirst({
            where: { member: { phone: cleanPhone }, status: 'ACTIVE', quizState: 'AWAITING_ANSWER' },
            include: { course: true, member: true }
        });

        if (activeEnrollment) {
            let currentModule;
            
            if (activeEnrollment.currentModuleId) {
                currentModule = await prisma.module.findUnique({
                    where: { id: activeEnrollment.currentModuleId }
                });
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

            await sendWhatsApp(cleanPhone, "⏳ *Grading your answer...*");

            try {
                const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
                const aiModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

                const prompt = `You are an encouraging and knowledgeable teacher evaluating a student's answer.
                Course: ${activeEnrollment.course.title}
                Lesson Material: ${currentModule.dailyLessonText || currentModule.content || 'General Knowledge'}
                Question: ${currentModule.quizQuestion}
                Correct Answer Context: ${currentModule.quizAnswer || 'Use your own knowledge based on the lesson'}
                
                Student's Answer: "${rawMsg}"

                Evaluate if the student's answer is fundamentally correct or demonstrates a good understanding of the material.
                Return ONLY a raw JSON object (no markdown, no backticks) in this exact format:
                {"isCorrect": true/false, "feedback": "A short, encouraging explanation of why they are right or wrong."}`;

                // 🔄 AUTO-RETRY LOGIC FOR 503 ERRORS
                let result;
                let retries = 3;
                
                while (retries > 0) {
                    try {
                        result = await aiModel.generateContent(prompt);
                        break; 
                    } catch (apiError) {
                        if (apiError.status === 503 && retries > 1) {
                            console.log(`⏳ Gemini busy. Retrying in 2s... (${retries - 1} attempts left)`);
                            await new Promise(resolve => setTimeout(resolve, 2000)); 
                            retries--;
                        } else {
                            throw apiError; 
                        }
                    }
                }
                const aiResponse = JSON.parse(result.response.text().replace(/```json/gi, '').replace(/```/g, '').trim());

                await prisma.assessmentLog.create({
                    data: {
                        enrollmentId: activeEnrollment.id,
                        moduleId: currentModule.id,
                        response: rawMsg,
                        isCorrect: aiResponse.isCorrect 
                    }
                });

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

                    const replyMsg = `✅ *Correct!*\n\n${aiResponse.feedback}\n\n_Your next lesson will arrive automatically tomorrow, or reply *Next* to continue right now!_ 🚀🎓`;
                    await sendWhatsApp(cleanPhone, replyMsg);
                } else {
                    const replyMsg = `❌ *Not quite!*\n\n${aiResponse.feedback}\n\n_Please try again. Reply with your new answer!_ 💡`;
                    await sendWhatsApp(cleanPhone, replyMsg);
                }
            } catch (error) {
                console.error("AI Evaluation Error:", error);
                await sendWhatsApp(cleanPhone, "⚠️ I had a little trouble grading that just now. Please try sending your answer again.");
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
            await sendWhatsApp(cleanPhone, "⚠️ You must be linked to an organization to view courses. Reply *Join* first.");
            return { handled: true, clearSessionFlag: false };
        }
        const courses = await prisma.course.findMany({
            where: { churchId: member.church.id },
            orderBy: { price: 'asc' }
        });

        if (courses.length === 0) {
            await sendWhatsApp(cleanPhone, "📚 *Learning Centre*\n\nThere are currently no active courses available. Check back later!");
            return { handled: true, clearSessionFlag: false };
        }

        let msg = `📚 *Learning & Mentorship Centre*\nSelect a course to enroll:\n\n`;
        courses.forEach((c, index) => {
            msg += `*${index + 1}. ${c.title}*\nCost: ${c.price == 0 ? 'FREE' : 'R' + c.price}\n\n`;
        });
        msg += `Reply with the *Number* of the course you wish to join.`;

        session.step = 'AWAITING_COURSE_SELECTION';
        session.availableCourses = courses; 
        await sendWhatsApp(cleanPhone, msg);
        return { handled: true, clearSessionFlag: false };
    }

    if (session.step === 'AWAITING_COURSE_SELECTION') {
        const selectedIndex = parseInt(incomingMsg) - 1;
        const courses = session.availableCourses || [];

        if (selectedIndex >= 0 && selectedIndex < courses.length) {
            const selectedCourse = courses[selectedIndex];

            const existingEnrollment = await prisma.enrollment.findFirst({
                where: {
                    memberId: member.id,
                    courseId: selectedCourse.id
                },
                include: {
                    course: {
                        include: { modules: { orderBy: { order: 'asc' } } }
                    }
                }
            });

            if (existingEnrollment) {
                if (existingEnrollment.status === 'COMPLETED') {
                    await sendWhatsApp(cleanPhone, `🎓 You have already completed *${selectedCourse.title}*!\n\nCheck your dashboard to download your certificate, or type *Courses* to learn something new.`);
                    return { handled: true, clearSessionFlag: true };
                }

                if (existingEnrollment.status === 'ACTIVE') {
                    await sendWhatsApp(cleanPhone, `✅ You are already actively enrolled in *${selectedCourse.title}*.\n\n_Check the messages above for your latest lesson, or wait for your next daily drop!_`);
                    return { handled: true, clearSessionFlag: true };
                }

                if (existingEnrollment.status === 'PENDING_PAYMENT') {
                    const pricing = calculateTransaction(selectedCourse.price, 'LMS_COURSE', 'DEFAULT', true);
                    const host = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
                    const paymentLink = `${host}/pay?enrollmentId=${existingEnrollment.id}&amount=${pricing.totalChargedToUser}`;
                    
                    await sendWhatsApp(cleanPhone, `⏳ You have an unpaid enrollment for *${selectedCourse.title}*.\n\n*Total Due: R${pricing.totalChargedToUser.toFixed(2)}*\n\n💳 *Resume your checkout securely here:*\n👉 ${paymentLink}\n\nOnce paid, your modules will unlock automatically!`);
                    return { handled: true, clearSessionFlag: true };
                }

                if (existingEnrollment.status === 'UNSUBSCRIBED' || existingEnrollment.status === 'DROPPED') {
                    await prisma.enrollment.update({
                        where: { id: existingEnrollment.id },
                        data: { 
                            status: 'ACTIVE',
                            reminderCount: 0, 
                            updatedAt: new Date()
                        }
                    });

                    const currentProgress = existingEnrollment.progress || 0;
                    const resumedModule = existingEnrollment.course.modules[currentProgress];

                    let resumeMsg = `🎉 *Welcome back!*\n\nYour enrollment in *${selectedCourse.title}* has been reactivated. Let's pick up exactly where you left off (Day ${currentProgress + 1}).\n\n`;
                    
                    if (resumedModule) {
                        resumeMsg += `*${resumedModule.title}*\n\n${resumedModule.content || resumedModule.dailyLessonText}\n\n`;
                        if (resumedModule.quizQuestion || resumedModule.quiz) {
                            resumeMsg += `🧠 *Your Pending Quiz:*\n${resumedModule.quizQuestion || resumedModule.quiz}\n\n_Reply with your answer to continue!_`;
                        }
                        await sendWhatsApp(cleanPhone, resumeMsg); 
                    } else {
                        await sendWhatsApp(cleanPhone, resumeMsg);
                    }
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
                await sendWhatsApp(cleanPhone, `🎉 You are now enrolled in *${selectedCourse.title}*!\n\nLook out for your first module arriving shortly.`);
            } else {
                const pricing = calculateTransaction(selectedCourse.price, 'LMS_COURSE', 'DEFAULT', true);
                const host = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
                const paymentLink = `${host}/pay?enrollmentId=${enrollment.id}&amount=${pricing.totalChargedToUser}`;
                
                await sendWhatsApp(cleanPhone, `🎓 *${selectedCourse.title}*\n\nCourse Fee: *R${pricing.baseAmount.toFixed(2)}*\nService Fee: *R${pricing.totalFees.toFixed(2)}*\n*Total Due: R${pricing.totalChargedToUser.toFixed(2)}*\n\nTo unlock your modules, please complete your payment.\n\n💳 *Pay securely here:*\n👉 ${paymentLink}\n\nOnce paid, your modules will unlock automatically!`);
            }
            return { handled: true, clearSessionFlag: true }; 
        } else {
            await sendWhatsApp(cleanPhone, "Invalid selection. Please reply with a valid course number.");
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
            await sendWhatsApp(cleanPhone, "❌ You are not enrolled in any active courses.\n\nReply *Courses* to browse our catalogue.");
            return { handled: true, clearSessionFlag: false };
        }

        if (enrollment.quizState === 'AWAITING_ANSWER') {
            await sendWhatsApp(cleanPhone, "⚠️ Hold up! You need to answer and pass your current quiz before I can give you the next lesson! 🧠");
            return { handled: true, clearSessionFlag: false };
        }

        const nextModuleIndex = enrollment.progress || 0; 
        const nextModule = enrollment.course.modules[nextModuleIndex];

        if (nextModule) {
            let lessonMessage = `🎓 *${enrollment.course.title}* (Day ${nextModuleIndex + 1})\n\n`;
            lessonMessage += `*${nextModule.title}*\n\n`;
            lessonMessage += `${nextModule.content || nextModule.dailyLessonText}\n\n`;

            if (nextModule.quizQuestion || nextModule.quiz) {
                lessonMessage += `🧠 *Today's Quiz:*\n${nextModule.quizQuestion || nextModule.quiz}\n\n`;
                lessonMessage += `_Reply with your answer to chat with our AI tutor!_`;
            } else {
                lessonMessage += `_Reply *Next* when you are ready to continue!_`; 
            }

            await sendWhatsApp(cleanPhone, lessonMessage); 

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
            await sendWhatsApp(cleanPhone, `🎉 *CONGRATULATIONS, ${member.firstName}!* 🎉\n\nYou have officially passed all modules and completed *${enrollment.course.title}*!\n\nWe hope you enjoyed the journey. Reply *Menu* to explore more resources or check your dashboard for your certificate.`);
            
            await prisma.enrollment.update({
                where: { id: enrollment.id },
                data: { status: 'COMPLETED', completedAt: new Date() }
            });
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
            await sendWhatsApp(cleanPhone, "❌ You are not enrolled in any active courses.\n\nReply *Courses* to browse our catalogue.");
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
            let msg = `🎓 *${incomingMsg === 'replay' ? 'REPLAY' : 'RESUMING'}: ${enrollment.course.title}* (Day ${targetDay})\n\n`;
            msg += `*${module.title}*\n\n${module.content || module.dailyLessonText}\n\n`;
            
            if (module.quizQuestion || module.quiz) {
                msg += `🧠 *Quiz:* ${module.quizQuestion || module.quiz}\n_Reply with your answer to get instant feedback!_`;
                await prisma.enrollment.update({
                    where: { id: enrollment.id },
                    data: { quizState: 'AWAITING_ANSWER' } 
                });
            }
            await sendWhatsApp(cleanPhone, msg); 
        } else {
            await sendWhatsApp(cleanPhone, `✅ You are all caught up! The next lesson will arrive tomorrow.`);
        }
        return { handled: true, clearSessionFlag: false };
    }

    // ================================================
    // 👤 3. MY PROFILE & COURSES MENU
    // ================================================
    const profileKeywords = ['my profile', 'profile', 'my courses', 'settings'];
    if (profileKeywords.includes(incomingMsg)) {
        if (!member) {
            await sendWhatsApp(cleanPhone, "⚠️ You are not registered yet. Reply *Join* to start.");
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
            menuMsg += `\n\n👇 *Reply with an option:*\n`;
            menuMsg += `*View 1* - To open course #1\n`;
            menuMsg += `*Update Name* - To change your profile name`;
        } else {
            menuMsg += `\nYou have no active courses.\nReply *Courses* to browse catalog.\n\n👇 *Options:*\n*Update Name* - Change profile details`;
        }

        session.step = 'PROFILE_MENU';
        session.myCourses = enrollments.map(e => ({ id: e.id, title: e.course.title, progress: e.progress || 0 }));
        await sendWhatsApp(cleanPhone, menuMsg);
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
                
                let msg = `📚 *${selectedCourse.title}*\n`;
                msg += `You are currently on Day ${selectedCourse.progress}.\n\n👇 *What would you like to do?*\n`;
                msg += `1. *Resume* (Get today's lesson)\n2. *Previous* (Go back to yesterday's lesson)\n3. *Back* (Return to profile)`;
                
                await sendWhatsApp(cleanPhone, msg);
            } else {
                await sendWhatsApp(cleanPhone, "⚠️ Invalid course number. Please reply with 'View 1', 'View 2', etc.");
            }
            return { handled: true, clearSessionFlag: false };
        }

        if (incomingMsg === 'update name') {
            session.step = 'UPDATE_NAME_FIRST';
            await sendWhatsApp(cleanPhone, "📝 Please reply with your *First Name*:");
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
            await sendWhatsApp(cleanPhone, "⚠️ Error loading course. Type *Profile* to restart.");
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
                
                await sendWhatsApp(cleanPhone, msg); 
                session.step = null; 
            } else {
                await sendWhatsApp(cleanPhone, "✅ You are up to date!");
            }
            return { handled: true, clearSessionFlag: false };
        }

        if (incomingMsg === '2' || incomingMsg === 'previous') {
            const currentDay = enrollment.progress || 1;
            
            if (currentDay <= 1) {
                await sendWhatsApp(cleanPhone, "⚠️ You are on Day 1. There is no previous lesson.");
                return { handled: true, clearSessionFlag: false };
            }

            const prevIndex = currentDay - 2; 
            const sortedModules = enrollment.course.modules.sort((a, b) => a.order - b.order);
            const module = sortedModules[prevIndex];

            if (module) {
                let msg = `⏮️ *PREVIOUS LESSON: ${enrollment.course.title}* (Day ${currentDay - 1})\n\n*${module.title}*\n\n${module.content || module.dailyLessonText}`;
                await sendWhatsApp(cleanPhone, msg); 
            } else {
                await sendWhatsApp(cleanPhone, `⚠️ Could not find content for Day ${currentDay - 1}.`);
            }
            return { handled: true, clearSessionFlag: false };
        }

        if (incomingMsg === '3' || incomingMsg === 'back') {
            session.step = null;
            await sendWhatsApp(cleanPhone, "🔙 Returned to main menu. Reply *Profile* to see your list again.");
            return { handled: true, clearSessionFlag: false };
        }
    }

    if (session.step === 'UPDATE_NAME_FIRST') {
        session.newFirstName = rawMsg.trim(); 
        session.step = 'UPDATE_NAME_LAST';
        await sendWhatsApp(cleanPhone, `Thanks ${session.newFirstName}. Now, please reply with your *Surname*:`);
        return { handled: true, clearSessionFlag: false };
    }

    if (session.step === 'UPDATE_NAME_LAST') {
        const newLastName = rawMsg.trim();
        
        await prisma.member.updateMany({
            where: { phone: cleanPhone },
            data: { firstName: session.newFirstName, lastName: newLastName }
        });
        
        await sendWhatsApp(cleanPhone, `✅ Profile Updated!\n\nNice to meet you, *${session.newFirstName} ${newLastName}*.\n\nReply *Menu* to continue.`);
        return { handled: true, clearSessionFlag: true }; 
    }

    return { handled: false, clearSessionFlag: false };
}

module.exports = { processLmsMessage };