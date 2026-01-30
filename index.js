const express = require('express');
const bodyParser = require('body-parser');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const MessagingResponse = require('twilio').twiml.MessagingResponse;
const twilio = require('twilio');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios'); // RESTORED: HubSpot
const sgMail = require('@sendgrid/mail');
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

// --- RESTORED FEATURE: HUBSPOT SYNC ---
async function syncToHubSpot(data) {
    if (!process.env.HUBSPOT_TOKEN) return;
    try {
        await axios.post('https://api.hubapi.com/crm/v3/objects/contacts', {
            properties: { 
                firstname: data.name, 
                email: data.email, 
                phone: data.phone, 
                lifecyclestage: 'lead' 
            }
        }, {
            headers: { 'Authorization': `Bearer ${process.env.HUBSPOT_TOKEN}` }
        });
        console.log("✅ HubSpot Synced");
    } catch (e) { console.error("HubSpot Error:", e.message); }
}

// --- RESTORED FEATURE: JOIN CHURCH (The "Link" Function) ---
async function registerUserToChurch(phone, churchCode) {
    try {
        const doc = await getDoc();
        // Check if 'Members' sheet exists
        let sheet = doc.sheetsByTitle['Members'];
        if (!sheet) {
            sheet = await doc.addSheet({ title: 'Members', headerValues: ['Phone', 'Church Code', 'Joined Date'] });
        }
        await sheet.addRow({ 
            'Phone': phone, 
            'Church Code': churchCode, 
            'Joined Date': new Date().toISOString().split('T')[0] 
        });
        console.log(`✅ Linked ${phone} to ${churchCode}`);
        return true;
    } catch (e) {
        console.error("Link Error:", e);
        return false;
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

        if (results.length === 0) return null; // Return null to handle "No Results" logic
        
        // Return structured data for the bot to use
        return results.slice(0, 5).map(row => ({
            name: row.get('Name'),
            code: row.get('Church Code')
        }));
    } catch (e) { return null; }
}

// --- ROUTE 1: HOMEPAGE ---
app.get('/', async (req, res) => {
    res.send(`<h1>Seabe Platform Live 🟢</h1><p>Bot & CRM Active.</p>`);
});

// --- ROUTE 2: CHURCH REGISTRATION ---
app.get('/register', (req, res) => res.send(`<form action="/register-church" method="POST" enctype="multipart/form-data"><h2>Register Church</h2><input name="churchName" placeholder="Church Name"><button>Submit</button></form>`));

// --- ROUTE 3: RESTORED DEMO REQUEST ---
app.get('/demo', (req, res) => {
    res.send(`
        <form action="/request-demo" method="POST">
            <h2>Request Demo</h2>
            <input name="firstname" placeholder="Name" required>
            <input name="email" placeholder="Email" required>
            <input name="phone" placeholder="Phone">
            <button>Request</button>
        </form>
    `);
});

app.post('/request-demo', upload.none(), async (req, res) => {
    const { firstname, email, phone } = req.body;
    // 1. Send Email
    if (process.env.SENDGRID_KEY) {
        sgMail.setApiKey(process.env.SENDGRID_KEY);
        await sgMail.send({
            to: process.env.EMAIL_FROM,
            from: process.env.EMAIL_FROM,
            subject: `🔥 Lead: ${firstname}`,
            html: `<p>New Demo Request from ${firstname}</p>`
        });
    }
    // 2. Sync to HubSpot
    await syncToHubSpot({ name: firstname, email, phone });
    res.send("<h1>Request Received! ✅</h1>");
});


// --- WHATSAPP BOT (With Linking Logic) ---
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
        
    } else if (msgBody === 'cancel' || msgBody === 'reset') {
        delete userState[cleanPhone];
        twiml.message("🔄 Reset. Reply *Hi*.");

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
        await saveEventToSheet(name, date);
        twiml.message(`✅ *Event Saved!*\n📌 ${name}\n🗓️ ${date}`);
        delete userState[cleanPhone];

    // --- RESTORED LOGIC: SEARCH & JOIN ---
    } else if (currentState === 'SEARCH_CHURCH') {
        const churches = await findChurchByName(msgBody);
        
        if (!churches) {
            twiml.message("❌ No churches found. Try again.");
        } else {
            // Save results to user state so they can pick one
            userState[cleanPhone] = { step: 'SELECT_CHURCH', results: churches };
            
            let msg = "🔎 *Select your Church:*\n";
            churches.forEach((c, index) => {
                msg += `\n*${index + 1}*. ${c.name} (${c.code})`;
            });
            msg += "\n\nReply with the *Number* (e.g., 1) to join.";
            twiml.message(msg);
        }

    } else if (currentState === 'SELECT_CHURCH') {
        const choice = parseInt(msgBody) - 1;
        const choices = userState[cleanPhone].results;

        if (choices && choices[choice]) {
            const selectedChurch = choices[choice];
            
            // 🔥 THIS IS THE CRITICAL RESTORED FUNCTION
            await registerUserToChurch(cleanPhone, selectedChurch.code);
            
            twiml.message(`✅ *Welcome Home!* \nYou have successfully joined *${selectedChurch.name}*.\n\nReply *Hi* to see the menu.`);
            delete userState[cleanPhone];
        } else {
            twiml.message("❌ Invalid choice. Reply with the number.");
        }

    // --- MAIN MENU ---
    } else if (msgBody === 'hi' || msgBody === 'hello' || msgBody === 'menu') {
        const msg = twiml.message();
        msg.media(LOGO_URL); 
        msg.body(
            `👋 *Welcome to Seabe*\n` +
            `_Connecting the Kingdom_\n\n` +
            `1️⃣ Events (View)\n` +
            `2️⃣ Find & Join Church 🆕\n` +
            `3️⃣ Register (Add Church)`
        );
        userState[cleanPhone] = { step: 'MAIN_MENU' };

    } else if (currentState === 'MAIN_MENU') {
        if (msgBody === '1') {
            const events = await getEventsFromSheet();
            twiml.message(events);
            delete userState[cleanPhone];
        } else if (msgBody === '2') {
            twiml.message("🔎 *Type the name* of your church to join:");
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