// services/remittance.js
// Automated WhatsApp Remittance Advices using Twilio
const twilio = require('twilio');
const prisma = require('./db'); // Uses your newly encrypted DB engine!

async function sendRemittanceAdvice(payoutId) {
    try {
        // 1. Verify Twilio Environment Variables
        if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
            console.warn("⚠️ Twilio credentials missing in .env. Skipping WhatsApp Remittance.");
            return false;
        }

        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        const twilioPhone = process.env.TWILIO_PHONE_NUMBER;

        // 2. Fetch the Payout and attached Church details
        const payout = await prisma.payout.findUnique({
            where: { id: payoutId },
            include: { church: true }
        });

        if (!payout) throw new Error(`Payout ${payoutId} not found.`);

        // 3. Find the best contact number for the Church
        let targetPhone = payout.church.phone || payout.church.contactNumber;

        // Fallback: If the church has no direct phone, find the designated Admin/Treasurer
        if (!targetPhone) {
            const admin = await prisma.member.findFirst({
                where: { churchCode: payout.churchCode, role: 'ADMIN' }
            });
            // 🛡️ Notice we don't need to decrypt this! Your Prisma Interceptor does it automatically.
            if (admin) targetPhone = admin.phone; 
        }

        if (!targetPhone) {
            console.warn(`⚠️ No phone number found for Church ${payout.churchCode}. Cannot send WhatsApp.`);
            return false;
        }

        // 4. Clean the phone number (Ensure it has the SA +27 prefix for Twilio)
        if (targetPhone.startsWith('0')) {
            targetPhone = '27' + targetPhone.substring(1);
        }

        // 5. Format the Bank-Grade Receipt
        const amountNum = Number(payout.amount);
        const amountFormatted = new Intl.NumberFormat('en-ZA', { 
            style: 'currency', 
            currency: 'ZAR' 
        }).format(amountNum);
        
        const message = `🟢 *Seabe Digital Remittance Advice*\n\nDear Treasurer,\n\nA settlement of *${amountFormatted}* has been successfully processed for *${payout.church.name}*.\n\n📄 *Batch Ref:* ${payout.reference || payout.id}\n📅 *Date:* ${new Date().toLocaleDateString('en-ZA')}\n\nFunds should reflect in your nominated bank account within 24-48 hours.\n\n_Thank you for partnering with Seabe._`;

        // 6. Fire the WhatsApp Message via Twilio
        await client.messages.create({
            from: `whatsapp:${twilioPhone}`,
            to: `whatsapp:+${targetPhone.replace('+', '')}`,
            body: message
        });

        console.log(`✅ Remittance advice successfully sent to ${targetPhone} for Payout ${payoutId}`);
        return true;

    } catch (error) {
        console.error(`❌ Failed to send remittance advice:`, error.message);
        return false;
    }
}

module.exports = { sendRemittanceAdvice };