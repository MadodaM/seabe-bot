// services/dripCampaign.js
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 🛠️ Modular Import (Using the file we created to prevent crashes!)
const { sendWhatsApp } = require('./twilioClient');

const startDripCampaign = () => {
    console.log("⏰ LMS Drip Engine Started: Checking for due modules every minute...");

    // ========================================================
    // 🚀 DYNAMIC 30-MINUTE DELIVERY ENGINE
    // ========================================================
    // Cron syntax: '* * * * *' means run every single minute
    cron.schedule('* * * * *', async () => {
        try {
            // Calculate the exact time 30 minutes ago
            const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

            // Find all active students who are waiting for a lesson and haven't been updated in 30 mins
            const pendingDeliveries = await prisma.enrollment.findMany({
                where: {
                    status: 'ACTIVE',
                    quizState: 'IDLE', // IDLE means they need a lesson. AWAITING_QUIZ means they need to answer.
                    updatedAt: { lte: thirtyMinutesAgo } 
                },
                include: { 
                    course: { include: { modules: true } }, 
                    member: true 
                }
            });

            if (pendingDeliveries.length > 0) {
                console.log(`🚀 Found ${pendingDeliveries.length} students due for a lesson. Sending now...`);
            }

            for (const enrollment of pendingDeliveries) {
                // Find the exact module they are supposed to be on
                const moduleToSend = enrollment.course.modules.find(m => m.order === enrollment.progress);

                if (moduleToSend && enrollment.member) {
                    // 1. Format the combined Lesson + Quiz Message
                    const lessonMessage = `📖 *${enrollment.course.title}*\nModule ${moduleToSend.order}: ${moduleToSend.title}\n\n${moduleToSend.dailyLessonText}\n\n❓ *Quick Assessment:*\n${moduleToSend.quizQuestion}\n\n_(Reply to this message with your answer to proceed!)_`;

                    // 2. Send via Twilio
                    await sendWhatsApp(enrollment.member.phone, lessonMessage);

                    // 3. Update the Database to lock them in "AWAITING_QUIZ" state
                    await prisma.enrollment.update({
                        where: { id: enrollment.id },
                        data: { 
                            quizState: 'AWAITING_QUIZ',
                            updatedAt: new Date() // Reset the clock so it doesn't send again
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