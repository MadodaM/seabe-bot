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
const ADMIN_NUMBERS = ['27832182707']; 

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

// --- HELPER 1: GET EVENTS ---
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
    } catch (e) {
        console.error("Fetch Error:", e);
        return "⚠️ Could not fetch events.";
    }
}

// --- HELPER 2: SAVE EVENT ---
async function saveEventToSheet(name, date) {
    try {
        const doc = await getDoc();
        const sheet = doc.sheetsByTitle['Events'];
        await sheet.addRow({ 'Event Name': name, 'Date': date, 'Created By': 'WhatsApp Admin' });
        return true;
    } catch (e) {
        console.error("Save Error:", e);
        return false;
    }
}

// --- HELPER 3: FIND CHURCH (New!) ---
async function findChurchByName(query) {
    try {
        const doc = await getDoc();
        const sheet = doc.sheetsByTitle['Churches'];
        const rows = await sheet.getRows();
        
        // Filter rows where "Name" contains the search query (Case Insensitive)
        const results = rows.filter(row => 
            row.get('Name') && row.get('Name').toLowerCase().includes(query.toLowerCase())
        );

        if (results.length === 0) return "❌ No churches found with that name. Try a different keyword.";

        let msg = "🔎 *Search Results:*\n";
        results.slice(0, 5).forEach(row => {
            msg += `\n⛪ *${row.get('Name')}*\nCode: ${row.get('Church Code')}\n`;
        });
        return msg;
    } catch (e) {
        console.error("Search Error:", e);
        return "⚠️ Search unavailable right now.";
    }
}

// --- ROUTE 1: HOMEPAGE ---
app.get('/', async (req, res) => {
    res.send(`<h1>Seabe Platform Live 🟢</h1><p>Bot is active.</p>`);
});

// --- ROUTE 2: REGISTRATION ---
app.get('/register', (req, res) => {
    res.send(`<form action="/register-church" method="POST" enctype="multipart/form-data">
        <h2>Register</h2><input name="churchName" placeholder="Church Name"><button>Submit</button>
    </form>`);
});

// --- ROUTE 3: WHATSAPP BOT ---
app.post('/whatsapp', async (req, res) => {
    const twiml = new MessagingResponse();
    const sender = req.body.From;
    const cleanPhone = sender.replace('whatsapp:', '').replace('+', '').trim();
    const msgBody = req.body.Body ? req.body.Body.trim().toLowerCase() : ''; 

    // --- A. ADMIN MENU ---
    if (msgBody === 'admin' && ADMIN_NUMBERS.includes(cleanPhone)) {
        twiml.message(`🛠️ *Admin Menu*\n\n1. 📅 New Event\n2. ❌ Cancel`);
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

    const currentState = userState[cleanPhone] ? userState[cleanPhone].step : null;

    // --- C. CONVERSATION LOGIC ---

    // 1. ADMIN FLOW
    if (currentState === 'ADMIN_MENU') {
        if (msgBody === '1') {
            twiml.message("📅 *New Event Name?*");
            userState[cleanPhone] = { step: 'ADMIN_EVENT_NAME' };
        } else {
            twiml.message("❌ Invalid.");
        }
    } else if (currentState === 'ADMIN_EVENT_NAME') {
        userState[cleanPhone] = { step: 'ADMIN_EVENT_DATE', eventName: req.body.Body };
        twiml.message("🗓️ *Date?*");
    } else if (currentState === 'ADMIN_EVENT_DATE') {
        const name = userState[cleanPhone].eventName;
        const date = req.body.Body;
        twiml.message("⏳ Saving...");
        await saveEventToSheet(name, date);
        twiml.message(`✅ Saved: ${name}`);
        delete userState[cleanPhone];

    // 2. SEARCH FLOW (The New Part!)
    } else if (currentState === 'SEARCH_CHURCH') {
        const results = await findChurchByName(msgBody);
        twiml.message(results);
        delete userState[cleanPhone]; // Reset after showing results

    // 3. MAIN MENU
    } else if (msgBody === 'hi' || msgBody === 'hello' || msgBody === 'menu') {
        twiml.message(
            `👋 *Welcome to Seabe*\n` +
            `1️⃣ Events (View)\n` +
            `2️⃣ Find a Church (Search)\n` +
            `3️⃣ Register (Add Church)`
        );
        userState[cleanPhone] = { step: 'MAIN_MENU' };

    // 4. MENU SELECTION
    } else if (currentState === 'MAIN_MENU') {
        if (msgBody === '1') {
            const events = await getEventsFromSheet();
            twiml.message(events);
            delete userState[cleanPhone];
        } else if (msgBody === '2') {
            twiml.message("🔎 *Type the name* of the church you are looking for:");
            userState[cleanPhone] = { step: 'SEARCH_CHURCH' }; // Start search mode
        } else if (msgBody === '3') {
            twiml.message("📝 *Register here:* https://seabe.co.za/register");
            delete userState[cleanPhone];
        } else {
            twiml.message("❌ Invalid option. Reply 1, 2, or 3.");
        }

    } else {
        twiml.message("👋 Reply *Hi* for the menu.");
    }

    res.type('text/xml').send(twiml.toString());
});

// --- START SERVER ---
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});