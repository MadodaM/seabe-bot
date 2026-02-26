// services/scheduler.js
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendWhatsApp } = require('./whatsapp'); // Adjust path if needed
const sgMail = require('@sendgrid/mail');

// Initialize SendGrid
if (process.env.SENDGRID_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_KEY);
}

// ==========================================
// 📧 EMAIL REPORT GENERATOR (For Mondays)
// ==========================================
async function emailReport(churchCode) {
    try {
        const org = await prisma.church.findUnique({
            where: { code: churchCode },
            include: {
                transactions: {
                    where: { 
                        status: 'SUCCESS',
                        // Optional: Filter for the last 7 days only
                        // createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } 
                    },
                    orderBy: { date: 'desc' }
                }
            }
        });

        if (!org || !org.email || org.transactions.length === 0) return;

        // Generate CSV Content
        let csvContent = "Date,Phone,Type,Amount,Reference\n";
        let total = 0;

        org.transactions.forEach(t => {
            const date = t.date.toISOString().split('T')[0];
            const amount = t.amount.toFixed(2);
            csvContent += `${date},${t.phone},${t.type},${amount},${t.reference}\n`;
            total += t.amount;
        });
        csvContent += `\nTOTAL,,,${total.toFixed(2)},`;

        // Send Email via SendGrid
        const msg = {
            to: org.email,
            from: process.env.EMAIL_FROM || 'admin@seabe.io',
            subject: `📊 Weekly Financial Report: ${org.name}`,
            text: `Attached is your weekly transaction report for ${org.name}.\n\nTotal Processed: R${total.toFixed(2)}`,
            attachments: [{
                content: Buffer.from(csvContent).toString('base64'),
                filename: `Weekly_Report_${org.code}_${new Date().toISOString().split('T')[0]}.csv`,
                type: 'text/csv',
                disposition: 'attachment'
            }]
        };

        await sgMail.send(msg);
        console.log(`📧 Weekly report emailed successfully to ${org.email}`);

    } catch (error) {
        console.error(`❌ Failed to send report to ${churchCode}:`, error.message);
    }
}

// ==========================================
// ⏰ MASTER CRON CONTROLLER
// ==========================================
const startCronJobs = () => {
    console.log("⏰ Initializing Cron Jobs (Timezone: SAST)...");

    // ---------------------------------------------------------
    // 1. DAILY: Revenue Recovery Drip Campaign
    // ⏰ Runs EVERY DAY at 08:00 AM SAST
    // ---------------------------------------------------------
    cron.schedule('0 8 * * *', async () => {
        console.log('⏳ Running Daily Revenue Recovery Drip Campaign...');

        try {
            const now = new Date();
            const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
            const fourteenDaysAgo = new Date(now.getTime() - (14 * 24 * 60 * 60 * 1000));

            // --- 🟡 DAY 7: GENTLE REMINDER ---
            const day7Debts = await prisma.collection.findMany({
                where: { 
                    status: 'SENT',
                    updatedAt: {   // ❌ THIS IS THE CULPRIT
					lte: someDateVariable
                }
            });

            for (const debt of day7Debts) {
                await sendWhatsApp(debt.phone, `Friendly Reminder: Hi ${debt.firstName}, your statement of R${debt.amount.toFixed(2)} (Ref: ${debt.reference}) is still outstanding. \n\nPlease settle it using the secure link provided previously, or reply *1* to make a Promise to Pay.`);
                
                await prisma.collection.update({
                    where: { id: debt.id },
                    data: { status: 'REMINDER_1' } 
                });
            }

            // --- 🔴 DAY 14: FINAL NOTICE ---
            const day14Debts = await prisma.collection.findMany({
                where: {
                    status: 'REMINDER_1',
                    updatedAt: {   // ❌ THIS IS THE CULPRIT
					lte: someDateVariable
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
            console.error("Cron Job Error (Drip Campaign):", error);
        }
    }, {
        scheduled: true,
        timezone: "Africa/Johannesburg" 
    });

    // ---------------------------------------------------------
    // 2. WEEKLY: Financial Reports
    // ⏰ Runs EVERY MONDAY at 08:00 AM SAST
    // ---------------------------------------------------------
    cron.schedule('0 8 * * 1', async () => {
        console.log("🔄 Running Monday 08:00 AM Automated Reports...");
        try {
            const churches = await prisma.church.findMany();
            for (const church of churches) { 
                // Only attempt to send if the organization has an email configured
                if (church.email) {
                    await emailReport(church.code); 
                }
            }
            console.log("✅ All weekly reports dispatched.");
        } catch (error) {
            console.error("❌ Cron Job Error (Weekly Reports):", error);
        }
    }, { 
        scheduled: true,
        timezone: "Africa/Johannesburg" 
    });
};

module.exports = { startCronJobs };