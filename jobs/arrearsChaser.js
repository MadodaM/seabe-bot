// jobs/arrearsChaser.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendWhatsApp } = require('../services/whatsapp');

async function runArrearsChaser() {
    console.log("🚀 Starting Automated Arrears Chaser...");

    // 1. Find all failed transactions from the last 24 hours
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const failedTransactions = await prisma.transaction.findMany({
        where: {
            status: 'FAILED',
            date: { gte: yesterday },
            type: 'DEBIT_ORDER' // Or whatever type you use for premiums
        },
        include: { church: true }
    });

    console.log(`🔍 Found ${failedTransactions.length} failed transactions to chase.`);

    for (const tx of failedTransactions) {
        try {
            // Find the member linked to this phone
            const member = await prisma.member.findFirst({
                where: { phone: tx.phone, churchCode: tx.churchCode }
            });

            if (!member) continue;

            // 2. Generate a 1-Click Pay Link (Seabe Pay)
            const host = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
            const payLink = `${host}/link/${tx.churchCode}`;

            // 3. Craft the "Chaser" Message
            const message = `⚠️ *Payment Notification: ${tx.church.name}*\n\nHi ${member.firstName}, your premium of *R${tx.amount.toFixed(2)}* failed to process today.\n\nTo ensure your cover remains active and avoid a double-debit next month, please settle instantly via Seabe Pay:\n\n👉 ${payLink}\n\n_Safe and secure Instant EFT or Card._`;

            // 4. Send the WhatsApp
            const cleanDest = tx.phone.startsWith('0') ? '27' + tx.phone.substring(1) : tx.phone.replace('+', '');
            await sendWhatsApp(cleanDest, message);

            // 5. Log that we chased them so we don't spam
            // (Assumes you have a Notification or Audit table, if not, we can just console.log for now)
            console.log(`✅ Arrears notice sent to ${cleanDest}`);

        } catch (err) {
            console.error(`❌ Failed to chase ${tx.phone}:`, err.message);
        }
    }

    console.log("✅ Arrears Chaser complete.");
}

module.exports = { runArrearsChaser };