// bots/LMSlogicBot.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 🛠️ Modular Imports
const { calculateTransaction } = require('../services/pricingEngine');

/**
 * Handles all LMS / Academy logic. 
 * Returns { handled: true, clearSessionFlag: boolean } if the message was processed here.
 */
async function processLmsMessage(incomingMsg, rawMsg, cleanPhone, session, member, sendWhatsApp) {
    
    // 🚀 THE ESCAPE HATCH: Don't grade system commands!
    const systemCommands = ['menu', 'profile', 'my profile', 'my courses', 'courses', 'exit', 'cancel', 'home', 'join'];

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
            const currentModule = await prisma.module.findFirst({
                where: { courseId: activeEnrollment.courseId, order: activeEnrollment.progress }
            });

            if (currentModule && currentModule.quizQuestion) {
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

                    const result = await aiModel.generateContent(prompt);
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
                            data: { quizState: 'IDLE', updatedAt: new Date() }
                        });

                        const replyMsg = `✅ *Correct!*\n\n${aiResponse.feedback}\n\n_Your next lesson will arrive automatically tomorrow. Keep up the great work!_ 🎓`;
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
                session.step = 'LMS_ACTIVE';
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

        const targetDay = enrollment.progress === 0 ? 1 : enrollment.progress;
        const module = enrollment.course.modules.find(m => m.day === targetDay || m.dayNumber === targetDay || m.order === targetDay);

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
            await sendWhatsApp(cleanPhone, msg, module.contentUrl);
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
            const targetDay = enrollment.progress === 0 ? 1 : enrollment.progress;
            const module = enrollment.course.modules.find(m => m.day === targetDay || m.dayNumber === targetDay || m.order === targetDay);
            
            if (module) {
                let msg = `🎓 *RESUMING: ${enrollment.course.title}* (Day ${targetDay})\n\n*${module.title}*\n\n${module.content || module.dailyLessonText}`;
                if (module.quizQuestion) {
                    msg += `\n\n🧠 *Quiz:* ${module.quizQuestion}\n_Reply with answer!_`;
                    await prisma.enrollment.update({ where: { id: enrollment.id }, data: { quizState: 'AWAITING_ANSWER' }});
                }
                await sendWhatsApp(cleanPhone, msg, module.contentUrl);;
                session.step = null; 
            } else {
                await sendWhatsApp(cleanPhone, "✅ You are up to date!");
            }
            return { handled: true, clearSessionFlag: false };
        }

        if (incomingMsg === '2' || incomingMsg === 'previous') {
            const currentDay = enrollment.progress || 1;
            const prevDay = currentDay > 1 ? currentDay - 1 : 1;

            if (prevDay === currentDay && currentDay === 1) {
                await sendWhatsApp(cleanPhone, "⚠️ You are on Day 1. There is no previous lesson.");
                return { handled: true, clearSessionFlag: false };
            }

            const module = enrollment.course.modules.find(m => m.day === prevDay || m.dayNumber === prevDay || m.order === prevDay);
            if (module) {
                let msg = `⏮️ *PREVIOUS LESSON: ${enrollment.course.title}* (Day ${prevDay})\n\n*${module.title}*\n\n${module.content || module.dailyLessonText}`;
                await sendWhatsApp(cleanPhone, msg, module.contentUrl);
            } else {
                await sendWhatsApp(cleanPhone, `⚠️ Could not find content for Day ${prevDay}.`);
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