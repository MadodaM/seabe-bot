// services/dripCampaign.js
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const prisma = require('./prisma-client');

// 🛠️ Modular Import
const { sendWhatsApp } = require('./twilioClient');

const startDripCampaign = () => {
    console.log("⏰ LMS Drip Engine Started: Enforcing Lesson Delivery rule...");

    // Runs every minute to check if anyone is due for a lesson
    cron.schedule('* * * * *', async () => {
        try {
            // ⏱️ TIMERS:
            // First Lesson Timer: 5 minutes after enrollment
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000); 
            // Subsequent Lessons Timer: 24 Hours after their last quiz answer
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

            // Fetch students who are ACTIVE, not waiting on a quiz, and due for a lesson
            const pendingDeliveries = await prisma.enrollment.findMany({
                where: {
                    status: 'ACTIVE',
                    quizState: 'IDLE',
                    OR: [
                        // Rule 1: FIRST lesson (progress 0). Send 5 mins after enrollment.
                        { progress: 0, updatedAt: { lte: fiveMinutesAgo } },
                        
                        // Rule 2: Lesson 2+ (progress >= 1). Wait 24 hours since last update.
                        { progress: { gte: 1 }, updatedAt: { lte: twentyFourHoursAgo } }
                    ]
                },
                include: { 
                    course: { include: { modules: true } }, 
                    member: true 
                }
            });

            if (pendingDeliveries.length > 0) {
                console.log(`🚀 Found ${pendingDeliveries.length} students due for a lesson. Processing...`);
            }

            for (const enrollment of pendingDeliveries) {
                // Calculate the NEXT module they should receive (Progress + 1)
                const nextModuleOrder = enrollment.progress + 1;
                const moduleToSend = enrollment.course.modules.find(m => m.order === nextModuleOrder);

                // 🛑 THE INFINITE LOOP BREAKER (Graduation)
                if (!moduleToSend) {
                    console.log(`🎓 Marking course as COMPLETED for ${enrollment.member?.phone}`);
                    await prisma.enrollment.update({
                        where: { id: enrollment.id },
                        data: { 
                            status: 'COMPLETED',
                            quizState: 'IDLE',
                            updatedAt: new Date()
                        }
                    });
                    
                    if (enrollment.member) {
                        await sendWhatsApp(enrollment.member.phone, `🎓 *COURSE COMPLETED!*\n\nYou have successfully reached the end of *${enrollment.course.title}*! Keep an eye out for your digital certificate.`);
                    }
                    continue; 
                }

                // 🟢 SEND THE LESSON
                if (moduleToSend && enrollment.member) {
                    // Check if this module actually has a quiz question
                    const hasQuiz = moduleToSend.quizQuestion && moduleToSend.quizQuestion.trim().length > 0;
                    
                    let lessonMessage = `📖 *${enrollment.course.title}*\nModule ${moduleToSend.order}: ${moduleToSend.title}\n\n${moduleToSend.dailyLessonText || moduleToSend.content}`;

                    if (hasQuiz) {
                        lessonMessage += `\n\n❓ *Quick Assessment:*\n${moduleToSend.quizQuestion}\n\n_(Reply to this message with your answer to proceed to the next lesson!)_`;
                    } else {
                        lessonMessage += `\n\n_(Reply "Next" when you are ready to continue.)_`;
                    }

                    await sendWhatsApp(enrollment.member.phone, lessonMessage);

                    // 🔒 UPDATE PROGRESS AND STATE
                    await prisma.enrollment.update({
                        where: { id: enrollment.id },
                        data: { 
                            progress: moduleToSend.order, // Update their progress to the module we just sent
                            quizState: hasQuiz ? 'AWAITING_ANSWER' : 'IDLE', // Lock them if there's a quiz!
                            updatedAt: new Date() // Reset the 24-hour timer!
                        }
                    });
                }
            }
        } catch (error) {
            console.error("❌ Drip Campaign Error:", error);
        }
    });
};

module.exports = { startDripCampaign };