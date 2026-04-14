require('dotenv').config();

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const DEFAULT_FROM = process.env.TWILIO_PHONE_NUMBER; // Usually Seabe Pay

const client = require('twilio')(ACCOUNT_SID, AUTH_TOKEN);

/**
 * Sends a WhatsApp message with dynamic sender support.
 * @param {string} to - Recipient (e.g., '2782...')
 * @param {string} body - The text
 * @param {string|null} mediaUrl - Optional Image/PDF
 * @param {string|null} fromOverride - Optional specific sender (e.g., '+27875511057')
 */
async function sendWhatsApp(to, body, mediaUrl = null, fromOverride = null) {
    if (!ACCOUNT_SID || !AUTH_TOKEN) {
        console.log("⚠️ Twilio Credentials missing");
        return false;
    }

    try {
        // 1. Clean the recipient number
        const cleanTo = to.replace('whatsapp:', '').replace('+', '').trim();
        const formattedTo = `whatsapp:+${cleanTo}`;

        // 2. Determine the SENDER (Lwazi vs. Seabe)
        // Use the override if provided, otherwise fallback to the .env default
        let sender = fromOverride || DEFAULT_FROM;
        
        // Ensure sender is in 'whatsapp:+...' format
        if (!sender.startsWith('whatsapp:')) {
            sender = `whatsapp:${sender.startsWith('+') ? sender : '+' + sender}`;
        }

        const messageOptions = {
            from: sender,
            to: formattedTo,
            body: body
        };

        if (mediaUrl) messageOptions.mediaUrl = [mediaUrl];

        const message = await client.messages.create(messageOptions);

        console.log(`✅ Sent from ${sender} to ${formattedTo} (SID: ${message.sid})`);
        return true;

    } catch (error) {
        console.error("❌ Twilio Send Error:", error.message);
        
        // 🚨 63016 Specific Logic
        if (error.code === 63016) {
            console.error("⛔ WINDOW BLOCKED: You cannot initiate a chat without a Template.");
            // In production, this is where you'd trigger your 'lwazi_onboarding' template instead
        }
        return false;
    }
}

module.exports = { sendWhatsApp };