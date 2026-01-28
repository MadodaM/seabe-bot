require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { MessagingResponse } = require('twilio').twiml;
const { createPaymentLink } = require('./services/stitch');

// --- NEW IMPORTS FOR GOOGLE V4 ---
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library'); // 👈 This fixes the error

// --- CONFIG ---
const ACCOUNT_SID = process.env.TWILIO_SID; 
const AUTH_TOKEN = process.env.TWILIO_AUTH;

// GOOGLE KEYS
const GOOGLE_EMAIL = process.env.GOOGLE_EMAIL;
// Handle the new lines correctly
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

// --- HELPER: WRITE TO SHEET (UPDATED FOR V4) ---
async function logToSheet(phone, type, amount, ref) {
    if (!GOOGLE_EMAIL || !GOOGLE_KEY || !SHEET_ID) {
        console.log("ℹ️ Dashboard skipped (Keys missing).");
        return;
    }

    try {
        // 1. Setup Auth (The New Way)
        const serviceAccountAuth = new JWT({
            email: GOOGLE_EMAIL,
            key: GOOGLE_KEY,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        // 2. Load the Doc
        const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
        await doc.loadInfo(); 
        
        // 3. Add Row
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
                // 1. Send Receipt (Might fail if limit reached, but we keep going)
                try {
                    await client.messages.create({
                        from: 'whatsapp:+14155238886',
                        to: sender,
                        body: `🎉 *Payment Received!*\n\nAmen! We have received your *R${amount}* for *${churchRef}*.\n\nThank you for your generosity. 🙏`
                    });
                } catch (err) { console.error("❌ Receipt Failed (Limit reached?)"); }
                
                // 2. Log to Dashboard
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