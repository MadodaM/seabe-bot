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

// --- SAFE STARTUP CHECK ---
// This runs once when server starts to test the connection
async function testGoogleConnection() {
    try {
        console.log("🔄 Testing Google Sheets Connection...");
        const doc = await getDoc();
        console.log(`✅ SUCCESS: Connected to Sheet "${doc.title}"`);
        return true;
    } catch (error) {
        console.error(`⚠️ GOOGLE WARNING: Could not connect to Sheets.`);
        console.error(`Error Details: ${error.message}`);
        console.error(`(The bot is still running, but data won't save)`);
        return false;
    }
}

// --- ROUTE 1: HOMEPAGE ---
app.get('/', (req, res) => {
    res.send(`
        <div style="font-family:sans-serif; text-align:center; padding:50px;">
            <h1 style="color:#075E54;">Seabe Platform is Online 🟢</h1>
            <p>Google Sheets Integration: <strong>Active</strong></p>
            <a href="/register" style="color:#25D366; font-weight:bold;">Register Church</a>
        </div>
    `);
});

// --- ROUTE 2: REGISTRATION PAGE ---
app.get('/register', (req, res) => {
    res.send(`
        <form action="/register-church" method="POST" enctype="multipart/form-data" style="padding:20px; max-width:400px; margin:auto; font-family:sans-serif;">
            <h2>Register Church</h2>
            <input type="text" name="churchName" placeholder="Church Name" required style="width:100%; margin-bottom:10px; padding:10px;">
            <input type="email" name="email" placeholder="Email" required style="width:100%; margin-bottom:10px; padding:10px;">
            <p>Upload ID:</p><input type="file" name="idDoc" required style="margin-bottom:10px;">
            <p>Upload Bank Letter:</p><input type="file" name="bankDoc" required style="margin-bottom:20px;">
            <button type="submit" style="background:#25D366; color:white; border:none; padding:15px; width:100%;">Submit</button>
        </form>
    `);
});

// --- ROUTE 3: PROCESS REGISTRATION (With Sheets Saving) ---
app.post('/register-church', upload.fields([{ name: 'idDoc' }, { name: 'bankDoc' }]), async (req, res) => {
    try {
        const { churchName, email } = req.body;
        
        // 1. SAVE TO SHEETS (Wrapped in Try/Catch)
        try {
            const doc = await getDoc();
            const sheet = doc.sheetsByTitle['Churches'];
            
            // Generate a random code
            const prefix = churchName.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
            const newCode = `${prefix}${Math.floor(100 + Math.random() * 900)}`;

            await sheet.addRow({ 
                'Name': churchName, 
                'Church Code': newCode,
                'Email': email, 
                'Subaccount Code': 'PENDING' 
            });
            console.log(`✅ Saved ${churchName} to Sheets.`);
        } catch (sheetError) {
            console.error("❌ Sheet Save Failed:", sheetError.message);
            // We continue anyway so the email still sends!
        }

        // 2. SEND EMAIL
        if (process.env.SENDGRID_KEY && req.files['idDoc'] && req.files['bankDoc']) {
            sgMail.setApiKey(process.env.SENDGRID_KEY);
            const idFile = req.files['idDoc'][0];
            const bankFile = req.files['bankDoc'][0];

            const msg = {
                to: process.env.EMAIL_FROM,
                from: process.env.EMAIL_FROM,
                subject: `🆕 Registration: ${churchName}`,
                html: `<p>New application received for ${churchName}.</p>`,
                attachments: [
                    { content: fs.readFileSync(idFile.path).toString("base64"), filename: "ID.pdf", type: "application/pdf", disposition: "attachment" },
                    { content: fs.readFileSync(bankFile.path).toString("base64"), filename: "Bank.pdf", type: "application/pdf", disposition: "attachment" }
                ]
            };
            await sgMail.send(msg);
            
            fs.unlinkSync(idFile.path);
            fs.unlinkSync(bankFile.path);
        }

        res.send('<h1>Received! ✅</h1><p>If connected, data is now in Google Sheets.</p>');
    } catch (error) {
        console.error(error);
        res.send('<h1>Error (Check Logs)</h1>');
    }
});

// --- ROUTE 4: WHATSAPP BOT ---
app.post('/whatsapp', async (req, res) => {
    const twiml = new MessagingResponse();
    const msgBody = req.body.Body ? req.body.Body.trim().toLowerCase() : '';

    if (msgBody === 'hi' || msgBody === 'hello' || msgBody === 'menu') {
        twiml.message(
            `👋 *Welcome to Seabe*\n` +
            `1️⃣ Events\n` +
            `2️⃣ Churches\n` +
            `3️⃣ Register`
        );
    } else {
        twiml.message("👋 Reply *Hi* for the menu.");
    }

    res.type('text/xml').send(twiml.toString());
});

// --- START SERVER ---
app.listen(PORT, async () => {
    console.log(`✅ Server running on port ${PORT}`);
    // Run the test AFTER the server starts so it doesn't block the startup
    await testGoogleConnection();
});