const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendWhatsApp } = require('./whatsapp'); // Adjust path if needed

const startCronJobs = () => {
    // ⏰ Run every morning at 08:00 AM SAST
    cron.schedule('0 8 * * *', async () => {
        console.log('⏳ Running Daily Revenue Recovery Drip Campaign...');

        try {
            const now = new Date();
            // Calculate our time windows
            const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
            const fourteenDaysAgo = new Date(now.getTime() - (14 * 24 * 60 * 60 * 1000));

            // --- 🟡 DAY 7: GENTLE REMINDER ---
            // Find debts sent 7+ days ago that haven't been touched yet
            const day7Debts = await prisma.collection.findMany({
                where: { 
                    status: 'SENT',
                    updatedAt: { lte: sevenDaysAgo } 
                }
            });

            for (const debt of day7Debts) {
                await sendWhatsApp(debt.phone, `Friendly Reminder: Hi ${debt.firstName}, your statement of R${debt.amount.toFixed(2)} (Ref: ${debt.reference}) is still outstanding. \n\nPlease settle it using the secure link provided previously, or reply *1* to make a Promise to Pay.`);
                
                // Update status so we don't send this again tomorrow
                await prisma.collection.update({
                    where: { id: debt.id },
                    data: { status: 'REMINDER_1' } 
                });
            }

            // --- 🔴 DAY 14: FINAL NOTICE ---
            // Find debts that got Reminder 1, but are now 14+ days old
            const day14Debts = await prisma.collection.findMany({
                where: {
                    status: 'REMINDER_1',
                    updatedAt: { lte: fourteenDaysAgo }
                }
            });

            for (const debt of day14Debts) {
                await sendWhatsApp(debt.phone, `⚠️ Final Notice: Hi ${debt.firstName}, your account is now severely overdue (R${debt.amount.toFixed(2)}). \n\nPlease reply *1* to make a Promise to Pay, or *2* to Dispute this invoice. Failure to respond may result in further action.`);
                
                await prisma.collection.update({
                    where: { id: debt.id },
                    data: { status: 'FINAL_NOTICE' } 
                });
            }

            console.log(`✅ Drip Campaign Complete: Sent ${day7Debts.length} Reminders and ${day14Debts.length} Final Notices.`);

        } catch (error) {
            console.error("Cron Job Error:", error);
        }
    }, {
        scheduled: true,
        timezone: "Africa/Johannesburg" // Keeps it strictly locked to SA time!
    });
};

module.exports = { startCronJobs };