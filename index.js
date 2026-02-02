// ==========================================
// SEABE PLATFORM - VERSION 3.0 (Dynamic Engine)
// CONNECTED TO: Admin Console & PostgreSQL
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
const { PrismaClient } = require('@prisma/client');
const { createPaymentLink, createSubscriptionLink } = require('./services/paystack');

// --- CONFIG ---
const prisma = new PrismaClient();
const ACCOUNT_SID = process.env.TWILIO_SID; 
const AUTH_TOKEN = process.env.TWILIO_AUTH;
const SENDGRID_KEY = process.env.SENDGRID_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM;

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

// --- 🧠 MEMORY ---
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

// --- 🌐 ROUTES (Web & Admin) ---
require('./routes/web')(app, upload, { prisma, syncToHubSpot });
require('./routes/admin')(app, { prisma });

// --- 📧 REPORTING ---
async function emailReport(churchCode) {
    const church = await prisma.church.findUnique({ where: { code: churchCode } });
    if (!church || !church.email) return `❌ Church not found: ${churchCode}`;

    const transactions = await prisma.transaction.findMany({
        where: { churchCode: churchCode }, orderBy: { date: 'desc' }, take: 500
    });
    
    if (transactions.length === 0) return `⚠️ ${churchCode}: No transactions.`;

    let csvContent = "Date,Type,Amount,Reference,Phone\n"; 
    transactions.forEach(t => { csvContent += `${t.date.toISOString()},${t.type},${t.amount},${t.reference},${t.phone}\n`; });

    const msg = {
        to: church.email, from: EMAIL_FROM, subject: `📊 Weekly Report: ${church.name}`,
        text: "Attached is your automated financial report.",
        attachments: [{ content: Buffer.from(csvContent).toString('base64'), filename: `${churchCode}_Report.csv`, type: 'text/csv', disposition: 'attachment' }]
    };

    try { await sgMail.send(msg); return `✅ Sent to ${church.email}`; } 
    catch (error) { return `❌ Failed for ${churchCode}`; }
}

cron.schedule('0 8 * * 1', async () => {
    const churches = await prisma.church.findMany();
    for (const church of churches) { if (church.email) await emailReport(church.code); }
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

// --- 📢 DYNAMIC ADS (The Brain) ---
async function getAdSuffix(churchCode) {
    try {
        // Find 1 random Active ad that hasn't expired
        // Matches either 'Global' or this specific ChurchCode
        const ad = await prisma.ad.findFirst({
            where: {
                status: 'Active',
                expiryDate: { gte: new Date() },
                OR: [{ target: 'Global' }, { target: churchCode }]
            },
            take: 1,
            skip: Math.floor(Math.random() * await prisma.ad.count({ where: { status: 'Active', expiryDate: { gte: new Date() } } }))
        });

        if (ad) return `\n\n----------------\n💡 *Did you know?*\n${ad.text}`;
        return ""; // No ads found
    } catch (e) { return ""; }
}

// --- 🤖 WHATSAPP LOGIC ---
app.post('/whatsapp', async (req, res) => {
    const twiml = new MessagingResponse();
    
    try {
        const incomingMsg = req.body.Body.trim().toLowerCase(); 
        const sender = req.body.From; 
        const cleanPhone = sender.replace('whatsapp:', '');
        let reply = "";

        if (incomingMsg.startsWith('report ')) {
            const targetCode = incomingMsg.split(' ')[1].toUpperCase();
            reply = await emailReport(targetCode);
            twiml.message(reply); res.type('text/xml').send(twiml.toString()); return;
        }

        if (!userSession[cleanPhone]) userSession[cleanPhone] = {};
        
        // 1. IDENTIFY USER
        if (!userSession[cleanPhone].churchCode) {
            const member = await prisma.member.findUnique({ where: { phone: cleanPhone } });
            if (member) {
                const church = await prisma.church.findUnique({ where: { code: member.churchCode } });
                if (church) {
                    userSession[cleanPhone].churchCode = church.code;
                    userSession[cleanPhone].churchName = church.name;
                    userSession[cleanPhone].subaccount = church.subaccountCode;
                }
            }
        }

        // 2. ONBOARDING
        if (!userSession[cleanPhone].churchCode) {
            if (['hi', 'hello', 'menu', 'start'].includes(incomingMsg) || !userSession[cleanPhone]?.onboarding) {
                const churches = await prisma.church.findMany({ orderBy: { name: 'asc' } });
                if (churches.length === 0) {
                    reply = "⚠️ System Startup... No churches found.";
                } else {
                    let list = "Welcome to Seabe! 🇿🇦\nPlease select your church:\n";
                    churches.forEach((c, index) => { list += `*${index + 1}.* ${c.name}\n`; });
                    reply = list;
                    userSession[cleanPhone].onboarding = true;
                    userSession[cleanPhone].churchList = churches; 
                }
            } 
            else {
                const selection = parseInt(incomingMsg) - 1;
                const churches = userSession[cleanPhone].churchList;
                if (churches && !isNaN(selection) && churches[selection]) {
                    const selectedChurch = churches[selection];
                    await prisma.member.upsert({
                        where: { phone: cleanPhone },
                        update: { churchCode: selectedChurch.code },
                        create: { phone: cleanPhone, churchCode: selectedChurch.code }
                    });
                    userSession[cleanPhone].churchCode = selectedChurch.code;
                    userSession[cleanPhone].churchName = selectedChurch.name;
                    userSession[cleanPhone].subaccount = selectedChurch.subaccountCode;
                    delete userSession[cleanPhone].onboarding;
                    reply = `Welcome to *${selectedChurch.name}*! 🎉\nReply *Hi* to see your menu.`;
                } else { reply = "⚠️ Invalid selection."; }
            }
        } 
        
        // 3. MAIN MENU (Logged In)
        else {
            const churchCode = userSession[cleanPhone].churchCode;
            const churchName = userSession[cleanPhone].churchName;
            
            if (['hi', 'menu', 'hello'].includes(incomingMsg)) {
                userSession[cleanPhone].step = 'MENU';
                const adText = await getAdSuffix(churchCode); // Fetch Dynamic Ad
                reply = `Welcome to *${churchName}* 👋\n\n*1.* General Offering 🎁\n*2.* Pay Tithe 🏛️\n*3.* Events & Tickets 🎟️\n*4.* Switch Church 🔄\n*5.* Monthly Partner 🔁\n*6.* Ministry News 📰` + adText;
            }
            
            // --- NEW: NEWS FEATURE ---
            else if (incomingMsg === '6' && userSession[cleanPhone]?.step === 'MENU') {
                const news = await prisma.news.findMany({
                    where: { status: 'Active', expiryDate: { gte: new Date() } },
                    orderBy: { createdAt: 'desc' },
                    take: 3
                });

                if (news.length === 0) {
                    reply = "📰 No news updates at the moment.";
                } else {
                    reply = "*Latest Ministry News:*\n\n";
                    news.forEach(n => {
                        reply += `📌 *${n.headline}*\n${n.body || ''}\n\n`;
                    });
                }
                userSession[cleanPhone].step = 'MENU';
            }

            // Events Flow
            else if (incomingMsg === '3' && userSession[cleanPhone]?.step === 'MENU') {
                const events = await prisma.event.findMany({ 
                    where: { churchCode: churchCode, status: 'Active', expiryDate: { gte: new Date() } } 
                });
                
                if (events.length === 0) {
                    reply = "⚠️ No upcoming events found.";
                    userSession[cleanPhone].step = 'MENU';
                } else {
                    let list = "*Select an Event:*\n";
                    events.forEach((e, index) => { list += `*${index + 1}.* ${e.name} (R${e.price})\n_${e.date}_\n`; });
                    reply = list;
                    userSession[cleanPhone].step = 'EVENT_SELECT';
                    userSession[cleanPhone].availableEvents = events; 
                }
            }
            else if (userSession[cleanPhone]?.step === 'EVENT_SELECT') {
                const index = parseInt(incomingMsg) - 1;
                const events = userSession[cleanPhone].availableEvents;
                if (events && events[index]) {
                    userSession[cleanPhone].step = 'PAY';
                    userSession[cleanPhone].choice = 'EVENT';
                    userSession[cleanPhone].selectedEvent = events[index]; 
                    reply = `Confirm Ticket for *${events[index].name}* (R${events[index].price})?\nReply *Yes*`;
                } else { reply = "⚠️ Invalid."; }
            }
            
            // Language / Other Options
            else if (['1', '2', '5'].includes(incomingMsg) && userSession[cleanPhone]?.step === 'MENU') {
                userSession[cleanPhone].step = 'PAY';
                userSession[cleanPhone].choice = incomingMsg;
                if (incomingMsg === '5') reply = "Enter Monthly Amount (e.g. R500):";
                else reply = "Enter Amount (e.g. R100):";
            }
            else if (incomingMsg === '4' && userSession[cleanPhone]?.step === 'MENU') {
                delete userSession[cleanPhone];
                reply = "🔄 Unlinked. Reply *Hi* to select a new church.";
            }
            
            // Payment Flow
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
                    if (!['yes', 'y', 'ok'].some(w => incomingMsg.includes(w))) {
                        reply = "❌ Cancelled."; twiml.message(reply); res.type('text/xml').send(twiml.toString()); return;
                    }
                } else type = 'TITHE'; 

                const ref = `${churchCode}-${type}-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-5)}`;
                const systemEmail = `${cleanPhone}@seabe.io`;
                const finalSubaccount = userSession[cleanPhone].subaccount;
                
                const link = (type === 'RECURRING') 
                    ? await createSubscriptionLink(amount, ref, systemEmail, finalSubaccount)
                    : await createPaymentLink(amount, ref, systemEmail, finalSubaccount);
                
                if (link) {
                    reply = `Tap to pay R${amount}:\n👉 ${link}`;
                    if (client) {
                        setTimeout(async () => {
                            const pdfName = generatePDF(type, amount, ref, new Date().toLocaleString(), cleanPhone, churchName, eventNameForPdf);
                            const hostUrl = req.headers.host || 'seabe-bot.onrender.com';
                            try { await client.messages.create({ from: 'whatsapp:+14155238886', to: sender, body: `🎉 Payment Received!`, mediaUrl: [`https://${hostUrl}/public/receipts/${pdfName}`] }); } catch(e) {}
                            
                            // LOG TO DB
                            try {
                                await prisma.transaction.create({
                                    data: { churchCode, phone: cleanPhone, type, amount: parseFloat(amount), reference: ref, date: new Date() }
                                });
                            } catch(e) { console.error("DB Log Fail", e); }

                        }, 15000);
                    }
                } else { reply = "⚠️ Link Error."; }
                userSession[cleanPhone].step = 'MENU';
            } else { reply = "Reply *Hi* for menu."; }
        }
        
        twiml.message(reply);
        res.type('text/xml').send(twiml.toString());

    } catch (error) {
        console.error("FATAL:", error);
        twiml.message("⚠️ System Error.");
        res.type('text/xml').send(twiml.toString());
    }
});

app.post('/payment-success', (req, res) => res.send("<h1>Payment Successful! 🎉</h1>"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Seabe Engine v3.0 running on ${PORT}`));