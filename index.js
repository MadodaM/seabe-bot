const express = require('express');
const bodyParser = require('body-parser');
const { MessagingResponse } = require('twilio').twiml;
const { createPaymentLink } = require('./services/stitch');
// We try to load Google Sheets, but if it fails, we don't crash.
let GoogleSpreadsheet;
try {
    GoogleSpreadsheet = require('google-spreadsheet').GoogleSpreadsheet;
} catch (e) {
    console.log("⚠️ Google Spreadsheet module not installed. Skipping.");
}

// --- CONFIG ---
const ACCOUNT_SID = process.env.TWILIO_SID; 
const AUTH_TOKEN = process.env.TWILIO_AUTH;

// GOOGLE KEYS (If these are missing, the bot just skips the dashboard part)
const GOOGLE_EMAIL = process.env.GOOGLE_EMAIL;
const GOOGLE_KEY = process.env.GOOGLE_KEY ? process.env.GOOGLE_KEY.replace(/\\n/g, '\n') : null;
const SHEET_ID = process.env.SHEET_ID;

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
    // If we don't have keys or the module, just stop.
    if (!GoogleSpreadsheet || !GOOGLE_EMAIL || !GOOGLE_KEY || !SHEET_ID) {
        console.log("ℹ️ Dashboard skipped (Keys missing).");
        return;
    }
    try {
        const doc = new GoogleSpreadsheet(SHEET_ID);
        await doc.useServiceAccountAuth({
            client_email: GOOGLE_EMAIL,
            private_key: GOOGLE_KEY,
        });
        await doc.loadInfo(); 
        const sheet = doc.sheetsByIndex[0];
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

        // AUTO-RECEIPT + SHEET LOGGING
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
                
                // 2. Log to Dashboard (Will safely skip if no keys)
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