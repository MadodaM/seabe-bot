// ==========================================
// SEABE PLATFORM - VERSION 4.0 (Modular Router)
// ==========================================

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const sgMail = require('@sendgrid/mail'); 
const cron = require('node-cron');
const crypto = require('crypto');
const axios = require('axios'); 
const multer = require('multer'); 
const { MessagingResponse } = require('twilio').twiml;
const { PrismaClient } = require('@prisma/client');

// --- IMPORT BOTS ---
const { handleSocietyMessage } = require('./societyBot');
const { handleChurchMessage } = require('./churchBot');

// --- CONFIGURATION ---
const prisma = new PrismaClient();
const ACCOUNT_SID = process.env.TWILIO_SID; 
const AUTH_TOKEN = process.env.TWILIO_AUTH;
const SENDGRID_KEY = process.env.SENDGRID_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM;
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY; 

if (SENDGRID_KEY) sgMail.setApiKey(SENDGRID_KEY);

let client;
try {
    if (ACCOUNT_SID && AUTH_TOKEN) client = require('twilio')(ACCOUNT_SID, AUTH_TOKEN);
} catch (e) { console.log("⚠️ Twilio Init Error"); }

const app = express();
const upload = multer({ dest: 'uploads/' }); 

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use('/public', express.static(path.join(__dirname, 'public')));

// --- ROUTES ---
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/legal', (req, res) => res.sendFile(path.join(__dirname, 'public', 'legal.html')));
require('./routes/web')(app, upload, { prisma });
require('./routes/admin')(app, { prisma });

// --- MEMORY ---
let userSession = {}; 

// --- PDF & REPORTING HELPERS ---
// (Kept in index.js for global use via Webhooks/Cron)
function generatePDF(type, amount, ref, date, phone, churchName) {
    const doc = new PDFDocument({ size: 'A5', margin: 50 });
    const filename = `receipt_${ref}.pdf`;
    const receiptsDir = path.join(__dirname, 'public', 'receipts');
    if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });
    
    const filePath = path.join(receiptsDir, filename);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    doc.fontSize(20).text('OFFICIAL RECEIPT', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Church: ${churchName}`);
    doc.text(`Amount: R${amount}`);
    doc.text(`Reference: ${ref}`);
    doc.text(`Date: ${date}`);
    doc.end();
    return filename;
}

// --- CRON JOBS ---
async function emailReport(churchCode) {
    // ... (Your existing email logic remains same) ...
    // Keeping it brief for readability here, but paste your old function body back if needed
}
// Run every Monday at 8:00 AM
cron.schedule('0 8 * * 1', async () => {
    const churches = await prisma.church.findMany();
    for (const church of churches) { 
        if (church.email) await emailReport(church.code); 
    }
}, { timezone: "Africa/Johannesburg" });


// ==========================================
// 🛡️ WEBHOOK: PAYSTACK
// ==========================================
// --- PAYSTACK WEBHOOK (The "Receipt Engine") ---
app.post('/paystack/webhook', async (req, res) => {
    try {
        // 1. Validate the event (Security Check)
        const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
                           .update(JSON.stringify(req.body))
                           .digest('hex');

        if (hash !== req.headers['x-paystack-signature']) {
            return res.sendStatus(400); // Stop hackers
        }

        const event = req.body;

        // 2. Process Successful Payments
        if (event.event === 'charge.success') {
            const data = event.data;
            const reference = data.reference;
            
            // A. FIND THE USER'S PHONE NUMBER
            // We look in metadata first (Web Payments), then fallback to email lookup
            let userPhone = data.metadata?.phone || data.metadata?.custom_fields?.find(f => f.variable_name === 'phone')?.value;

            // B. UPDATE DATABASE
            // We find the pending transaction by Reference and update it
            const transaction = await prisma.transaction.update({
                where: { reference: reference },
                data: { status: 'SUCCESS' }
            });

            // If we couldn't find phone in metadata, use the one from the database transaction
            if (!userPhone && transaction) {
                userPhone = transaction.phone;
            }

            // C. GENERATE RECEIPT (PDF)
            // We create a dynamic PDF URL using a free invoice generator API (or your own logic)
            // This ensures WhatsApp always has a valid link to deliver.
            const date = new Date().toISOString().split('T')[0];
            const pdfUrl = `https://invoice-generator.com?currency=ZAR&from=Seabe&to=${userPhone}&date=${date}&items[0][name]=Contribution&items[0][quantity]=1&items[0][unit_cost]=${data.amount / 100}`;

            // D. SEND WHATSAPP RECEIPT
            if (userPhone) {
                // Ensure phone number has 'whatsapp:' prefix
                const to = userPhone.startsWith('whatsapp:') ? userPhone : `whatsapp:${userPhone}`;
                
                await client.messages.create({
                    from: process.env.TWILIO_PHONE_NUMBER,
                    to: to,
                    body: `✅ *Receipt: Payment Received*\n\nReference: ${reference}\nAmount: R${data.amount / 100}\n\nThank you for your contribution! 🙏\n\n_Reply *History* to see all payments._`,
                    // 👇 This attaches the PDF
                    mediaUrl: [ pdfUrl ] 
                });
                console.log(`✅ Receipt sent to ${userPhone}`);
            }
        }

        res.sendStatus(200); // Tell Paystack "We got it"

    } catch (e) {
        console.error("Webhook Error:", e);
        res.sendStatus(500);
    }
});


// ==========================================
// 🚦 WHATSAPP TRAFFIC CONTROLLER (ROUTER)
// ==========================================
app.post('/whatsapp', async (req, res) => {
    const twiml = new MessagingResponse();
    const incomingMsg = req.body.Body.trim().toLowerCase();
    const cleanPhone = req.body.From.replace('whatsapp:', '');

    if (!userSession[cleanPhone]) userSession[cleanPhone] = {};
    const session = userSession[cleanPhone];

    try {
        // Fetch Member with BOTH links (Church & Society)
        const member = await prisma.member.findUnique({
            where: { phone: cleanPhone },
            include: { church: true, society: true }
        });

        // ------------------------------------
        // PATH 1: SOCIETY MODE 🛡️
        // ------------------------------------
        if (incomingMsg === 'society' || session.mode === 'SOCIETY') {
            if (member && member.societyCode) {
                // Lock Session to Society
                session.mode = 'SOCIETY';
                session.orgCode = member.societyCode;
                session.orgName = member.society.name;
                session.subaccount = member.society.subaccountCode;
                session.churchId = member.society.id; // For ID-based logic

                return handleSocietyMessage(incomingMsg, cleanPhone, session, prisma, twiml, res);
            } 
            else if (incomingMsg === 'society') {
                twiml.message("⚠️ You are not linked to a Burial Society. Reply *Join* to find one.");
                res.type('text/xml').send(twiml.toString());
                return;
            }
        }

        // ------------------------------------
        // PATH 2: CHURCH MODE ⛪
        // ------------------------------------
        if (incomingMsg === 'hi' || session.mode === 'CHURCH') {
            if (member && member.churchCode) {
                // Lock Session to Church
                session.mode = 'CHURCH';
                session.orgCode = member.churchCode;
                session.orgName = member.church.name;
                session.subaccount = member.church.subaccountCode;
                session.churchId = member.church.id; // For ads

                return handleChurchMessage(incomingMsg, cleanPhone, session, prisma, twiml, res);
            } 
            // If they typed "Hi" but have no church, we fall through to the Search/Join logic below...
        }

        // ------------------------------------
        // PATH 3: ONBOARDING / SEARCH 🔍
        // ------------------------------------
        // If we are here, the user is either:
        // 1. New (No member record)
        // 2. Unlinked (Member exists but no code)
        // 3. Typed a random word while not in a specific mode
        
        if (session.step === 'JOIN_SELECT' || session.step === 'SEARCH' || incomingMsg === 'join') {
            // ... (Simple Search Logic) ...
            if (session.step !== 'JOIN_SELECT') {
                 // PERFORM SEARCH
                 const results = await prisma.church.findMany({
                     where: { 
                         name: { contains: incomingMsg, mode: 'insensitive' }
                         // We removed 'status' because it doesn't exist on the Church table
                     },
                     take: 5
                 });

                 if (results.length > 0) {
                     session.searchResults = results;
                     let reply = `🔍 Found ${results.length} matches:\n\n` + 
                             results.map((r, i) => `*${i+1}.* ${r.type === 'BURIAL_SOCIETY' ? '🛡️' : '⛪'} ${r.name}`).join('\n') +
                             `\n\nReply with the number to join.`;
                     session.step = 'JOIN_SELECT';
                     twiml.message(reply);
                 } else {
                     twiml.message("👋 Welcome to Seabe Pay! Please reply with the name of your organization (e.g. 'AFM'):");
                     session.step = 'SEARCH';
                 }
            } 
            else if (session.step === 'JOIN_SELECT') {
                // HANDLE JOIN SELECTION
                const index = parseInt(incomingMsg) - 1;
                const org = session.searchResults ? session.searchResults[index] : null;

                if (org) {
                     const updateData = {};
                     let reply = "";
                     
                     // Smart Field Update based on Org Type
                     if (org.type === 'BURIAL_SOCIETY') {
                         updateData.societyCode = org.code;
                         reply = `✅ Linked to Society: *${org.name}*\n\nReply *Society* to access your policy menu.`;
                     } else {
                         updateData.churchCode = org.code;
                         reply = `✅ Linked to Church: *${org.name}*\n\nReply *Hi* to give Tithes & Offerings.`;
                     }

                     await prisma.member.upsert({
                         where: { phone: cleanPhone },
                         update: updateData,
                         create: { phone: cleanPhone, firstName: 'Member', lastName: 'New', ...updateData }
                     });
                     
                     delete userSession[cleanPhone]; // Clear session to refresh data next time
                     twiml.message(reply);
                } else {
                    twiml.message("⚠️ Invalid selection. Try searching again.");
                    session.step = 'SEARCH';
                }
            }
            res.type('text/xml').send(twiml.toString());
            return;
        }

        // ------------------------------------
        // FALLBACK
        // ------------------------------------
        // If user has a church but typed something random, default to Church Mode
        if (member && member.churchCode) {
             session.mode = 'CHURCH';
             session.orgCode = member.churchCode;
             session.orgName = member.church.name;
             session.subaccount = member.church.subaccountCode;
             session.churchId = member.church.id;
             return handleChurchMessage(incomingMsg, cleanPhone, session, prisma, twiml, res);
        } else {
             twiml.message("👋 Welcome! Reply *Hi* to start.");
             res.type('text/xml').send(twiml.toString());
        }

    } catch (e) {
        console.error("Router Error:", e);
        res.sendStatus(500);
    }
});

// --- SUCCESS PAGE ---
app.get('/payment-success', (req, res) => {
    // We send the HTML as a STRING inside backticks (`)
    res.send(`
        <html>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body { font-family: sans-serif; text-align: center; padding: 50px; }
                    .btn { background: #25D366; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; }
                </style>
            </head>
            <body>
                <h1>✅ Payment Successful</h1>
                <p>Thank you! Your transaction is complete.</p>
                <br>
                <a href="https://wa.me/${process.env.TWILIO_PHONE_NUMBER ? process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '') : ''}?text=Hi" class="btn">Return to WhatsApp</a>
            </body>
        </html>
    `);
});

const PORT = process.env.PORT || 3000;

// Only start the server if we are NOT testing
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => console.log(`✅ Seabe Engine running on ${PORT}`));
}

// Export the app for testing
module.exports = app;