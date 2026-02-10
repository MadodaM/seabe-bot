const axios = require('axios');
require('dotenv').config();

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

async function sendWhatsApp(to, text) {
    // 🛡️ Safety Check: If no credentials, just log it (don't crash the server)
    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
        console.log("⚠️ WhatsApp Credentials missing in .env");
        console.log(`📱 [MOCK] Would send to ${to}: ${text}`);
        return true;
    }

    try {
        const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
        
        await axios.post(url, {
            messaging_product: "whatsapp",
            to: to,
            type: "text",
            text: { body: text }
        }, {
            headers: {
                Authorization: `Bearer ${WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`✅ WhatsApp sent to ${to}`);
        return true;
    } catch (error) {
        console.error("❌ WhatsApp Send Error:", error.response ? error.response.data : error.message);
        return false;
    }
}

module.exports = { sendWhatsApp };