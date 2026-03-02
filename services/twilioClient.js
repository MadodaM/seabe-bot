// services/twilioClient.js
const twilio = require('twilio');

let twilioClient;
if (process.env.TWILIO_SID && process.env.TWILIO_AUTH) {
    twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
}

const sendWhatsApp = async (to, body) => {
    if (!twilioClient) return console.log("⚠️ Twilio Keys Missing!");
    const cleanTwilioNumber = process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '');

    // 🚀 THE AUTO-CHUNKER: Splits long text perfectly without breaking words
    // Twilio's hard limit is 1600. We use 1500 to leave a safe buffer.
    const chunks = body.match(/[\s\S]{1,1500}(?!\S)/g) || [body];

    try {
        for (let i = 0; i < chunks.length; i++) {
            await twilioClient.messages.create({
                from: `whatsapp:${cleanTwilioNumber}`, 
                to: `whatsapp:${to}`,
                body: chunks[i].trim() // Remove trailing spaces from the cut
            });
            
            // Add a 1-second delay between parts to ensure WhatsApp delivers them in order
            if (chunks.length > 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        console.log(`✅ Text delivered to ${to} (${chunks.length} parts)`);
    } catch (err) {
        console.error("❌ Twilio Send Error:", err.message);
    }
};

const sendWhatsAppMedia = async (to, caption, mediaUrl) => {
    if (!twilioClient) return console.log("⚠️ Twilio Keys Missing!");
    const cleanTwilioNumber = process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '');
    
    try {
        await twilioClient.messages.create({
            from: `whatsapp:${cleanTwilioNumber}`, 
            to: `whatsapp:${to}`,
            body: caption,
            mediaUrl: [mediaUrl] // Twilio requires media URLs in an array
        });
        console.log(`🖼️ Certificate delivered to ${to}`);
    } catch (err) {
        console.error("❌ Twilio Media Send Error:", err.message);
    }
};

// Update the export at the bottom:
module.exports = { sendWhatsApp, sendWhatsAppMedia };
