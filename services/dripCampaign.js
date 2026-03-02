// services/dripCampaign.js
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 🛠️ Modular Import
const { sendWhatsApp } = require('./twilioClient');

const startDripCampaign = () => {
    console.log("⏰ LMS Drip Engine Started: Enforcing 1-Lesson-Per-Day rule...");

    cron.schedule('* * * * *', async () => {
        try {
            // ⏱️ TIMERS:
            // First Lesson Timer: 30 minutes
            const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000); 
            // Subsequent Lessons Timer: 24 Hours
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

            const pendingDeliveries = await prisma.enrollment.findMany({
                where: {
                    status: 'ACTIVE',
                    quizState: 'IDLE',
                    OR: [
                        // Rule 1: If it's their FIRST lesson (progress = 1), send 30 mins after enrollment
                        { progress: 1, updatedAt: { lte: thirtyMinutesAgo } },
                        
                        // Rule 2: If it's lesson 2+, wait 24 FULL HOURS since they passed the last quiz
                        { progress: { gt: 1 }, updatedAt: { lte: twentyFourHoursAgo } }
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
                // Find the exact module they are supposed to be on
                const moduleToSend = enrollment.course.modules.find(m => m.order === enrollment.progress);

                // 🛑 THE INFINITE LOOP BREAKER
                if (!moduleToSend) {
                    console.log(`✅ Progress ${enrollment.progress} exceeds available modules. Marking course as COMPLETED for ${enrollment.member?.phone}`);
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
                    const lessonMessage = `📖 *${enrollment.course.title}*\nModule ${moduleToSend.order}: ${moduleToSend.title}\n\n${moduleToSend.dailyLessonText}\n\n❓ *Quick Assessment:*\n${moduleToSend.quizQuestion}\n\n_(Reply to this message with your answer to proceed!)_`;

                    await sendWhatsApp(enrollment.member.phone, lessonMessage);

                    // Lock them into "Quiz Mode"
                    await prisma.enrollment.update({
                        where: { id: enrollment.id },
                        data: { 
                            quizState: 'AWAITING_QUIZ',
                            updatedAt: new Date() 
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