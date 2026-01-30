const express = require('express');
const bodyParser = require('body-parser');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const MessagingResponse = require('twilio').twiml.MessagingResponse;
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');
const sgMail = require('@sendgrid/mail');
require('dotenv').config();

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static('public'));

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const SHEET_ID = '1OKVh9Q-Gcs8EjKWIedXa6KM0N-j77JfK_QHaTd0GKQE';
const ADMIN_NUMBERS = ['27832182707']; // Your Phone Number

// --- GOOGLE SHEETS SETUP ---
const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// --- IN-MEMORY CACHE ---
let churches = [];
let events = [];
let userState = {}; // Stores where the user is in the conversation

async function getDoc() {
    const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    return doc;
}

// Refresh Data from Sheets
async function refreshCache() {
    try {
        console.log("🔄 Starting Cache Refresh...");
        const doc = await getDoc();
        
        // Load Churches
        const churchSheet = doc.sheetsByTitle['Churches'];
        const churchRows = await churchSheet.getRows();
        churches = churchRows.map(row => ({
            name: row.get('Name'),
            code: row.get('Church Code'),
            subaccount: row.get('Subaccount Code')
        }));

        // Load Events
        const eventSheet = doc.sheetsByTitle['Events'];
        const eventRows = await eventSheet.getRows();
        events = eventRows.map(row => ({
            name: row.get('Event Name'),
            date: row.get('Date'),
            church: row.get('Church'),
            price: row.get('Price')
        }));

        console.log(`♻️ REFRESH COMPLETE: ${churches.length} Churches, ${events.length} Events.`);
    } catch (error) {
        console.error("❌ CACHE ERROR:", error.message);
    }
}

// Run cache refresh on startup
refreshCache();

// --- HELPER FUNCTIONS ---
async function emailReport(target) {
    console.log("Generating report for:", target);
    return "Report functionality coming soon.";
}

async function registerUser(phone, churchCode) {
    // Placeholder for saving user registration to sheet
    console.log(`Registering ${phone} to ${churchCode}`);
    return true;
}

// --- ROUTE 1: HOMEPAGE ---
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// --- ROUTE 2: REQUEST DEMO (SendGrid + HubSpot) ---
app.post('/request-demo', upload.none(), async (req, res) => {
    const { firstname, email, phone } = req.body;

    if (process.env.SENDGRID_KEY) {
        sgMail.setApiKey(process.env.SENDGRID_KEY);
    }

    try {
        // 1. Send Email
        try {
            const msg = {
                to: process.env.EMAIL_FROM,
                from: process.env.EMAIL_FROM,
                subject: `🔥 New Lead: ${firstname}`,
                html: `
                    <div style="font-family: Arial; padding: 20px;">
                        <h2 style="color: #075E54;">New Demo Request</h2>
                        <p><strong>Name:</strong> ${firstname}</p>
                        <p><strong>Email:</strong> ${email}</p>
                        <p><strong>Phone:</strong> ${phone}</p>
                    </div>`
            };
            await sgMail.send(msg);
            console.log("✅ Email Sent");
        } catch (e) {
            console.error("❌ Email Error:", e.message);
        }

        // 2. HubSpot Sync
        if (process.env.HUBSPOT_TOKEN) {
            await axios.post('https://api.hubapi.com/crm/v3/objects/contacts', {
                properties: { firstname, email, phone, lifecyclestage: 'lead' }
            }, {
                headers: { 'Authorization': `Bearer ${process.env.HUBSPOT_TOKEN}` }
            });
            console.log("✅ HubSpot Synced");
        }

        res.send('<h1>Received! ✅</h1><a href="/">Back</a>');
    } catch (error) {
        console.error(error);
        res.send('<h1>Error</h1>');
    }
});

// --- ROUTE 3: CHURCH REGISTRATION (Files + SendGrid) ---
app.post('/register-church', upload.fields([{ name: 'idDoc' }, { name: 'bankDoc' }]), async (req, res) => {
    try {
        const { churchName, email, eventName, eventPrice } = req.body;
        const files = req.files;

        // Generate Code
        const prefix = churchName.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
        const newCode = `${prefix}${Math.floor(100 + Math.random() * 900)}`;

        // Save to Sheet
        const doc = await getDoc();
        const sheet = doc.sheetsByTitle['Churches'];
        await sheet.addRow({
            'Name': churchName, 'Church Code': newCode, 'Email': email,
            'Subaccount Code': 'PENDING', 'Event Name': eventName || 'Special Event',
            'Event_Price': eventPrice || '0'
        });

        // Send Email with Attachments
        if (process.env.SENDGRID_KEY && files['idDoc'] && files['bankDoc']) {
            sgMail.setApiKey(process.env.SENDGRID_KEY);
            const idFile = files['idDoc'][0];
            const bankFile = files['bankDoc'][0];

            const msg = {
                to: process.env.EMAIL_FROM,
                from: process.env.EMAIL_FROM,
                subject: `🆕 Registration: ${churchName}`,
                html: `<p>New Church: ${churchName} (${newCode})</p>`,
                attachments: [
                    { content: fs.readFileSync(idFile.path).toString("base64"), filename: "ID.pdf", type: "application/pdf", disposition: "attachment" },
                    { content: fs.readFileSync(bankFile.path).toString("base64"), filename: "Bank.pdf", type: "application/pdf", disposition: "attachment" }
                ]
            };
            await sgMail.send(msg);
            
            // Cleanup
            fs.unlinkSync(idFile.path);
            fs.unlinkSync(bankFile.path);
        }

        res.send(`<h1>Application Received! ✅</h1><p>Code: ${newCode}</p>`);
    } catch (error) {
        console.error("Reg Error:", error);
        res.send("<h1>Error processing application</h1>");
    }
});

// --- ROUTE 4: WHATSAPP BOT (The Logic Core) ---
app.post('/whatsapp', async (req, res) => {
    const twiml = new MessagingResponse();
    const sender = req.body.From;
    const cleanPhone = sender.replace('whatsapp:', '').replace('+', '').trim();
    const msgBody = req.body.Body ? req.body.Body.trim().toLowerCase() : ''; 

    console.log(`User: ${cleanPhone} | Msg: ${msgBody}`);

    // --- 1. ADMIN MENU ---
    if (msgBody === 'admin' && ADMIN_NUMBERS.includes(cleanPhone)) {
        twiml.message(`🛠️ *Admin Menu*\n1. New Event\n2. Report\n3. Cancel`);
        userState[cleanPhone] = { step: 'ADMIN_MENU' };
        res.type('text/xml').send(twiml.toString());
        return;
    }

    // --- 2. CANCEL / RESET ---
    if (msgBody === 'cancel' || msgBody === 'reset') {
        delete userState[cleanPhone];
        twiml.message("🔄 Reset. Reply *Hi*.");
        res.type('text/xml').send(twiml.toString());
        return;
    }

    const currentState = userState[cleanPhone] ? userState[cleanPhone].step : null;

    // --- 3. CONVERSATION FLOW ---
    if (currentState === 'ADMIN_MENU') {
        if (msgBody === '1') {
            twiml.message("📅 Event Name?");
            userState[cleanPhone] = { step: 'ADMIN_EVENT_NAME' };
        } else if (msgBody === '2') {
            // Report logic
            const reply = await emailReport('ALL');
            twiml.message("✅ " + reply);
            delete userState[cleanPhone];
        } else {
            twiml.message("❌ Invalid.");
        }
    
    } else if (currentState === 'ADMIN_EVENT_NAME') {
        userState[cleanPhone] = { step: 'ADMIN_EVENT_DATE', eventName: req.body.Body };
        twiml.message("🗓️ Date?");

    } else if (currentState === 'ADMIN_EVENT_DATE') {
        const name = userState[cleanPhone].eventName;
        const date = req.body.Body;
        // Save logic here
        twiml.message(`🎉 Created: ${name} on ${date}`);
        delete userState[cleanPhone];

    } else if (msgBody === 'hi' || msgBody === 'hello' || msgBody === 'menu') {
        const msg = twiml.message();
        msg.body(`👋 *Welcome to Seabe*\n1️⃣ Events\n2️⃣ Churches\n3️⃣ Register`);
        userState[cleanPhone] = { step: 'MAIN_MENU' };

    } else {
        twiml.message("👋 Reply *Hi* for menu.");
    }

    res.type('text/xml').send(twiml.toString());
});

// --- START SERVER ---
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});