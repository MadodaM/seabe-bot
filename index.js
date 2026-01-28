const express = require('express');
const bodyParser = require('body-parser');
const { MessagingResponse } = require('twilio').twiml;
const { createPaymentLink } = require('./services/stitch');

// --- TWILIO CONFIG (For Receipts) ---
// We pull these from the Cloud Settings (Environment Variables)
const ACCOUNT_SID = process.env.TWILIO_SID; 
const AUTH_TOKEN = process.env.TWILIO_AUTH;

let client;
try {
    if (ACCOUNT_SID && AUTH_TOKEN) {
        client = require('twilio')(ACCOUNT_SID, AUTH_TOKEN);
    } else {
        console.log("⚠️ No Twilio Keys found. Receipts will skip.");
    }
} catch (e) {
    console.log("⚠️ Twilio Init Error");
}

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

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
    // HANDLE AMOUNT + AUTO-RECEIPT
    else if (incomingMsg.match(/R?\d+/)) {
        const amount = incomingMsg.replace(/\D/g,''); 
        const paymentType = userSession[cleanPhone] || 'OFFERING'; 
        const last4Digits = cleanPhone.slice(-4);
        const churchRef = `${paymentType}-${last4Digits}`;
        const compoundRef = `${cleanPhone}__${churchRef}`;

        // 1. Get the Link
        const paymentUrl = await createPaymentLink(amount + ".00", compoundRef); 
        
        reply = `Received for *${paymentType}*. 🌱\n\nTap to pay R${amount}:\n👉 ${paymentUrl}`;
        delete userSession[cleanPhone];

        // 2. THE DEMO TRICK (Auto-Receipt) 🪄
        // Wait 15 seconds (15000 ms), then send the receipt automatically
        if (client) {
            setTimeout(async () => {
                console.log(`⏰ Timer Done. Sending Fake Receipt to ${cleanPhone}`);
                try {
                    await client.messages.create({
                        from: 'whatsapp:+14155238886', // Twilio Sandbox Number
                        to: sender, // Send back to the user
                        body: `🎉 *Payment Received!*\n\nAmen! We have received your *R${amount}* for *${churchRef}*.\n\nThank you for your generosity. 🙏`
                    });
                } catch (err) {
                    console.error("❌ Auto-Receipt Failed:", err.message);
                }
            }, 15000); // <--- 15 Seconds Delay
        }
    }
    else {
        reply = `Sorry, reply with *Hi* to start over.`;
    }

    twiml.message(reply);
    res.type('text/xml').send(twiml.toString());
});

// --- 2. THE WEBHOOK (Keep this for the future) ---
app.post('/stitch-webhook', (req, res) => {
    res.sendStatus(200); // Just say OK
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Seabe Bot (Auto-Demo Mode) is running on ${PORT}`);
});const express = require('express');
const bodyParser = require('body-parser');
const { MessagingResponse } = require('twilio').twiml;
const { createPaymentLink } = require('./services/stitch');
const { GoogleSpreadsheet } = require('google-spreadsheet'); // 👈 NEW TOOL

// --- CONFIG ---
const ACCOUNT_SID = process.env.TWILIO_SID; 
const AUTH_TOKEN = process.env.TWILIO_AUTH;
// 👇 NEW GOOGLE KEYS (We will add these to Render/Environment later)
const GOOGLE_EMAIL = process.env.GOOGLE_EMAIL;
const GOOGLE_KEY = process.env.GOOGLE_KEY ? process.env.GOOGLE_KEY.replace(/\\n/g, '\n') : null;
const SHEET_ID = process.env.SHEET_ID; // The long ID from your Browser URL

let client;
try {
    if (ACCOUNT_SID && AUTH_TOKEN) client = require('twilio')(ACCOUNT_SID, AUTH_TOKEN);
} catch (e) { console.log("⚠️ Twilio Error"); }

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

let userSession = {}; 

// --- HELPER: WRITE TO SHEET ---
async function logToSheet(phone, type, amount, ref) {
    if (!GOOGLE_EMAIL || !GOOGLE_KEY || !SHEET_ID) {
        console.log("⚠️ Google Sheets Keys missing. Skipping log.");
        return;
    }
    try {
        // 1. Authenticate
        const doc = new GoogleSpreadsheet(SHEET_ID);
        await doc.useServiceAccountAuth({
            client_email: GOOGLE_EMAIL,
            private_key: GOOGLE_KEY,
        });
        await doc.loadInfo(); 
        
        // 2. Add Row
        const sheet = doc.sheetsByIndex[0]; // The first tab
        await sheet.addRow({
            Date: new Date().toLocaleString(),
            "Name/Phone": phone,
            "Type": type,
            "Amount": amount,
            "Reference": ref
        });
        console.log("📝 Row added to Sheet!");
    } catch (error) {
        console.error("❌ Sheet Error:", error.message);
    }
}

// --- WHATSAPP BOT ---
app.post('/whatsapp', async (req, res) => {
    const incomingMsg = req.body.Body.trim().toLowerCase(); 
    const sender = req.body.From; 
    const cleanPhone = sender.replace('whatsapp:', '');
    const twiml = new MessagingResponse();
    let reply = "";

    if (['hi', 'hello', 'dumela', 'menu'].includes(incomingMsg)) {
        reply = `Dumela! 👋 Welcome to *Seabe*.\n\nReply with a number:\n*1.* General Offering 🎁\n*2.* Pay Tithe (10%) 🏛️`;
        userSession[cleanPhone] = 'MENU';
    } 
    else if (['1', '2'].includes(incomingMsg)) {
        userSession[cleanPhone] = incomingMsg === '1' ? 'OFFERING' : 'TITHE';
        reply = incomingMsg === '1' ? `Amen! 🎁\nHow much is your *Offering*?` : `Bringing the full tithe. 🏛️\nEnter amount:`;
    }
    else if (incomingMsg.match(/R?\d+/)) {
        const amount = incomingMsg.replace(/\D/g,''); 
        const paymentType = userSession[cleanPhone] || 'OFFERING'; 
        const churchRef = `${paymentType}-${cleanPhone.slice(-4)}`;
        const compoundRef = `${cleanPhone}__${churchRef}`;

        const paymentUrl = await createPaymentLink(amount + ".00", compoundRef); 
        
        reply = `Received for *${paymentType}*. 🌱\n\nTap to pay R${amount}:\n👉 ${paymentUrl}`;
        delete userSession[cleanPhone];

        // AUTO-RECEIPT + SHEET LOGGING 🪄
        if (client) {
            setTimeout(async () => {
                // 1. Send Receipt
                try {
                    await client.messages.create({
                        from: 'whatsapp:+14155238886',
                        to: sender,
                        body: `🎉 *Payment Received!*\n\nAmen! We have received your *R${amount}* for *${churchRef}*.\n\nThank you for your generosity. 🙏`
                    });
                } catch (err) { console.error("❌ Receipt Failed"); }
                
                // 2. Log to Dashboard (Sheet) 📊
                await logToSheet(cleanPhone, paymentType, amount, churchRef);

            }, 15000); 
        }
    }
    else { reply = `Sorry, reply with *Hi* to start over.`; }

    twiml.message(reply);
    res.type('text/xml').send(twiml.toString());
});

app.post('/stitch-webhook', (req, res) => res.sendStatus(200));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Seabe Bot running on ${PORT}`));