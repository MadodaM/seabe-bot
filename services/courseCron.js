// services/courseCron.js
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Safely initialize Twilio for direct background messaging
let twilioClient;
if (process.env.TWILIO_SID && process.env.TWILIO_AUTH) {
    twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
}

const sendWhatsApp = async (to, body) => {
    if (!twilioClient) return console.log("⚠️ Twilio Keys Missing for Course Delivery!");
    const cleanTwilioNumber = process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '');
    
    let cleanTo = to.replace(/\D/g, '');
    if (cleanTo.startsWith('0')) cleanTo = '27' + cleanTo.substring(1);
    
    try {
        await twilioClient.messages.create({
            from: `whatsapp:${cleanTwilioNumber}`,
            to: `whatsapp:+${cleanTo}`,
            body: body
        });
    } catch (err) {
        console.error("❌ LMS Twilio Send Error:", err.message);
    }
};

const startCourseEngine = () => {
    console.log("🎓 WhatsApp LMS Delivery Engine Initialized. Scheduled DAILY at 08:30 AM (SAST).");

    // Cron expression: Minute 30, Hour 8, Every Single Day
    cron.schedule('30 8 * * *', async () => {
        console.log("⏰ [CRON] Waking up Course Delivery Engine...");

        try {
            // 1. Fetch all ACTIVE enrollments
            const activeEnrollments = await prisma.enrollment.findMany({
                where: { status: 'ACTIVE' },
                include: {
                    member: true,
                    course: {
                        include: { modules: true }
                    }
                }
            });

            if (activeEnrollments.length === 0) {
                console.log("✅ [CRON] No active course enrollments today. Sleeping.");
                return;
            }

            console.log(`🚀 [CRON] Delivering daily lessons to ${activeEnrollments.length} students...`);

            let lessonsDelivered = 0;

            // 2. Process each student's journey
            for (const enrollment of activeEnrollments) {
                const student = enrollment.member;
                const course = enrollment.course;
                const currentDay = enrollment.currentDay;

                // 3. Find today's specific module
                const todaysModule = course.modules.find(m => m.dayNumber === currentDay);

                if (todaysModule) {
                    // Assemble the beautiful WhatsApp Lesson
                    let lessonMessage = `🎓 *${course.title}* (Day ${currentDay})\n\n`;
                    lessonMessage += `*${todaysModule.title}*\n\n`;
                    lessonMessage += `${todaysModule.content}\n\n`;
                    
                    if (todaysModule.quiz) {
                        lessonMessage += `🧠 *Today's Quiz:*\n${todaysModule.quiz}\n\n`;
                        lessonMessage += `_Reply with your answer to chat with our AI tutor!_`;
                    }

                    // Send the lesson
                    await sendWhatsApp(student.phone, lessonMessage);
                    lessonsDelivered++;

                    // 4. Increment the student's progress to the next day
                    await prisma.enrollment.update({
                        where: { id: enrollment.id },
                        data: { currentDay: currentDay + 1 }
                    });
                    
                } else {
                    // If no module is found for this day, they have finished the course!
                    await sendWhatsApp(student.phone, `🎉 *Congratulations!*\n\nYou have officially completed *${course.title}*! \n\nWe hope you enjoyed the journey. Reply *Menu* to explore more resources.`);
                    
                    // Mark enrollment as completed
                    await prisma.enrollment.update({
                        where: { id: enrollment.id },
                        data: { status: 'COMPLETED' }
                    });
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
};

module.exports = { startCourseEngine };