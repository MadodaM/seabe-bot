// routes/whatsapp.js
// PURPOSE: Catch and route all incoming WhatsApp messages from Twilio
const express = require('express');
const router = express.Router();

// POST: Twilio sends incoming messages here
router.post('/incoming', async (req, res) => {
    // Twilio sends the data as URL-encoded form data
    const incomingMsg = req.body.Body || '';
    const senderPhone = req.body.From || ''; // Format: "whatsapp:+27821234567"
    const mediaUrl = req.body.MediaUrl0;     // If they attach a PDF or Image

    console.log(`\n📲 --- NEW WHATSAPP MESSAGE ---`);
    console.log(`From: ${senderPhone}`);
    console.log(`Message: ${incomingMsg}`);
    if (mediaUrl) console.log(`Attachment: ${mediaUrl}`);
    console.log(`------------------------------\n`);

    try {
        // ==========================================
        // 🧠 TODO: AI Routing Engine Goes Here
        // ==========================================
        // 1. Check if the user is a registered member in Prisma
        // 2. If message == "Claim", route to Surepol Death Claims bot
        // 3. If message == "Support", forward to human admin
        // ==========================================

        // Twilio requires a strict XML (TwiML) response. 
        // We can send an auto-reply right here, or just send an empty response to acknowledge receipt.
        const twiml = `
            <Response>
                <Message>Hi from Seabe! We received your message: "${incomingMsg}". Our AI assistant is currently being connected.</Message>
            </Response>
        `;

        res.set('Content-Type', 'text/xml');
        res.send(twiml);

    } catch (error) {
        console.error("❌ WhatsApp Webhook Error:", error);
        res.set('Content-Type', 'text/xml');
        res.send('<Response></Response>'); // Fail gracefully so Twilio doesn't error out
    }
});

module.exports = router;