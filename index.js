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

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const SHEET_ID = '1OKVh9Q-Gcs8EjKWIedXa6KM0N-j77JfK_QHaTd0GKQE';

// --- GOOGLE SHEETS SETUP (Wrapped to prevent crashing) ---
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

// --- ROUTE 1: HOMEPAGE (Direct HTML) ---
app.get('/', (req, res) => {
    res.send(`
        <div style="font-family:sans-serif; text-align:center; padding:50px;">
            <h1 style="color:#075E54;">Seabe Platform is Online 🟢</h1>
            <p>Our WhatsApp Bot is active.</p>
            <a href="/register" style="color:#25D366; font-weight:bold;">Register Church</a>
        </div>
    `);
});

// --- ROUTE 2: REGISTRATION PAGE (Test Uploads) ---
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

// --- ROUTE 3: PROCESS REGISTRATION (SendGrid) ---
app.post('/register-church', upload.fields([{ name: 'idDoc' }, { name: 'bankDoc' }]), async (req, res) => {
    try {
        const { churchName, email } = req.body;
        
        // 1. Save to Sheets (Try/Catch so it doesn't crash if Google fails)
        try {
            const doc = await getDoc();
            const sheet = doc.sheetsByTitle['Churches'];
            await sheet.addRow({ 'Name': churchName, 'Email': email, 'Subaccount Code': 'PENDING' });
        } catch (sheetError) {
            console.error("Sheet Error (Ignored):", sheetError.message);
        }

        // 2. Send Email
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
            
            // Clean up files
            fs.unlinkSync(idFile.path);
            fs.unlinkSync(bankFile.path);
        }

        res.send('<h1>Received! ✅</h1>');
    } catch (error) {
        console.error(error);
        res.send('<h1>Error (Check Logs)</h1>');
    }
});

// --- ROUTE 4: SIMPLE WHATSAPP BOT ---
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
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});