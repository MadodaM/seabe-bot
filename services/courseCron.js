// services/courseCron.js
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const prisma = require('./prisma-client');

// Safely initialize Twilio for direct background messaging
let twilioClient;
if (process.env.TWILIO_SID && process.env.TWILIO_AUTH) {
    twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
}

const sendWhatsApp = async (to, body, mediaUrl = null) => {
    if (!twilioClient) return console.log("⚠️ Twilio Keys Missing!");
    const cleanTwilioNumber = process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '');
    let cleanTo = to.replace(/\D/g, '');
    if (cleanTo.startsWith('0')) cleanTo = '27' + cleanTo.substring(1);
    
    try {
        // 1. IF THERE IS MEDIA, SEND IT FIRST (Standalone)
        if (mediaUrl) {
            await twilioClient.messages.create({
                from: `whatsapp:${cleanTwilioNumber}`,
                to: `whatsapp:+${cleanTo}`,
                mediaUrl: [mediaUrl]
            });
        }

        // 2. THEN SEND THE TEXT BODY
        if (body && body.trim() !== '') {
            await twilioClient.messages.create({
                from: `whatsapp:${cleanTwilioNumber}`,
                to: `whatsapp:+${cleanTo}`,
                body: body
            });
        }
        
    } catch (err) {
        console.error("❌ Twilio Send Error:", err.message);
    }
};

const startCourseEngine = () => {
    console.log("🎓 WhatsApp LMS Delivery Engine Initialized. Scheduled DAILY at 08:30 AM (SAST).");

    // ==========================================
    // 🚨 1. THE 6-HOUR NUDGE & KICK ENGINE
    // ==========================================
    cron.schedule('0 * * * *', async () => {
        console.log("🔍 Running 6-Hour Accountability Sweep...");
        const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);

        try {
            const stalledStudents = await prisma.enrollment.findMany({
                where: {
                    status: 'ACTIVE',
                    quizState: 'AWAITING_ANSWER',
                    updatedAt: { lte: sixHoursAgo }
                },
                include: { course: true, member: true }
            });

            for (const student of stalledStudents) {
                let cleanPhone = student.member.phone.replace(/\D/g, '');
                if (cleanPhone.startsWith('0')) cleanPhone = '27' + cleanPhone.substring(1);

                if (student.reminderCount >= 3) {
                    // ❌ STRIKE 3: Unsubscribe them
                    await prisma.enrollment.update({
                        where: { id: student.id },
                        data: { status: 'UNSUBSCRIBED' } 
                    });

                    await sendWhatsApp(
                        cleanPhone, 
                        `🛑 *Course Paused.*\n\nWe haven't received your quiz answer for *${student.course.title}*. To keep the academy fair, your enrollment has been paused.\n\nWhen you are ready to commit, reply with *Resume* to pick up where you left off.`
                    );
                    console.log(`❌ Unsubscribed student ${cleanPhone} from ${student.course.title} due to inactivity.`);

                } else {
                    // ⚠️ STRIKE 1 OR 2: Nudge them
                    const newCount = (student.reminderCount || 0) + 1;
                    
                    await prisma.enrollment.update({
                        where: { id: student.id },
                        data: { 
                            reminderCount: newCount,
                            updatedAt: new Date() // Reset the 6-hour clock
                        }
                    });

                    await sendWhatsApp(
                        cleanPhone, 
                        `⏳ *Reminder (${newCount}/3)*\n\nYou have a pending quiz question for *${student.course.title}*! \n\nPlease reply with your answer to unlock your next lesson. If we don't hear from you, your enrollment will be paused.`
                    );
                    console.log(`⚠️ Sent Reminder ${newCount} to ${cleanPhone}`);
                }
            }
        } catch (error) {
            console.error("❌ Error in Nudge Engine:", error);
        }
    });

    // ==========================================
    // 🎓 2. THE DAILY DELIVERY ENGINE
    // ==========================================
    cron.schedule('30 8 * * *', async () => {
        console.log("⏰ [CRON] Waking up Course Delivery Engine...");

        try {
            const activeEnrollments = await prisma.enrollment.findMany({
                where: { status: 'ACTIVE' },
                include: {
                    member: true,
                    course: {
                        include: { 
                            modules: { orderBy: { order: 'asc' } } 
                        }
                    }
                }
            });

            if (activeEnrollments.length === 0) {
                console.log("✅ [CRON] No active course enrollments today. Sleeping.");
                return;
            }

            console.log(`🚀 [CRON] Delivering daily lessons to ${activeEnrollments.length} students...`);
            let lessonsDelivered = 0;

            for (const enrollment of activeEnrollments) {
                const student = enrollment.member;
                const course = enrollment.course;
                const lastProgress = enrollment.progress || 0; 
                
                // 🛑 Verify they passed yesterday's quiz
                if (lastProgress > 0 && enrollment.currentModuleId) {
                    const passedQuiz = await prisma.assessmentLog.findFirst({
                        where: {
                            enrollmentId: enrollment.id,
                            moduleId: enrollment.currentModuleId,
                            isCorrect: true 
                        }
                    });

                    if (!passedQuiz) {
                        console.log(`🚧 Skipping ${student.phone} - Has not passed Day ${lastProgress} yet.`);
                        await sendWhatsApp(student.phone, `Friendly reminder, ${student.firstName}! 🧠\n\nYou still need to pass your quiz for Day ${lastProgress} of *${course.title}* before we can unlock the next lesson.\n\nReply *Courses* to resume your quiz!`);
                        continue; 
                    }
                }

                const todaysModule = course.modules[lastProgress];

                if (todaysModule) {
                    let lessonMessage = `🎓 *${course.title}* (Day ${lastProgress + 1})\n\n`;
                    lessonMessage += `*${todaysModule.title}*\n\n`;
                    lessonMessage += `${todaysModule.content || todaysModule.dailyLessonText}\n\n`;
                    
                    if (todaysModule.quizQuestion || todaysModule.quiz) {
                        lessonMessage += `🧠 *Today's Quiz:*\n${todaysModule.quizQuestion || todaysModule.quiz}\n\n`;
                        lessonMessage += `_Reply with your answer to chat with our AI tutor!_`;
                    } else {
                        lessonMessage += `_Reply *Next* when you are ready to continue!_`; 
                    }

                    await sendWhatsApp(student.phone, lessonMessage, todaysModule.contentUrl);
                    lessonsDelivered++;

                    await prisma.enrollment.update({
                        where: { id: enrollment.id },
                        data: { 
                            progress: lastProgress + 1, 
                            currentModuleId: todaysModule.id, 
                            quizState: (todaysModule.quizQuestion || todaysModule.quiz) ? 'AWAITING_ANSWER' : 'IDLE',
                            updatedAt: new Date()
                        }
                    });
                    
                    console.log(`✅ Sent Day ${lastProgress + 1} to ${student.phone}`);
                    
                } else {
                    await sendWhatsApp(student.phone, `🎉 *CONGRATULATIONS, ${student.firstName}!* 🎉\n\nYou have officially passed all modules and completed *${course.title}*!\n\nWe hope you enjoyed the journey. Reply *Menu* to explore more resources or check your dashboard to download your digital certificate.`);
                    
                    await prisma.enrollment.update({
                        where: { id: enrollment.id },
                        data: { status: 'COMPLETED', completedAt: new Date() }
                    });
                    console.log(`🏁 Course Completed for ${student.phone}`);
                }
            }

            console.log(`🏆 [CRON] Course Delivery sequence complete. Sent ${lessonsDelivered} lessons.`);

        } catch (error) {
            console.error("❌ [CRON] Fatal Course Delivery Engine Error:", error);
        }
    }, {
        scheduled: true,
        timezone: "Africa/Johannesburg" 
    });
}; // <-- This is the little bracket that caused all the chaos!

module.exports = { startCourseEngine };