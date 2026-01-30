const express = require('express');
const bodyParser = require('body-parser');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const MessagingResponse = require('twilio').twiml.MessagingResponse;
const twilio = require('twilio'); // Import standard Twilio library
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(bodyParser.urlencoded({ extended: false }));

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const SHEET_ID = '1OKVh9Q-Gcs8EjKWIedXa6KM0N-j77JfK_QHaTd0GKQE';
const ADMIN_NUMBERS = ['27832182707']; 
const LOGO_URL = 'https://seabe.co.za/img/logo.png'; 

// --- IN-MEMORY CACHE ---
let userState = {}; 

// --- GOOGLE SHEETS SETUP ---
const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

async function getDoc() {
    const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    return doc;
}

// --- HELPER: SAVE SUBSCRIBER (Builds your mailing list) ---
async function saveSubscriber(phone) {
    try {
        const doc = await getDoc();
        // Check if 'Subscribers' sheet exists, if not, don't crash
        if (!doc.sheetsByTitle['Subscribers']) return; 
        
        const sheet = doc.sheetsByTitle['Subscribers'];
        const rows = await sheet.getRows();
        
        // Check if number already exists
        const exists = rows.some(row => row.get('Phone') === phone);
        if (!exists) {
            await sheet.addRow({ 'Phone': phone });
            console.log(`📝 New Subscriber Added: ${phone}`);
        }
    } catch (e) { console.error("Sub Save Error:", e.message); }
}

// --- HELPER: SEND BROADCAST (The Mass Sender) ---
async function broadcastMessage(messageBody) {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
        return "⚠️ Error: Twilio Keys (SID/Auth) missing in Render.";
    }
    
    const client = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    let count = 0;

    try {
        const doc = await getDoc();
        if (!doc.sheetsByTitle['Subscribers']) return "⚠️ Error: 'Subscribers' tab missing in Sheets.";
        
        const sheet = doc.sheetsByTitle['Subscribers'];
        const rows = await sheet.getRows();

        // Loop through every subscriber and send
        for (const row of rows) {
            const number = row.get('Phone');
            if (number) {
                // Determine format (WhatsApp requires 'whatsapp:' prefix)
                const toNum = number.includes('whatsapp:') ? number : `whatsapp:${number}`;
                
                await client.messages.create({
                    body: `📢 *Seabe News*\n\n${messageBody}`,
                    from: 'whatsapp:+14155238886', // Standard Sandbox Number (Change to yours if live)
                    to: toNum
                });
                count++;
            }
        }
        return `✅ Sent to ${count} subscribers.`;
    } catch (e) {
        console.error("Broadcast Error:", e);
        return "⚠️ Error sending broadcast (Check logs).";
    }
}

// --- HELPER: GET EVENTS ---
async function getEventsFromSheet() {
    try {
        const doc = await getDoc();
        const sheet = doc.sheetsByTitle['Events'];
        const rows = await sheet.getRows();
        if (rows.length === 0) return "No upcoming events.";
        let message = "📅 *Upcoming Events*\n";
        rows.slice(0, 5).forEach(row => { 
            message += `\n📌 *${row.get('Event Name')}*\n🗓️ ${row.get('Date')}\n`;
        });
        return message;
    } catch (e) { return "⚠️ Could not fetch events."; }
}

async function saveEventToSheet(name, date) {
    try {
        const doc = await getDoc();
        const sheet = doc.sheetsByTitle['Events'];
        await sheet.addRow({ 'Event Name': name, 'Date': date, 'Created By': 'WhatsApp Admin' });
        return true;
    } catch (e) { return false; }
}

async function findChurchByName(query) {
    try {
        const doc = await getDoc();
        const sheet = doc.sheetsByTitle['Churches'];
        const rows = await sheet.getRows();
        const results = rows.filter(row => row.get('Name') && row.get('Name').toLowerCase().includes(query.toLowerCase()));
        if (results.length === 0) return "❌ No churches found.";
        let msg = "🔎 *Search Results:*\n";
        results.slice(0, 5).forEach(row => {
            msg += `\n⛪ *${row.get('Name')}*\nCode: ${row.get('Church Code')}\n`;
        });
        return msg;
    } catch (e) { return "⚠️ Search unavailable."; }
}

// --- ROUTES ---
app.get('/', async (req, res) => res.send(`<h1>Seabe Platform Live 🟢</h1>`));
app.get('/register', (req, res) => res.send(`<form action="/register-church" method="POST" enctype="multipart/form-data"><h2>Register</h2><input name="churchName" placeholder="Church Name"><button>Submit</button></form>`));

// --- WHATSAPP BOT ---
app.post('/whatsapp', async (req, res) => {
    const twiml = new MessagingResponse();
    const sender = req.body.From;
    const cleanPhone = sender.replace('whatsapp:', '').replace('+', '').trim();
    const rawPhone = sender; // Keep original for saving (includes whatsapp: prefix usually)
    const msgBody = req.body.Body ? req.body.Body.trim().toLowerCase() : ''; 
    const currentState = userState[cleanPhone] ? userState[cleanPhone].step : null;

    // --- A. ADMIN MENU ---
    if (msgBody === 'admin' && ADMIN_NUMBERS.includes(cleanPhone)) {
        twiml.message(`🛠️ *Admin Menu*\n\n1. 📅 New Event\n2. 📢 Broadcast News\n3. ❌ Cancel`);
        userState[cleanPhone] = { step: 'ADMIN_MENU' };
        
    } else if (msgBody === 'cancel' || msgBody === 'reset') {
        delete userState[cleanPhone];
        twiml.message("🔄 Reset. Reply *Hi*.");

    // --- B. LOGIC ---
    } else if (currentState === 'ADMIN_MENU') {
        if (msgBody === '1') {
            twiml.message("📅 *New Event Name?*");
            userState[cleanPhone] = { step: 'ADMIN_EVENT_NAME' };
        } else if (msgBody === '2') {
            twiml.message("📢 *Type your message for everyone:*");
            userState[cleanPhone] = { step: 'ADMIN_BROADCAST' };
        } else {
            twiml.message("❌ Invalid.");
        }

    // --- ADMIN: EVENT FLOW ---
    } else if (currentState === 'ADMIN_EVENT_NAME') {
        userState[cleanPhone] = { step: 'ADMIN_EVENT_DATE', eventName: req.body.Body };
        twiml.message("🗓️ *Date?*");

    } else if (currentState === 'ADMIN_EVENT_DATE') {
        const name = userState[cleanPhone].eventName;
        const date = req.body.Body;
        twiml.message("⏳ Saving...");
        await saveEventToSheet(name, date);
        twiml.message(`✅ *Event Saved!*\n📌 ${name}\n🗓️ ${date}`);
        delete userState[cleanPhone];

    // --- ADMIN: BROADCAST FLOW (New!) ---
    } else if (currentState === 'ADMIN_BROADCAST') {
        const broadcastMsg = req.body.Body;
        twiml.message("⏳ Sending Broadcast... (This may take a moment)");
        
        // Trigger the broadcast
        const report = await broadcastMessage(broadcastMsg);
        
        // Notify Admin of result
        const msg = twiml.message();
        msg.body(report);
        delete userState[cleanPhone];

    } else if (currentState === 'SEARCH_CHURCH') {
        const results = await findChurchByName(msgBody);
        twiml.message(results);
        delete userState[cleanPhone];

    // --- C. MAIN MENU & SUBSCRIBER SAVING ---
    } else if (msgBody === 'hi' || msgBody === 'hello' || msgBody === 'menu') {
        
        // 1. Save user to "Subscribers" sheet silently
        saveSubscriber(sender);

        // 2. Send Welcome Menu
        const msg = twiml.message();
        msg.media(LOGO_URL); 
        msg.body(
            `👋 *Welcome to Seabe*\n` +
            `_Connecting the Kingdom_\n\n` +
            `1️⃣ Events (View)\n` +
            `2️⃣ Find a Church (Search)\n` +
            `3️⃣ Register (Add Church)`
        );
        userState[cleanPhone] = { step: 'MAIN_MENU' };

    } else if (currentState === 'MAIN_MENU') {
        if (msgBody === '1') {
            const events = await getEventsFromSheet();
            twiml.message(events);
            delete userState[cleanPhone];
        } else if (msgBody === '2') {
            twiml.message("🔎 *Type the name* of the church:");
            userState[cleanPhone] = { step: 'SEARCH_CHURCH' };
        } else if (msgBody === '3') {
            twiml.message("📝 *Register here:* https://seabe.co.za/register");
            delete userState[cleanPhone];
        } else {
            twiml.message("❌ Invalid option.");
        }

    } else {
        twiml.message("👋 Reply *Hi* for the menu.");
    }

    res.type('text/xml').send(twiml.toString());
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));