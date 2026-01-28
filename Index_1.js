// Seabe Bot - MVP (Hello World)
// Run this with: node index.js

const express = require('express');
const bodyParser = require('body-parser');
const { MessagingResponse } = require('twilio').twiml;

const { createPaymentLink } = require('./services/stitch');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// --- 🧠 THE MEMORY (Temporary Storage) ---
// We store what the user is doing here.
// Format: { '27821234567': 'TITHE' }
let userSession = {}; 

app.post('/whatsapp', async (req, res) => {
    const incomingMsg = req.body.Body.trim().toLowerCase(); 
    const sender = req.body.From; // e.g., whatsapp:+2782...
    const cleanPhone = sender.replace('whatsapp:', '');
    
    const twiml = new MessagingResponse();
    let reply = "";

    console.log(`📩 ${cleanPhone}: ${incomingMsg}`);

    // SCENARIO 1: The Menu
    if (['hi', 'hello', 'dumela', 'menu'].includes(incomingMsg)) {
        reply = `Dumela! 👋 Welcome to *Seabe*.\n\nReply with a number:\n*1.* General Offering 🎁\n*2.* Pay Tithe (10%) 🏛️\n*3.* Support Help 🆘`;
        userSession[cleanPhone] = 'MENU'; // Reset memory
    } 
    
    // SCENARIO 2: Selected OFFERING
    else if (incomingMsg === '1') {
        userSession[cleanPhone] = 'OFFERING'; // <--- REMEMBER THIS
        reply = `Amen! 🎁\n\nHow much is your *Offering*?\n(e.g. Type *R50* or *R200*)`;
    }

    // SCENARIO 3: Selected TITHE
    else if (incomingMsg === '2') {
        userSession[cleanPhone] = 'TITHE'; // <--- REMEMBER THIS
        reply = `Bringing the full tithe. 🏛️\n\nPlease enter your *Tithe Amount*:\n(e.g. Type *R1000*)`;
    }

    // SCENARIO 4: The Amount (Processing)
    else if (incomingMsg.match(/R?\d+/)) {
        const amount = incomingMsg.replace(/\D/g,''); 
        
        // CHECK MEMORY: What are they paying for?
        const paymentType = userSession[cleanPhone] || 'OFFERING'; // Default to Offering if unknown
        
        // Create a custom reference (e.g., TITHE-1234 or OFFER-1234)
        // We take the last 4 digits of their phone number for privacy
        const last4Digits = cleanPhone.slice(-4);
        const reference = `${paymentType}-${last4Digits}`;

        try {
            // PASS THE REFERENCE TO STITCH
            // You need to update your createPaymentLink function to accept this!
			// We pack the PHONE NUMBER into the reference sent to Stitch function
			const compoundRef = cleanPhone + "__" + reference; 
			const paymentUrl = await createPaymentLink(amount + ".00", compoundRef);
                        
            if (paymentUrl) {
                reply = `Received for *${paymentType}*. 🌱\n\nTap to pay R${amount}:\n👉 ${paymentUrl}`;
                // Clear memory after link is generated
                delete userSession[cleanPhone];
            } else {
                reply = "System Error. Try again.";
            }
        } catch (err) {
            console.log(err);
            reply = "System Error.";
        }
    }

    // FALLBACK
    else {
        reply = `Sorry, reply with *Hi* to start over.`;
    }

    twiml.message(reply);
    res.type('text/xml').send(twiml.toString());
});

const PORT = process.env.PORT || 3000;
// --- 🪝 THE WEBHOOK (Stitch calls this) ---
app.post('/stitch-webhook', async (req, res) => {
    // 1. Acknowledge receipt immediately (So Stitch stops calling)
    res.sendStatus(200);

    const event = req.body;
    console.log("🔔 Webhook received:", event.subscription.type);

    // 2. Check if it is a SUCCESSFUL payment
    // (Stitch sends many events, we only care about 'PaymentInitiationRequestCompleted')
    if (event.subscription.type === 'client.payment_initiation_request.completed') {
        
        const data = event.payload;
        
        // 3. Extract the Phone Number from that "Hidden Pocket"
        // We stored it as: "TITHE-1234__Timestamp"
        // But wait... in index.js previously we passed "TITHE-1234" as reference.
        // We need the ACTUAL phone number to reply. 
        
        // CORRECTION: Let's rely on the user session or pass the full phone in the reference.
        // For this simple version, let's assume the user is still in the 'userSession' memory 
        // OR we just use the reference we have.
        
        // TRICK: The externalReference comes back exactly as we sent it.
        // Let's rely on the fact that we have the reference.
        
        const externalRef = data.externalReference; // e.g. "TITHE-1234__999999"
        
        // We can't reply to "TITHE-1234", we need "2782..."
        // Since we didn't save it to a database, we can't reply yet! 
    }
});
// --- 🪝 THE WEBHOOK ---
// You must use bodyParser.json() to read Stitch data
app.use(bodyParser.json()); 

app.post('/stitch-webhook', (req, res) => {
    console.log("🔔 WEBHOOK HIT!");
    console.log(JSON.stringify(req.body, null, 2)); // Print the data
    res.sendStatus(200);
});
app.listen(PORT, () => {
    console.log(`✅ Seabe Bot (with Memory) is running on ${PORT}`);
});