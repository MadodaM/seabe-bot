// routes/metaRouter.js
const express = require('express');
const router = express.Router();
const { processLwaziMessage } = require('../bots/lwaziBot');
const { sendMetaWhatsApp, getMetaMediaUrl } = require('../services/metaClient');

// 🔒 1. Meta Webhook Verification (Required by Facebook when setting up the app)
router.get('/', (req, res) => {
    const verify_token = process.env.META_VERIFY_TOKEN; // You define this in your .env
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token) {
        if (mode === "subscribe" && token === verify_token) {
            console.log("✅ Meta Webhook Verified!");
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    }
});

// 📩 2. Receive Incoming Lwazi Messages
router.post('/', async (req, res) => {
    // Acknowledge receipt to Meta immediately
    res.sendStatus(200); 

    try {
        const body = req.body;

        // Verify this is a WhatsApp API event
        if (body.object === 'whatsapp_business_account') {
            const entry = body.entry[0];
            const changes = entry.changes[0];
            const value = changes.value;

            // Ensure there is a message
            if (value.messages && value.messages.length > 0) {
                const message = value.messages[0];
                
                const cleanPhone = message.from; // Sender's phone number
                let incomingMsg = '';
                let mediaUrl = null;

                // Handle Text
                if (message.type === 'text') {
                    incomingMsg = message.text.body.trim().toLowerCase();
                } 
                // Handle Images (For the AI Tutor)
                else if (message.type === 'image') {
                    incomingMsg = message.image.caption ? message.image.caption.trim().toLowerCase() : '';
                    const mediaId = message.image.id;
                    mediaUrl = await getMetaMediaUrl(mediaId);
                }

                // 🚀 Pass it directly to Lwazi Bot (Injecting the Meta sender!)
                await processLwaziMessage(cleanPhone, incomingMsg, mediaUrl, sendMetaWhatsApp);
            }
        }
    } catch (error) {
        console.error("❌ Meta Webhook Processing Error:", error);
    }
});

module.exports = router;