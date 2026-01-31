// ==========================================
// VERSION 2.0 - SEABE PLATFORM (DATABASE EDITION)
// DATE: 31 JAN 2026
// INFRASTRUCTURE: Node.js + PostgreSQL (Neon)
// ==========================================

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const sgMail = require('@sendgrid/mail'); 
const cron = require('node-cron');
const axios = require('axios'); 
const multer = require('multer'); 
const { MessagingResponse } = require('twilio').twiml;
const { PrismaClient } = require('@prisma/client'); // 🔌 The New Engine

// --- CONFIG ---
const prisma = new PrismaClient(); // Initialize DB
const ACCOUNT_SID = process.env.TWILIO_SID; 
const AUTH_TOKEN = process.env.TWILIO_AUTH;
const SENDGRID_KEY = process.env.SENDGRID_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM;
const { createPaymentLink, createSubscriptionLink } = require('./services/paystack');

if (SENDGRID_KEY) sgMail.setApiKey(SENDGRID_KEY);

let client;
try {
    if (ACCOUNT_SID && AUTH_TOKEN) client = require('twilio')(ACCOUNT_SID, AUTH_TOKEN);
} catch (e) { console.log("⚠️ Twilio Error"); }

const app = express();
const upload = multer({ dest: 'uploads/' }); 
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

// --- 🧠 SESSION MEMORY (FAST RAM) ---
// We keep user session in RAM for speed, but data lives in DB.
let userSession = {}; 

// --- 🛠️ HUBSPOT CRM SYNC ---
async function syncToHubSpot(data) {
    if (!process.env.HUBSPOT_TOKEN) return;
    try {
        await axios.post('https://api.hubapi.com/crm/v3/objects/contacts', {
            properties: { firstname: data.name, email: data.email, phone: data.phone, lifecyclestage: 'lead' }
        }, { headers: { 'Authorization': `Bearer ${process.env.HUBSPOT_TOKEN}` } });
    } catch (e) { console.error("HubSpot Error:", e.message); }
}

// --- 🌐 WEB ROUTES (Pass Prisma to the website) ---
require('./routes/web')(app, upload, { prisma, syncToHubSpot });


// --- 📧 REPORTING (POWERED BY DB) ---
async function emailReport(churchCode) {
    const church = await prisma.church.findUnique({ where: { code: churchCode } });
    if (!church || !church.email) return `❌ Church not found: ${churchCode}`;

    // Query Transactions from DB
    const transactions = await prisma.transaction.findMany({
        where: { churchCode: churchCode },
        orderBy: { date: 'desc' },
        take: 1000 // Limit to last 1000 for email size safety
    });
    
    if (transactions.length === 0) return `⚠️ ${churchCode}: No transactions found.`;

    let csvContent = "Date,Type,Amount,Reference,Phone\n"; 
    transactions.forEach(t => {
        csvContent += `${t.date.toISOString()},${t.type},${t.amount},${t.reference},${t.phone}\n`;
    });

    const attachment = Buffer.from(csvContent).toString('base64');
    const msg = {
        to: church.email,
        from: EMAIL_FROM, 
        subject: `📊 Weekly Report: ${church.name}`,
        text: `Attached is your automated financial report from Seabe Digital.`,
        attachments: [{ content: attachment, filename: `${churchCode}_Report.csv`, type: 'text/csv', disposition: 'attachment' }]
    };

    try { await sgMail.send(msg); return `✅ Sent to ${church.email}`; } 
    catch (error) { return `❌ Failed for ${churchCode}`; }
}

// Cron Job: Runs every Monday at 8 AM
cron.schedule('0 8 * * 1', async () => {
    const churches = await prisma.church.findMany();
    for (const church of churches) {
        if (church.email) await emailReport(church.code);
    }
}, { timezone: "Africa/Johannesburg" });

// --- 📄 PDF FACTORY ---
function generatePDF(type, amount, ref, date, phone, churchName, eventDetail = '') {
    const doc = new PDFDocument({ size: 'A5', margin: 50 });
    const filename = `receipt_${Date.now()}_${phone.slice(-4)}.pdf`;
    const filePath = path.join(__dirname, 'public', 'receipts', filename);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)){ fs.mkdirSync(dir, { recursive: true }); }
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    
    doc.fontSize(20).text(type === 'TICKET' ? 'ADMIT ONE' : 'RECEIPT', 50, 100, { align: 'right' });
    doc.fontSize(10).text(churchName, { align: 'right' });
    doc.moveDown(); doc.moveTo(50, 160).lineTo(370, 160).stroke(); doc.moveDown(2);
    doc.text(`Ref: ${ref}`); doc.text(`Member: ${phone}`); 
    if(eventDetail) doc.text(`Event: ${eventDetail}`); 
    doc.moveDown(2);
    doc.fontSize(16).text(`AMOUNT:  R ${amount}.00`, 50);
    doc.end();
    return filename;
}

// --- 💾 DATABASE LOGGER ---
async function logToDB(phone, churchCode, type, amount, ref) {
    try {
        await prisma.transaction.create({
            data: {
                churchCode: churchCode,
                phone: phone,
                type: type,
                amount: parseFloat(amount),
                reference: ref,
                date: new Date()
            }
        });
        console.log(`✅ Logged transaction: ${ref}`);
    } catch (e) {
        console.error("❌ DB Log Error:", e);
    }
}

// --- 🩺 DIAGNOSTIC ---
app.get('/test-connection', async (req, res) => {
    try {
        const count = await prisma.church.count();
        res.send(`<h1>✅ System Online</h1><p>Connected to PostgreSQL.</p><p>Active Churches: <strong>${count}</strong></p>`);
    } catch (e) {
        res.send(`<h1>❌ System Error</h1><p>${e.message}</p>`);
    }
});

// --- 🤖 WHATSAPP LOGIC ---
app.post('/whatsapp', async (req, res) => {
    const twiml = new MessagingResponse();
    
    try {
        const incomingMsg = req.body.Body.trim().toLowerCase(); 
        const sender = req.body.From; 
        const cleanPhone = sender.replace('whatsapp:', '');
        let reply = "";

        // Report Trigger
        if (incomingMsg.startsWith('report ')) {
            const targetCode = incomingMsg.split(' ')[1].toUpperCase();
            reply = await emailReport(targetCode);
            twiml.message(reply);
            res.type('text/xml').send(twiml.toString());
            return;
        }

        if (!userSession[cleanPhone]) userSession[cleanPhone] = {};
        
        // Check if user is already linked to a church in session
        // (In V3, we could check prisma.member table here)
        
        if (!userSession[cleanPhone].churchCode) {
            if (['hi', 'hello', 'menu', 'start'].includes(incomingMsg) || !userSession[cleanPhone]?.onboarding) {
                // Fetch Churches directly from DB
                const churches = await prisma.church.findMany({ orderBy: { id: 'asc' } });
                
                if (churches.length === 0) {
                    reply = "⚠️ System Startup... No churches found.";
                } else {
                    let list = "Welcome to Seabe! 🇿🇦\nPlease select your church:\n";
                    churches.forEach((c, index) => { list += `*${index + 1}.* ${c.name}\n`; });
                    reply = list;
                    userSession[cleanPhone].onboarding = true;
                    userSession[cleanPhone].churchList = churches; // Temp store list for selection
                }
            } 
            else {
                const selection = parseInt(incomingMsg) - 1;
                const churches = userSession[cleanPhone].churchList;
                
                if (churches && !isNaN(selection) && churches[selection]) {
                    const selectedChurch = churches[selection];
                    // Link user to church in Session
                    userSession[cleanPhone].churchCode = selectedChurch.code;
                    userSession[cleanPhone].churchName = selectedChurch.name;
                    userSession[cleanPhone].subaccount = selectedChurch.subaccountCode;
                    
                    delete userSession[cleanPhone].onboarding;
                    reply = `Welcome to *${selectedChurch.name}*! 🎉\nReply *Hi* to see your menu.`;
                } else { 
                    reply = "⚠️ Invalid selection. Reply *Hi* to see the list."; 
                }
            }
        } else {
            // User is logged into a church
            const churchCode = userSession[cleanPhone].churchCode;
            const churchName = userSession[cleanPhone].churchName;
            
            if (['hi', 'menu', 'hello'].includes(incomingMsg)) {
                userSession[cleanPhone].step = 'MENU';
                reply = `Welcome to *${churchName}* 👋\n\n*1.* General Offering 🎁\n*2.* Pay Tithe 🏛️\n*3.* Events & Tickets 🎟️\n*4.* Switch Church 🔄\n*5.* Monthly Partner (Auto) 🔁`;
            }
            else if (incomingMsg === '3' && userSession[cleanPhone]?.step === 'MENU') {
                // Fetch Events from DB
                const events = await prisma.event.findMany({ 
                    where: { churchCode: churchCode, status: 'Active' } 
                });
                
                if (events.length === 0) {
                    reply = "⚠️ No upcoming events found.";
                    userSession[cleanPhone].step = 'MENU';
                } else {
                    let list = "*Select an Event:*\n";
                    events.forEach((e, index) => { list += `*${index + 1}.* ${e.name} (R${e.price})\n`; });
                    reply = list;
                    userSession[cleanPhone].step = 'EVENT_SELECT';
                    userSession[cleanPhone].availableEvents = events; 
                }
            }
            else if (userSession[cleanPhone]?.step === 'EVENT_SELECT') {
                const index = parseInt(incomingMsg) - 1;
                const events = userSession[cleanPhone].availableEvents;
                if (events && events[index]) {
                    const selectedEvent = events[index];
                    userSession[cleanPhone].step = 'PAY';
                    userSession[cleanPhone].choice = 'EVENT';
                    userSession[cleanPhone].selectedEvent = selectedEvent; 
                    reply = `Confirm Ticket for *${selectedEvent.name}* (R${selectedEvent.price})?\nReply *Yes*`;
                } else { reply = "⚠️ Invalid selection. Reply *Hi* to restart."; }
            }
            else if (['1', '2', '5'].includes(incomingMsg) && userSession[cleanPhone]?.step === 'MENU') {
                userSession[cleanPhone].step = 'PAY';
                userSession[cleanPhone].choice = incomingMsg;
                if (incomingMsg === '5') reply = "Enter Monthly Amount (e.g. R500):";
                else reply = "Enter Amount (e.g. R100):";
            }
            else if (incomingMsg === '4' && userSession[cleanPhone]?.step === 'MENU') {
                delete userSession[cleanPhone];
                reply = "🔄 Church Unlinked. Reply *Hi* to select a new church.";
            }
            else if (userSession[cleanPhone]?.step === 'PAY') {
                let amount = incomingMsg.replace(/\D/g,''); 
                let type = '';
                let eventNameForPdf = '';

                if (userSession[cleanPhone].choice === '1') type = 'OFFERING';
                else if (userSession[cleanPhone].choice === '5') type = 'RECURRING';
                else if (userSession[cleanPhone].choice === 'EVENT') {
                    type = 'TICKET';
                    const evt = userSession[cleanPhone].selectedEvent;
                    amount = evt.price.toString().replace(/\D/g,'');
                    eventNameForPdf = evt.name;
                    const isAffirmative = ['yes', 'y', 'yeah', 'yebo', 'ok', 'sure', 'confirm'].some(w => incomingMsg.includes(w));
                    if (!isAffirmative && incomingMsg !== amount) {
                        reply = "❌ Cancelled."; twiml.message(reply); res.type('text/xml').send(twiml.toString()); return;
                    }
                } else type = 'TITHE'; 

                const ref = `${churchCode}-${type}-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-5)}`;
                const systemEmail = `${cleanPhone}@seabe.io`;
                const finalSubaccount = userSession[cleanPhone].subaccount;
                
                let link;
                if (type === 'RECURRING') link = await createSubscriptionLink(amount, ref, systemEmail, finalSubaccount);
                else link = await createPaymentLink(amount, ref, systemEmail, finalSubaccount);
                
                if (link) {
                    reply = `Tap to pay R${amount}:\n👉 ${link}`;
                    if (client) {
                        setTimeout(async () => {
                            // Generate Receipt
                            const pdfName = generatePDF(type, amount, ref, new Date().toLocaleString(), cleanPhone, churchName, eventNameForPdf);
                            const hostUrl = req.headers.host || 'seabe-bot.onrender.com';
                            const pdfUrl = `https://${hostUrl}/public/receipts/${pdfName}`;
                            
                            // Send Receipt via WhatsApp
                            try { await client.messages.create({ from: 'whatsapp:+14155238886', to: sender, body: `🎉 Payment Received!`, mediaUrl: [pdfUrl] }); } catch(e) {}
                            
                            // Log to Database (Not Sheets!)
                            await logToDB(cleanPhone, churchCode, type, amount, ref);
                            
                        }, 15000);
                    }
                } else { reply = "⚠️ Error creating link."; }
                userSession[cleanPhone].step = 'MENU';
            } else { reply = "Reply *Hi* to see the menu."; }
        }
        
        twiml.message(reply);
        res.type('text/xml').send(twiml.toString());

    } catch (error) {
        console.error("❌ FATAL BOT CRASH:", error);
        twiml.message("⚠️ System Error: Please try again in 1 minute.");
        res.type('text/xml').send(twiml.toString());
    }
});

app.post('/payment-success', (req, res) => res.send("<h1>Payment Successful! 🎉</h1><p>You can return to WhatsApp.</p>"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Seabe Database Engine running on ${PORT}`));