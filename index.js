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
// 👇 REPLACE THIS WITH YOUR LOGO URL
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

// --- HELPERS ---
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

        if (results.length === 0) return "❌ No churches found with that name.";

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

// --- WHATSAPP BOT (Branded Version) ---
app.post('/whatsapp', async (req, res) => {
    const twiml = new MessagingResponse();
    const sender = req.body.From;
    const cleanPhone = sender.replace('whatsapp:', '').replace('+', '').trim();
    const msgBody = req.body.Body ? req.body.Body.trim().toLowerCase() : ''; 
    const currentState = userState[cleanPhone] ? userState[cleanPhone].step : null;

    // --- ADMIN ---
    if (msgBody === 'admin' && ADMIN_NUMBERS.includes(cleanPhone)) {
        twiml.message(`🛠️ *Admin Menu*\n\n1. 📅 New Event\n2. ❌ Cancel`);
        userState[cleanPhone] = { step: 'ADMIN_MENU' };
        
    // --- RESET ---
    } else if (msgBody === 'cancel' || msgBody === 'reset') {
        delete userState[cleanPhone];
        twiml.message("🔄 Reset. Reply *Hi*.");

    // --- LOGIC ---
    } else if (currentState === 'ADMIN_MENU') {
        if (msgBody === '1') {
            twiml.message("📅 *New Event Name?*");
            userState[cleanPhone] = { step: 'ADMIN_EVENT_NAME' };
        } else twiml.message("❌ Invalid.");

    } else if (currentState === 'ADMIN_EVENT_NAME') {
        userState[cleanPhone] = { step: 'ADMIN_EVENT_DATE', eventName: req.body.Body };
        twiml.message("🗓️ *Date?*");

    } else if (currentState === 'ADMIN_EVENT_DATE') {
        const name = userState[cleanPhone].eventName;
        const date = req.body.Body;
        twiml.message("⏳ Saving...");
        await saveEventToSheet(name, date);
        
        // 🎨 BRANDED SUCCESS MESSAGE
        const msg = twiml.message();
        // msg.media(LOGO_URL); // Uncomment if you want logo on success too
        msg.body(`✅ *Event Saved!*\n📌 ${name}\n🗓️ ${date}`);
        delete userState[cleanPhone];

    } else if (currentState === 'SEARCH_CHURCH') {
        const results = await findChurchByName(msgBody);
        twiml.message(results);
        delete userState[cleanPhone];

    // --- MAIN MENU (BRANDED) ---
    } else if (msgBody === 'hi' || msgBody === 'hello' || msgBody === 'menu') {
        const msg = twiml.message();
        
        // 🎨 THE LOGO MAGIC IS HERE
        // If the URL is valid, this image appears at the top!
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