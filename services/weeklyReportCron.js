// services/weeklyReportCron.js
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const prisma = require('./prisma-client');
const { Resend } = require('resend');
const { calculateTransaction } = require('./pricingEngine'); // 🚀 INJECTED PRICING ENGINE
const resend = new Resend(process.env.RESEND_API_KEY);

const startWeeklyReportEngine = () => {
    console.log("📊 Weekly Report Engine Initialized. Scheduled for Friday at 17:00 (SAST).");

    // The cron expression '0 17 * * 5' means: Minute 0, Hour 17 (5 PM), Every Month, Friday (5)
    cron.schedule('0 17 * * 5', async () => {
        console.log("⏰ [CRON] Waking up Weekly Report Engine...");

        try {
            // 1. Determine the date range (Last 7 days)
            const today = new Date();
            const oneWeekAgo = new Date();
            oneWeekAgo.setDate(today.getDate() - 7);

            // 2. Find all organizations that have an email address configured
            const organizations = await prisma.church.findMany({
                where: { email: { not: null, not: '' } }
            });

            if (organizations.length === 0) {
                console.log("✅ [CRON] No organizations with email addresses found. Sleeping.");
                return;
            }

            console.log(`🚀 [CRON] Generating reports for ${organizations.length} organizations...`);

            for (const org of organizations) {
                try {
                    // --- FETCH TRANSACTIONS ---
                    const transactions = await prisma.transaction.findMany({
                        where: {
                            churchCode: org.code,
                            status: 'SUCCESS',
                            date: { gte: oneWeekAgo, lte: today }
                        },
                        orderBy: { date: 'desc' }
                    });

                    // --- FETCH CLAIMS ---
                    const claims = await prisma.claim.findMany({
                        where: {
                            churchCode: org.code,
                            createdAt: { gte: oneWeekAgo, lte: today }
                        },
                        orderBy: { createdAt: 'desc' }
                    });

                    // --- BUILD TRANSACTION CSV (NOW WITH PRICING ENGINE) ---
                    let txCsv = "Date,Phone,Type,Gross (User Paid),Platform/Gateway Fees,Net Settlement,Reference\n";
                    let totalGross = 0;
                    let totalFees = 0;
                    let totalNet = 0;
                    
                    transactions.forEach(t => {
                        // 1. Determine who pays the fee based on the transaction type
                        let passFeesToUser = true;
                        if (['DONATION', 'OFFERING', 'TITHE'].includes(t.type)) {
                            passFeesToUser = false; // Charities absorb the fee
                        }

                        // 2. Run it through the pricing engine
                        const pricing = calculateTransaction(t.amount, 'STANDARD', 'DEFAULT', passFeesToUser);

                        const dateStr = t.date.toISOString().split('T')[0];
                        txCsv += `${dateStr},${t.phone},${t.type},R${pricing.totalChargedToUser.toFixed(2)},R${pricing.totalFees.toFixed(2)},R${pricing.settlementToMerchant.toFixed(2)},${t.reference}\n`;
                        
                        totalGross += pricing.totalChargedToUser;
                        totalFees += pricing.totalFees;
                        totalNet += pricing.settlementToMerchant;
                    });
                    
                    txCsv += `\nTOTALS,,,R${totalGross.toFixed(2)},R${totalFees.toFixed(2)},R${totalNet.toFixed(2)},\n`;

                    // --- BUILD CLAIMS CSV ---
                    let claimCsv = "Date Logged,Deceased ID,Claimant Phone,Status,AI Confidence\n";
                    claims.forEach(c => {
                        const dateStr = c.createdAt.toISOString().split('T')[0];
                        claimCsv += `${dateStr},${c.deceasedIdNumber},${c.claimantPhone},${c.status},${c.aiConfidence || 'N/A'}\n`;
                    });

                    // --- ASSEMBLE EMAIL ---
                    let emailText = `Happy Friday!\n\nAttached is your automated weekly summary for ${org.name} covering the period of ${oneWeekAgo.toLocaleDateString()} to ${today.toLocaleDateString()}.\n\n`;
                    emailText += `💰 Total Gross Processed: R${totalGross.toFixed(2)}\n`;
                    emailText += `📉 Gateway & Platform Fees: R${totalFees.toFixed(2)}\n`;
                    emailText += `🏦 Net Settlement Expected: R${totalNet.toFixed(2)}\n\n`;
                    emailText += `📑 New Claims Logged: ${claims.length}\n\n`;
                    emailText += `Thank you for using Seabe Digital!`;

                    const attachments = [];

                    // Only attach Transaction file if there is data
                    if (transactions.length > 0) {
                        attachments.push({
                            content: Buffer.from(txCsv).toString('base64'),
                            filename: `Revenue_Report_${org.code}.csv`
                        });
                    }

                    // Only attach Claims file if there is data
                    if (claims.length > 0) {
                        attachments.push({
                            content: Buffer.from(claimCsv).toString('base64'),
                            filename: `Claims_Report_${org.code}.csv`
                        });
                    }

                    // Send via Resend
                    await resend.emails.send({
                        to: org.email, // ⚠️ Must be your verified Resend email on the free tier
                        from: process.env.EMAIL_FROM || 'onboarding@resend.dev', 
                        subject: `📊 Weekly Summary & Settlement Report: ${org.name}`,
                        text: emailText,
                        // Resend only accepts the attachments array if it actually has items
                        ...(attachments.length > 0 && { attachments }) 
                    });
                    
                    console.log(`✉️ Sent weekly report to ${org.name} (${org.email})`);

                } catch (orgError) {
                    console.error(`❌ Failed to send report to ${org.name}:`, orgError.message);
                }

            console.log(`🏆 [CRON] Friday Reporting sequence complete.`);

        } catch (error) {
            console.error("❌ [CRON] Fatal Report Engine Error:", error);
        }
    }, {
        scheduled: true,
        timezone: "Africa/Johannesburg" 
    });
};

module.exports = { startWeeklyReportEngine };