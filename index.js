const express = require('express');
const bodyParser = require('body-parser');
const { MessagingResponse } = require('twilio').twiml;
const { createPaymentLink } = require('./services/stitch');

// --- TWILIO CONFIG (For Receipts) ---
const ACCOUNT_SID = process.env.TWILIO_SID; 
const AUTH_TOKEN = process.env.TWILIO_AUTH;
// If you don't have keys handy, the bot will just log the receipt to console.
let client;
try {
    client = require('twilio')(ACCOUNT_SID, AUTH_TOKEN);
} catch (e) {
    console.log("⚠️ Twilio keys missing. Receipts will only show in Console.");
}

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json()); // Needed for the Webhook

// --- 🧠 MEMORY ---
let userSession = {}; 

// --- 1. THE WHATSAPP BOT ---
app.post('/whatsapp', async (req, res) => {
    const incomingMsg = req.body.Body.trim().toLowerCase(); 
    const sender = req.body.From; 
    const cleanPhone = sender.replace('whatsapp:', '');
    
    const twiml = new MessagingResponse();
    let reply = "";

    // MENU
    if (['hi', 'hello', 'dumela', 'menu'].includes(incomingMsg)) {
        reply = `Dumela! 👋 Welcome to *Seabe*.\n\nReply with a number:\n*1.* General Offering 🎁\n*2.* Pay Tithe (10%) 🏛️`;
        userSession[cleanPhone] = 'MENU';
    } 
    // OPTION 1
    else if (incomingMsg === '1') {
        userSession[cleanPhone] = 'OFFERING';
        reply = `Amen! 🎁\n\nHow much is your *Offering*?\n(e.g. Type *R50* or *R200*)`;
    }
    // OPTION 2
    else if (incomingMsg === '2') {
        userSession[cleanPhone] = 'TITHE';
        reply = `Bringing the full tithe. 🏛️\n\nPlease enter your *Tithe Amount*:\n(e.g. Type *R1000*)`;
    }
    // HANDLE AMOUNT
    else if (incomingMsg.match(/R?\d+/)) {
        const amount = incomingMsg.replace(/\D/g,''); 
        const paymentType = userSession[cleanPhone] || 'OFFERING'; 
        const last4Digits = cleanPhone.slice(-4);
        const churchRef = `${paymentType}-${last4Digits}`;

        // PACKING THE PHONE NUMBER (So we can unpack it later in the webhook)
        const compoundRef = `${cleanPhone}__${churchRef}`;

        const paymentUrl = await createPaymentLink(amount + ".00", compoundRef); 
        
        reply = `Received for *${paymentType}*. 🌱\n\nTap to pay R${amount}:\n👉 ${paymentUrl}`;
        delete userSession[cleanPhone];
    }
    else {
        reply = `Sorry, reply with *Hi* to start over.`;
    }

    twiml.message(reply);
    res.type('text/xml').send(twiml.toString());
});

// --- 2. THE WEBHOOK (The Receipt System) ---
app.post('/stitch-webhook', async (req, res) => {
    // Acknowledge immediately
    res.sendStatus(200);

    const event = req.body;
    console.log("🔔 Webhook Hit:", event.subscription ? event.subscription.type : "Manual Test");

    if (event.subscription && event.subscription.type === 'client.payment_initiation_request.completed') {
        const data = event.payload;
        
        // UNPACKING THE DATA
        // We expect externalReference to be: "27821234567__TITHE-1234"
        const externalRef = data.externalReference; 
        const [userPhone, churchRef] = externalRef.split('__');
        const amount = data.amount.quantity;

        console.log(`✅ SUCCESS! Sending receipt to ${userPhone} for R${amount}`);

        // SEND WHATSAPP RECEIPT
        if (client) {
            try {
                await client.messages.create({
                    from: 'whatsapp:+14155238886', // Twilio Sandbox Number
                    to: `whatsapp:+${userPhone}`,
                    body: `🎉 *Payment Received!*\n\nAmen! We have received your *R${amount}* for *${churchRef}*.\n\nThank you for your generosity. 🙏`
                });
                console.log("🚀 Receipt sent to phone!");
            } catch (err) {
                console.error("❌ Twilio Error:", err.message);
            }
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Seabe Bot (MOCK MODE) is running on ${PORT}`);
});