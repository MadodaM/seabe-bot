// services/billingCron.js
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const prisma = require('./prisma-client');
const { sendWhatsApp } = require('./whatsapp'); 
const netcash = require('./netcash');
const { calculateTransaction } = require('./pricingEngine'); // 🚀 ADDED PRICING ENGINE

// Helper to prevent Twilio rate-limiting
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const startBillingEngine = () => {
    console.log("⚙️ Billing Engine Initialized. Scheduled for 09:15 AM (SAST) daily.");

    // The cron expression '15 9 * * *' means: Minute 15, Hour 9, Every Day
    cron.schedule('15 9 * * *', async () => {
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

                    // 🚀 PRICING ENGINE INTERCEPTION (Async + Capitec)
                    // We explicitly use 'CAPITEC' to get the lower wholesale rate for automated billing
                    const pricing = await calculateTransaction(debt.amount, 'STANDARD', 'CAPITEC', true);

                    // Generate a unique Netcash tracking reference
                    const ref = `AUTO-${debt.reference}-${Date.now().toString().slice(-4)}`;
                    
                    // 🛡️ Ensure phone is clean for Twilio
                    let cleanPhone = debt.phone.replace(/\D/g, '');
                    if (cleanPhone.startsWith('0')) cleanPhone = '27' + cleanPhone.substring(1);

                    // Create the secure payment link using the NEW total charged to user
                    const link = await netcash.createPaymentLink(pricing.totalChargedToUser, ref, cleanPhone, orgName);

                    if (link) {
                        // 🚀 TRANSPARENT FEE BREAKDOWN IN THE MESSAGE
                        const message = `🔔 *Premium Reminder*\n\nGood morning ${debt.firstName},\n\nThis is a polite automated reminder that your premium for *${orgName}* is currently due.\n\nPremium: *R${pricing.baseAmount.toFixed(2)}*\nService Fee: *R${pricing.totalFees.toFixed(2)}*\n*Total Due: R${pricing.totalChargedToUser.toFixed(2)}*\n\nYou can easily settle your account using our secure payment portal here:\n👉 ${link}\n\nReply *1* to speak to an administrator if you need assistance.`;

                        await sendWhatsApp(cleanPhone, message);

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
        timezone: "Africa/Johannesburg" // Ensures it runs at 09:15 SAST
    });
};

module.exports = { startBillingEngine };