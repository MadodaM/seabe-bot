require('dotenv').config();

// Load Twilio Credentials
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER; // Format: whatsapp:+14155238886

// Initialize Twilio Client
const client = require('twilio')(ACCOUNT_SID, AUTH_TOKEN);

async function sendWhatsApp(to, text) {
    // 🛡️ Safety Check: If no credentials, just log it (don't crash server)
    if (!ACCOUNT_SID || !AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
        console.log("⚠️ Twilio Credentials missing in .env");
        console.log(`📱 [MOCK] Would send to ${to}: ${text}`);
        return true;
    }

    try {
        // Ensure 'to' number is in correct format (whatsapp:+27...)
        // If 'to' is '2783...', make it 'whatsapp:+2783...'
        const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:+${to.replace('+', '')}`;

        const message = await client.messages.create({
            from: TWILIO_PHONE_NUMBER, // Must be 'whatsapp:+1415...'
            to: formattedTo,           
            body: text
        });

        console.log(`✅ WhatsApp sent to ${formattedTo} (SID: ${message.sid})`);
        return true;

    } catch (error) {
        console.error("❌ Twilio Send Error:", error.message);
        if (error.code === 63015) {
             console.error("💡 TIP: You can only send free-text messages to users who messaged YOU in the last 24 hours.");
        }
        return false;
    }
}

module.exports = { sendWhatsApp };