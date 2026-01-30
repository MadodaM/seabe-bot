const express = require('express');
const bodyParser = require('body-parser');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const MessagingResponse = require('twilio').twiml.MessagingResponse;
const multer = require('multer');
const fs = require('fs');
const sgMail = require('@sendgrid/mail');
require('dotenv').config();

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(bodyParser.urlencoded({ extended: false }));

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const SHEET_ID = '1OKVh9Q-Gcs8EjKWIedXa6KM0N-j77JfK_QHaTd0GKQE';
const ADMIN_NUMBERS = ['27832182707']; // 👈 YOUR NUMBER

// --- IN-MEMORY CACHE (To make the bot fast) ---
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

// --- HELPER: GET EVENTS ---
async function getEventsFromSheet() {
    try {
        const doc = await getDoc();
        const sheet = doc.sheetsByTitle['Events']; // Ensure you have a tab named "Events"
        const rows = await sheet.getRows();
        
        if (rows.length === 0) return "No upcoming events.";
        
        let message = "📅 *Upcoming Events*\n";
        rows.slice(0, 5).forEach(row => { // Show max 5
            message += `\n📌 *${row.get('Event Name')}*\n🗓️ ${row.get('Date')}\n`;
        });
        return message;
    } catch (e) {
        console.error("Fetch Error:", e);
        return "⚠️ Could not fetch events right now.";
    }
}

// --- HELPER: SAVE EVENT ---
async function saveEventToSheet(name, date) {
    try {
        const doc = await getDoc();
        const sheet = doc.sheetsByTitle['Events'];
        // Ensure headers exist: "Event Name", "Date", "Created By"
        await sheet.addRow({ 
            'Event Name': name, 
            'Date': date, 
            'Created By': 'WhatsApp Admin' 
        });
        return true;
    } catch (e) {
        console.error("Save Error:", e);
        return false;
    }
}

// --- ROUTE 1: HOMEPAGE ---
app.get('/', async (req, res) => {
    res.send(`<h1>Seabe Platform Live 🟢</h1><p>Bot is active.</p>`);
});

// --- ROUTE 2: REGISTRATION (Kept simple) ---
app.get('/register', (req, res) => {
    res.send(`<form action="/register-church" method="POST" enctype="multipart/form-data">
        <h2>Register</h2><input name="churchName" placeholder="Church Name"><button>Submit</button>
    </form>`);
});

// --- ROUTE 3: WHATSAPP BOT (The Full Version) ---
app.post('/whatsapp', async (req, res) => {
    const twiml = new MessagingResponse();
    const sender = req.body.From;
    const cleanPhone = sender.replace('whatsapp:', '').replace('+', '').trim();
    const msgBody = req.body.Body ? req.body.Body.trim().toLowerCase() : ''; 

    console.log(`User: ${cleanPhone} | Msg: ${msgBody}`);

    // --- A. ADMIN MENU ---
    if (msgBody === 'admin' && ADMIN_NUMBERS.includes(cleanPhone)) {
        twiml.message(`🛠️ *Admin Command Center*\n\n1. 📅 New Event\n2. ❌ Cancel`);
        userState[cleanPhone] = { step: 'ADMIN_MENU' };
        res.type('text/xml').send(twiml.toString());
        return;
    }

    // --- B. RESET ---
    if (msgBody === 'cancel' || msgBody === 'reset') {
        delete userState[cleanPhone];
        twiml.message("🔄 Reset. Reply *Hi*.");
        res.type('text/xml').send(twiml.toString());
        return;
    }

    // --- C. CONVERSATION FLOW ---
    const currentState = userState[cleanPhone] ? userState[cleanPhone].step : null;

    // 1. Handling Admin Selection
    if (currentState === 'ADMIN_MENU') {
        if (msgBody === '1') {
            twiml.message("📅 *New Event*\nReply with the *Event Name*:");
            userState[cleanPhone] = { step: 'ADMIN_EVENT_NAME' };
        } else {
            twiml.message("❌ Invalid. Reply 1 or Cancel.");
        }
    
    // 2. Admin: Get Name -> Ask Date
    } else if (currentState === 'ADMIN_EVENT_NAME') {
        userState[cleanPhone] = { step: 'ADMIN_EVENT_DATE', eventName: req.body.Body };
        twiml.message("🗓️ Reply with *Date* (e.g. 25 Dec):");

    // 3. Admin: Get Date -> Save to Sheet
    } else if (currentState === 'ADMIN_EVENT_DATE') {
        const name = userState[cleanPhone].eventName;
        const date = req.body.Body;
        
        twiml.message("⏳ Saving to Google Sheets...");
        
        const success = await saveEventToSheet(name, date);
        
        if (success) {
            twiml.message(`✅ *Event Saved!*\n📌 ${name}\n🗓️ ${date}`);
        } else {
            twiml.message("⚠️ Error saving to Sheet. Check logs.");
        }
        delete userState[cleanPhone];

    // 4. MAIN MENU
    } else if (msgBody === 'hi' || msgBody === 'hello' || msgBody === 'menu') {
        twiml.message(
            `👋 *Welcome to Seabe*\n` +
            `1️⃣ *Events* (View Upcoming)\n` +
            `2️⃣ *Register* (Add Church)`
        );
        userState[cleanPhone] = { step: 'MAIN_MENU' };

    // 5. USER SELECTION
    } else if (currentState === 'MAIN_MENU' && msgBody === '1') {
        const eventsMsg = await getEventsFromSheet();
        twiml.message(eventsMsg);
        delete userState[cleanPhone];

    } else {
        twiml.message("👋 Reply *Hi* for the menu.");
    }

    res.type('text/xml').send(twiml.toString());
});

// --- START SERVER ---
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});