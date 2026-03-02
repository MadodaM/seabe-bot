const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Initialize Twilio
let twilioClient;
if (process.env.TWILIO_SID && process.env.TWILIO_AUTH) {
    twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
}

const sendWhatsApp = async (to, body) => {
    if (!twilioClient) return console.log("⚠️ Twilio Keys Missing!");
    const cleanTwilioNumber = process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '');
    try {
        await twilioClient.messages.create({
            from: `whatsapp:${cleanTwilioNumber}`, 
            to: `whatsapp:${to}`,
            body: body
        });
    } catch (err) {
        console.error("❌ Twilio Send Error:", err.message);
    }
};

const startDripCampaign = () => {
    console.log("⏰ LMS Drip Campaign Scheduler Started.");

    // ========================================================
    // 🌅 07:00 AM - THE DAILY LESSON BLAST
    // ========================================================
    // Cron syntax: '0 7 * * *' means exactly 7:00 AM every day
    cron.schedule('0 7 * * *', async () => {
        console.log("🌅 Running 07:00 AM LMS Lesson Blast...");
        
        try {
            const activeEnrollments = await prisma.enrollment.findMany({
                where: { status: 'ACTIVE' },
                include: { member: true, course: { include: { modules: true } } }
            });

            for (const enrollment of activeEnrollments) {
                // Find the module that matches their current day/progress
                const currentModule = enrollment.course.modules.find(m => m.order === enrollment.progress);
                
                if (currentModule && currentModule.dailyLessonText) {
                    const msg = `🌅 *Good Morning, ${enrollment.member.firstName}!*\n\nHere is your daily lesson for *${enrollment.course.title}*:\n\n📖 *${currentModule.title}*\n${currentModule.dailyLessonText}\n\nTake some time to reflect on this. I will check in with you at 12:00 PM for a quick review!`;
                    
                    await sendWhatsApp(enrollment.member.phone, msg);
                    
                    // Ensure the quiz state is reset for the day
                    await prisma.enrollment.update({
                        where: { id: enrollment.id },
                        data: { quizState: 'IDLE' }
                    });
                }
            }
        } catch (error) { console.error("Error in Morning Blast:", error); }
    }, { timezone: "Africa/Johannesburg" }); // Set to local SAST time

    // ========================================================
    // ☀️ 12:30 PM - THE CHECK-ON-LEARNING QUIZ
    // ========================================================
    // Cron syntax: '30 12 * * *' means exactly 12:30 PM every day
    cron.schedule('30 12 * * *', async () => {
        console.log("☀️ Running 12:30 PM LMS Quiz Blast...");
        
        try {
            const activeEnrollments = await prisma.enrollment.findMany({
                where: { status: 'ACTIVE' },
                include: { member: true, course: { include: { modules: true } } }
            });

            for (const enrollment of activeEnrollments) {
                const currentModule = enrollment.course.modules.find(m => m.order === enrollment.progress);
                
                // We check if the module has a quiz question
                if (currentModule && currentModule.quizQuestion) {
                    const msg = `🧠 *Check on Learning*\n\nBased on this morning's lesson:\n*${currentModule.quizQuestion}*\n\nPlease reply directly to this message with your answer.`;
                    
                    await sendWhatsApp(enrollment.member.phone, msg);
                    
                    // Lock the user into "Quiz Mode"
                    await prisma.enrollment.update({
                        where: { id: enrollment.id },
                        data: { quizState: 'AWAITING_QUIZ' }
                    });
                }
            }
        } catch (error) { console.error("Error in Midday Blast:", error); }
    }, { timezone: "Africa/Johannesburg" });
};

module.exports = { startDripCampaign };