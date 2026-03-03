// services/billingCron.js
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendWhatsApp } = require('./whatsapp'); 
const netcash = require('./netcash');

// Helper to prevent Twilio rate-limiting
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const startBillingEngine = () => {
    console.log("⚙️ Billing Engine Initialized. Scheduled for 08:00 AM (SAST) daily.");

    // The cron expression '0 8 * * *' means: Minute 0, Hour 8, Every Day, Every Month
    cron.schedule('0 8 * * *', async () => {
        console.log("⏰ [CRON] Waking up Billing Engine...");

        try {
            // 1. Find all fresh invoices sitting in the PENDING state
            const pendingDebts = await prisma.collection.findMany({
                where: { status: 'PENDING' }
            });

            if (pendingDebts.length === 0) {
                console.log("✅ [CRON] No pending premiums found today.");
                return;
            }

            console.log(`🚀 [CRON] Found ${pendingDebts.length} accounts due. Initiating blast...`);
            let sentCount = 0;

            for (const debt of pendingDebts) {
                try {
                    // Fetch the specific organization this debt belongs to
                    const org = await prisma.church.findUnique({ where: { code: debt.churchCode } });
                    const orgName = org ? org.name : "Your Organization";

                    // Generate a unique Netcash tracking reference
                    const ref = `AUTO-${debt.reference}-${Date.now().toString().slice(-4)}`;
                    
                    // Create the secure payment link
                    const link = await netcash.createPaymentLink(debt.amount, ref, debt.phone, orgName);

                    if (link) {
                        const message = `🔔 *Premium Reminder*\n\nGood morning ${debt.firstName},\n\nThis is a polite automated reminder that your premium of *R${debt.amount.toFixed(2)}* for *${orgName}* is currently due.\n\nYou can easily settle your account using our secure payment portal here:\n👉 ${link}\n\nReply *1* to speak to an administrator if you need assistance.`;

                        await sendWhatsApp(debt.phone, message);

                        // Update status to REMINDER_1 so we don't spam them again tomorrow!
                        await prisma.collection.update({
                            where: { id: debt.id },
                            data: { status: 'REMINDER_1' } 
                        });

                        sentCount++;
                    }
                    
                    // Pause for 1 second between messages so Twilio doesn't block us for spamming
                    await delay(1000);

                } catch (err) {
                    console.error(`❌ [CRON] Failed to send reminder to ${debt.phone}:`, err.message);
                }
            }

            console.log(`🏆 [CRON] Billing sequence complete. ${sentCount} reminders sent successfully.`);

        } catch (error) {
            console.error("❌ [CRON] Fatal Engine Error:", error);
        }
    }, {
        scheduled: true,
        timezone: "Africa/Johannesburg" // Ensures it runs at 8 AM South African time, regardless of Render's server timezone!
    });
};

module.exports = { startBillingEngine };