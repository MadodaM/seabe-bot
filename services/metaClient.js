// services/metaClient.js
const fetch = require('node-fetch'); // Native fetch in Node 18+, or install node-fetch

/**
 * Sends a WhatsApp message using the raw Meta Cloud API.
 * Designed specifically for Lwazi EdTech.
 */
const sendMetaWhatsApp = async (to, body) => {
    const token = process.env.META_ACCESS_TOKEN;
    const phoneId = process.env.META_PHONE_NUMBER_ID; 

    if (!token || !phoneId) {
        console.error("⚠️ Meta API Keys Missing! Check your .env file.");
        return;
    }

    // Meta requires the number to be clean (no '+', no 'whatsapp:')
    const cleanTo = to.replace(/\D/g, '');

    // Meta's character limit is 4096, so we don't need strict chunking like Twilio,
    // but we'll implement a basic safety check.
    const chunks = body.match(/[\s\S]{1,4000}/g) || [];

    for (const chunk of chunks) {
        try {
            const response = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    to: cleanTo,
                    type: 'text',
                    text: { body: chunk }
                })
            });

            if (!response.ok) {
                const errData = await response.json();
                console.error("❌ Meta API Send Error:", errData.error?.message);
            }
            
            // Tiny delay to ensure sequential delivery
            await new Promise(resolve => setTimeout(resolve, 300));
            
        } catch (error) {
            console.error("❌ Meta API Network Error:", error.message);
        }
    }
};

// We will need a helper to fetch images from Meta's secure vault
const getMetaMediaUrl = async (mediaId) => {
    const token = process.env.META_ACCESS_TOKEN;
    try {
        const res = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        return data.url; // Returns the secure URL which must be fetched with the token later
    } catch (e) {
        console.error("Failed to fetch Meta Media URL:", e);
        return null;
    }
};

module.exports = { sendMetaWhatsApp, getMetaMediaUrl };