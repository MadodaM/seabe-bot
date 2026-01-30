// ==========================================
// VERSION 1.1 - SEABE PLATFORM (HYBRID EDITION)
// DATE: 30 JAN 2026
// MERGE: v1.0 (Payments/Cache) + v0.9 (Admin/CRM)
// ==========================================

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const sgMail = require('@sendgrid/mail'); 
const cron = require('node-cron');
const axios = require('axios'); // For HubSpot
const multer = require('multer'); // For Web Forms
const twilio = require('twilio'); 
const { MessagingResponse } = require('twilio').twiml;
const { createPaymentLink, createSubscriptionLink } = require('./services/paystack');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const ACCOUNT_SID = process.env.TWILIO_SID || process.env.TWILIO_ACCOUNT_SID; 
const AUTH_TOKEN = process.env.TWILIO_AUTH || process.env.TWILIO_AUTH_TOKEN;
const GOOGLE_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_KEY = process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : null;
const SHEET_ID = '1OKVh9Q-Gcs8EjKWIedXa6KM0N-j77JfK_QHaTd0GKQE'; 
const SENDGRID_KEY = process.env.SENDGRID_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM;
const ADMIN_NUMBERS = ['27832182707']; // Add your number here
const LOGO_URL = 'https://seabe.co.za/img/logo.png';

// --- SETUP ---
if (SENDGRID_KEY) sgMail.setApiKey(SENDGRID_KEY);
const app = express();
const upload = multer({ dest: 'uploads/' });
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

let client;
try {
    if (ACCOUNT_SID && AUTH_TOKEN) client = require('twilio')(ACCOUNT_SID, AUTH_TOKEN);
} catch (e) { console.log("⚠️ Twilio Error"); }

// --- 🧠 MEMORY CACHE ---
let userSession = {}; 
let cachedChurches = []; 
let cachedAds = [];  
let cachedEvents = []; 

// --- 🔄 DATABASE ENGINE ---
async function getDoc() {
    if (!GOOGLE_EMAIL || !GOOGLE_KEY) throw new Error("Missing Google Credentials");
    const serviceAccountAuth = new JWT({ email: GOOGLE_EMAIL, key: GOOGLE_KEY, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    return doc;
}

// Global Refresh Function (The v1.0 Speed Engine)
async function refreshCache() {
    console.log("🔄 Refreshing Cache...");
    try {
        const doc = await getDoc();
        
        // 1. Churches
        const churchSheet = doc.sheetsByTitle['Churches'] || doc.sheetsByIndex[2];
        const churchRows = await churchSheet.getRows();
        cachedChurches = churchRows.map(row => {
            const name = row.get('Name');
            const code = row.get('Church Code');
            const subaccount = row.get('Subaccount Code'); 
            const email = row.get('Email');
            if (!name || !code) return null;
            return { code: code.trim(), name: name.trim(), email: email ? email.trim() : "", subaccount: subaccount ? subaccount.trim() : null };
        }).filter(c => c !== null);

        // 2. Ads
        const adSheet = doc.sheetsByTitle['Ads'] || doc.sheetsByIndex[1];
        if (adSheet) {
            const adRows = await adSheet.getRows();
            cachedAds = adRows.filter(r => r.get('Status') === 'Active').map(r => ({
                 target: r.get('Target') || 'Global', 
                 ENGLISH: r.get('English'), ZULU: r.get('Zulu'), SOTHO: r.get('Sotho')
            }));
        }

        // 3. Events
        const eventSheet = doc.sheetsByTitle['Events'] || doc.sheetsByIndex[4];
        if (eventSheet) {
            const eventRows = await eventSheet.getRows();
            cachedEvents = eventRows.filter(r => r.get('Status') === 'Active').map(r => ({
                churchCode: r.get('Church Code'), name: r.get('Event Name'), price: r.get('Price'), date: r.get('Date')
            }));
        }
        console.log(`✅ Cache Updated: ${cachedChurches.length} Churches, ${cachedEvents.length} Events.`);
        return true;
    } catch (e) { console.error("❌ Cache Error:", e.message); return false; }
}
refreshCache(); // Start immediately
setInterval(refreshCache, 600000); // Repeat every 10 mins

// --- 🛠️ HELPER FUNCTIONS ---

// v0.9 CRM: Sync to HubSpot
async function syncToHubSpot(data) {
    if (!process.env.HUBSPOT_TOKEN) return;
    try {
        await axios.post('https://api.hubapi.com/crm/v3/objects/contacts', {
            properties: { firstname: data.name, email: data.email, phone: data.phone, lifecyclestage: 'lead' }
        }, { headers: { 'Authorization': `Bearer ${process.env.HUBSPOT_TOKEN}` } });
    } catch (e) { console.error("HubSpot Error:", e.message); }
}

// v0.9 Admin: Save Event (And refresh cache!)
async function saveEventToSheet(name, date, price = '0') {
    try {
        const doc = await getDoc();
        const sheet = doc.sheetsByTitle['Events'];
        // Default to Global (or specific church if we had one)
        await sheet.addRow({ 
            'Church Code': 'GLOBAL', 
            'Event Name': name, 
            'Date': date, 
            'Price': price, 
            'Status': 'Active', 
            'Created By': 'WhatsApp Admin' 
        });
        await refreshCache(); // 🔥 Instant Update
        return true;
    } catch (e) { return false; }
}

// v0.9 Admin: Broadcast
async function broadcastMessage(messageBody) {
    if (!client) return "⚠️ Twilio Client not ready.";
    let count = 0;
    try {
        const doc = await getDoc();
        const sheet = doc.sheetsByTitle['Subscribers'];
        if (!sheet) return "⚠️ No Subscribers sheet.";
        const rows = await sheet.getRows();
        for (const row of rows) {
            const number = row.get('Phone');
            if (number) {
                const toNum = number.includes('whatsapp:') ? number : `whatsapp:${number}`;
                await client.messages.create({ body: `📢 *Seabe News*\n\n${messageBody}`, from: 'whatsapp:+14155238886', to: toNum });
                count++;
            }
        }
        return `✅ Sent to ${count} subscribers.`;
    } catch (e) { return "⚠️ Broadcast failed."; }
}

// v1.0 User: Save Subscriber
async function saveSubscriber(phone) {
    try {
        const doc = await getDoc();
        let sheet = doc.sheetsByTitle['Subscribers'];
        if (!sheet) sheet = await doc.addSheet({ title: 'Subscribers', headerValues: ['Phone'] });
        const rows = await sheet.getRows();
        if (!rows.some(r => r.get('Phone') === phone)) await sheet.addRow({ 'Phone': phone });
    } catch (e) { console.error("Sub Save Error:", e.message); }
}

// v1.0 PDF Receipt
function generatePDF(type, amount, ref, date, phone, churchName) {
    const doc = new PDFDocument({ size: 'A5', margin: 50 });
    const filename = `receipt_${Date.now()}_${phone.slice(-4)}.pdf`;
    const filePath = path.join(__dirname, 'public', 'receipts', filename);
    if (!fs.existsSync(path.dirname(filePath))){ fs.mkdirSync(path.dirname(filePath), { recursive: true }); }
    doc.pipe(fs.createWriteStream(filePath));
    doc.fontSize(20).text('RECEIPT', 50, 100, { align: 'right' });
    doc.fontSize(10).text(churchName, { align: 'right' });
    doc.text(`Ref: ${ref}`); doc.text(`Member: ${phone}`); 
    doc.fontSize(16).text(`AMOUNT: R ${amount}.00`, 50);
    doc.end();
    return filename;
}

// --- 🌐 WEB ROUTES ---
app.get('/', (req, res) => res.send(`<h1>Seabe v1.1 Hybrid Live 🟢</h1><p>Payments + Admin Active.</p>`));

app.get('/register', (req, res) => res.send(`<form action="/register-church" method="POST"><h2>Register Church</h2><input name="churchName" placeholder="Name"><button>Submit</button></form>`));

// v0.9 CRM: Demo Request
app.get('/demo', (req, res) => res.send(`<form action="/request-demo" method="POST"><input name="firstname" placeholder="Name"><input name="email" placeholder="Email"><button>Request</button></form>`));
app.post('/request-demo', upload.none(), async (req, res) => {
    const { firstname, email, phone } = req.body;
    if (SENDGRID_KEY) await sgMail.send({ to: EMAIL_FROM, from: EMAIL_FROM, subject: `🔥 Lead: ${firstname}`, html: `<p>New Lead</p>` });
    await syncToHubSpot({ name: firstname, email, phone });
    res.send("<h1>Done ✅</h1>");
});

// --- 🤖 WHATSAPP LOGIC ---
app.post('/whatsapp', async (req, res) => {
    const twiml = new MessagingResponse();
    const incomingMsg = req.body.Body.trim().toLowerCase(); 
    const sender = req.body.From; 
    const cleanPhone = sender.replace('whatsapp:', '');
    let reply = "";

    // 🛡️ ADMIN GATEKEEPER (v0.9 Logic)
    if (ADMIN_NUMBERS.includes(cleanPhone)) {
        if (incomingMsg === 'admin') {
            userSession[cleanPhone] = { step: 'ADMIN_MENU' };
            reply = `🛠️ *Admin Menu*\n\n1. 📅 New Event\n2. 📢 Broadcast\n3. 🔄 Refresh Cache\n4. 🔙 Exit`;
            twiml.message(reply); res.type('text/xml').send(twiml.toString()); return;
        }
        if (userSession[cleanPhone]?.step?.startsWith('ADMIN')) {
            const step = userSession[cleanPhone].step;
            if (step === 'ADMIN_MENU') {
                if (incomingMsg === '1') { reply = "📅 *Event Name?*"; userSession[cleanPhone].step = 'ADMIN_EVENT_NAME'; }
                else if (incomingMsg === '2') { reply = "📢 *Message?*"; userSession[cleanPhone].step = 'ADMIN_BROADCAST'; }
                else if (incomingMsg === '3') { await refreshCache(); reply = "✅ Cache Refreshed!"; }
                else { delete userSession[cleanPhone]; reply = "Exited Admin Mode."; }
            }
            else if (step === 'ADMIN_EVENT_NAME') {
                userSession[cleanPhone].step = 'ADMIN_EVENT_DATE'; userSession[cleanPhone].eventName = req.body.Body; reply = "🗓️ *Date?* (e.g. 25 Dec)";
            }
            else if (step === 'ADMIN_EVENT_DATE') {
                await saveEventToSheet(userSession[cleanPhone].eventName, req.body.Body);
                reply = "✅ Event Saved & Live!"; delete userSession[cleanPhone];
            }
            else if (step === 'ADMIN_BROADCAST') {
                reply = await broadcastMessage(req.body.Body); delete userSession[cleanPhone];
            }
            twiml.message(reply); res.type('text/xml').send(twiml.toString()); return;
        }
    }

    // 👤 USER LOGIC (v1.0 Logic)
    if (incomingMsg === 'hi' || incomingMsg === 'menu') {
        saveSubscriber(sender); // Build mailing list
        // Dynamic Search in Cache
        let list = "👋 *Welcome to Seabe*\n_Connecting the Kingdom_\n\n*Select a Church:*\n";
        cachedChurches.forEach((c, i) => list += `*${i+1}.* ${c.name}\n`);
        reply = list;
        userSession[cleanPhone] = { step: 'SELECT_CHURCH' };
    } 
    else if (userSession[cleanPhone]?.step === 'SELECT_CHURCH') {
        const selection = parseInt(incomingMsg) - 1;
        if (cachedChurches[selection]) {
            userSession[cleanPhone].church = cachedChurches[selection];
            userSession[cleanPhone].step = 'MAIN_MENU';
            const msg = twiml.message();
            msg.media(LOGO_URL); // v0.9 Branding
            msg.body(`Welcome to *${cachedChurches[selection].name}* ⛪\n\n1. Pay Tithe 💰\n2. Offering 🎁\n3. Events 🎟️\n4. Switch Church 🔄`);
            res.type('text/xml').send(twiml.toString()); return;
        } else reply = "⚠️ Invalid number.";
    }
    else if (userSession[cleanPhone]?.step === 'MAIN_MENU') {
        if (['1', '2'].includes(incomingMsg)) {
            userSession[cleanPhone].step = 'PAY_AMOUNT';
            userSession[cleanPhone].payType = incomingMsg === '1' ? 'TITHE' : 'OFFERING';
            reply = "Enter Amount (e.g. 100):";
        }
        else if (incomingMsg === '3') {
            const events = cachedEvents; // Use cached events
            if (events.length === 0) reply = "No upcoming events.";
            else {
                let list = "*Select Event:*\n";
                events.forEach((e, i) => list += `*${i+1}.* ${e.name} (R${e.price})\n`);
                reply = list;
                userSession[cleanPhone].step = 'SELECT_EVENT';
            }
        }
        else if (incomingMsg === '4') { delete userSession[cleanPhone]; reply = "Reply Hi to start over."; }
    }
    else if (userSession[cleanPhone]?.step === 'PAY_AMOUNT') {
        const amount = incomingMsg.replace(/\D/g, '');
        const church = userSession[cleanPhone].church;
        const type = userSession[cleanPhone].payType;
        const ref = `${church.code}-${type}-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-5)}`;
        
        // v1.0 Payment Link
        const link = await createPaymentLink(amount, ref, `${cleanPhone}@seabe.io`, church.subaccount);
        
        if (link) {
            reply = `Tap to Pay R${amount}:\n👉 ${link}`;
            // v1.0 Async Receipt Logic
            setTimeout(async () => {
                 const pdfName = generatePDF(type, amount, ref, new Date().toLocaleString(), cleanPhone, church.name);
                 const host = req.headers.host || 'seabe-bot.onrender.com';
                 try { await client.messages.create({ from: 'whatsapp:+14155238886', to: sender, body: `🎉 Payment Received!`, mediaUrl: [`https://${host}/public/receipts/${pdfName}`] }); } catch(e){}
            }, 15000); // Simulate payment success delay
        } else reply = "Error creating link.";
        userSession[cleanPhone].step = 'MAIN_MENU';
    }

    if (!reply) reply = "Reply *Hi* to start.";
    twiml.message(reply);
    res.type('text/xml').send(twiml.toString());
});

app.listen(PORT, () => console.log(`✅ Seabe v1.1 running on ${PORT}`));