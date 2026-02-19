require('dotenv').config();

// Load Twilio Credentials
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER; 

// Initialize Twilio Client
const client = require('twilio')(ACCOUNT_SID, AUTH_TOKEN);

/**
 * Sends a WhatsApp message, optionally with an image/PDF attachment.
 * @param {string} to - The recipient's phone number
 * @param {string} body - The text message
 * @param {string|null} mediaUrl - (Optional) Public URL to a PDF or Image
 */
async function sendWhatsApp(to, body, mediaUrl = null) {
    // 🛡️ Safety Check: If no credentials, just log it (don't crash server)
    if (!ACCOUNT_SID || !AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
        console.log("⚠️ Twilio Credentials missing in .env");
        console.log(`📱 [MOCK] Would send to ${to}: ${body} ${mediaUrl ? '[+MEDIA]' : ''}`);
        return true;
    }

    try {
        // Ensure 'to' number is in correct format (whatsapp:+27...)
        // If 'to' is '2783...', make it 'whatsapp:+2783...'
        // If 'to' is '083...', this logic assumes you've cleaned it to '2783...' elsewhere, 
        // but strictly speaking, Twilio needs 'whatsapp:+<country code><number>'
        let cleanPhone = to.replace('whatsapp:', '').replace('+', '');
        const formattedTo = `whatsapp:+${cleanPhone}`;

        // 📦 Construct the Message Object
        const messageOptions = {
            from: TWILIO_PHONE_NUMBER, 
            to: formattedTo,            
            body: body
        };

        // 📎 ADDED: Attach Media if provided (PDFs/Images)
        if (mediaUrl) {
            messageOptions.mediaUrl = [mediaUrl];
        }

        // 🚀 Send
        const message = await client.messages.create(messageOptions);

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