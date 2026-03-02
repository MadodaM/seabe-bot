// services/dripCampaign.js
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 🛠️ Modular Import
const { sendWhatsApp } = require('./twilioClient');

const startDripCampaign = () => {
    console.log("⏰ LMS Drip Engine Started: Checking for due modules every minute...");

    cron.schedule('* * * * *', async () => {
        try {
            // For testing: Set this to 1 minute ago. For production, change the '1' back to '30'
            const timeLimit = new Date(Date.now() - 1 * 60 * 1000); 

            const pendingDeliveries = await prisma.enrollment.findMany({
                where: {
                    status: 'ACTIVE',
                    quizState: 'IDLE',
                    updatedAt: { lte: timeLimit } 
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
                    continue; // Skip to the next student in the loop
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