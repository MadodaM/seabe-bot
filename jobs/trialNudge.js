const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
// Import your sender function so the script can actually send the WhatsApp message
const { sendLwazi } = require('../bots/lwaziBot'); 

async function nudgeExpiringTrials() {
    console.log("⏰ Running Daily Cron: Checking for expiring Lwazi trials...");
    
    const sixDaysAgo = new Date();
    sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);

    try {
        const expiringMembers = await prisma.member.findMany({
            where: {
                status: 'TRIAL',
                trialStartedAt: {
                    gte: new Date(sixDaysAgo.setHours(0,0,0,0)),
                    lte: new Date(sixDaysAgo.setHours(23,59,59,999))
                }
            }
        });

        if (expiringMembers.length === 0) {
            console.log("✅ No trials expiring tomorrow.");
            return;
        }

        for (const m of expiringMembers) {
            const nudgeMsg = `⏳ *Trial Ending Tomorrow!*\n\nHi ${m.firstName}, your 7-day free trial of Lwazi Premium ends tomorrow! We hope you've loved having a 24/7 Socratic Tutor.\n\nTo keep your access without interruption, reply *Subscribe* to upgrade for just R69/month.`;
            
            await sendLwazi(m.phone, nudgeMsg);
            console.log(`✉️ Nudge sent to ${m.phone}`);
            
            // Wait 1 second between messages to prevent Twilio rate limits
            await new Promise(res => setTimeout(res, 1000)); 
        }
    } catch (error) {
        console.error("❌ Error running trial nudge cron:", error);
    }
}

// Export it so index.js can use it
module.exports = { nudgeExpiringTrials };