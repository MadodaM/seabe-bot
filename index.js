require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const cron = require('node-cron'); // 👈 NEW: Timekeeper
const { MessagingResponse } = require('twilio').twiml;
const { createPaymentLink } = require('./services/stitch');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// --- CONFIG ---
const ACCOUNT_SID = process.env.TWILIO_SID; 
const AUTH_TOKEN = process.env.TWILIO_AUTH;
const GOOGLE_EMAIL = process.env.GOOGLE_EMAIL;
const GOOGLE_KEY = process.env.GOOGLE_KEY ? process.env.GOOGLE_KEY.replace(/\\n/g, '\n') : null;
const SHEET_ID = process.env.SHEET_ID;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

let client;
try {
    if (ACCOUNT_SID && AUTH_TOKEN) client = require('twilio')(ACCOUNT_SID, AUTH_TOKEN);
} catch (e) { console.log("⚠️ Twilio Error"); }

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

// --- 🧠 MEMORY ---
let userSession = {}; 
let cachedChurches = []; 
let cachedAds = [];      

// --- 🔄 DATABASE ENGINE ---
async function getDoc() {
    const serviceAccountAuth = new JWT({ email: GOOGLE_EMAIL, key: GOOGLE_KEY, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    return doc;
}

async function refreshCache() {
    if (!GOOGLE_EMAIL) return;
    try {
        const doc = await getDoc();
        
        // Load Churches (Tab 3)
        const churchSheet = doc.sheetsByIndex[2]; 
        const churchRows = await churchSheet.getRows();
        cachedChurches = churchRows.map(row => ({
            code: row.get('Code'),
            name: row.get('Name'),
            eventName: row.get('Event_Name'),
            eventPrice: row.get('Event_Price'),
            email: row.get('Treasurer_Email')
        }));

        // Load Ads (Tab 2)
        const adSheet = doc.sheetsByIndex[1];
        const adRows = await adSheet.getRows();
        cachedAds = adRows
            .filter(row => row.get('Status') === 'Active')
            .map(row => ({
                target: row.get('Target'),
                ENGLISH: row.get('English'),
                ZULU: row.get('Zulu'),
                SOTHO: row.get('Sotho')
            }));
            
        console.log(`♻️ Cache Updated: ${cachedChurches.length} Churches, ${cachedAds.length} Ads.`);
    } catch (e) { console.error("❌ Cache Error:", e.message); }
}
// Refresh cache every 10 mins
setInterval(refreshCache, 600000); 
refreshCache(); 

async function getUserChurch(phone) {
    const doc = await getDoc();
    const userSheet = doc.sheetsByIndex[3]; 
    const rows = await userSheet.getRows();
    const userRow = rows.find(r => r.get('Phone') === phone);
    return userRow ? userRow.get('Church_Code') : null;
}

async function registerUser(phone, churchCode) {
    const doc = await getDoc();
    const userSheet = doc.sheetsByIndex[3];
    await userSheet.addRow({ Phone: phone, Church_Code: churchCode });
}

// --- 📧 REPORTING ENGINE ---
async function emailReport(churchCode) {
    const church = cachedChurches.find(c => c.code === churchCode);
    if (!church || !church.email) return `❌ Skipped ${churchCode} (No Email)`;

    const doc = await getDoc();
    const transSheet = doc.sheetsByIndex[0];
    const rows = await transSheet.getRows();
    
    // Filter rows for this church
    const churchRows = rows.filter(r => r.get('Church Code') === churchCode);
    
    if (churchRows.length === 0) return `⚠️ ${churchCode}: No transactions to report.`;

    let csvContent = "Date,Type,Amount,Reference,Phone\n"; 
    churchRows.forEach(row => {
        csvContent += `${row.get('Date')},${row.get('Type')},${row.get('Amount')},${row.get('Reference')},${row.get('Name/Phone')}\n`;
    });

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: EMAIL_USER, pass: EMAIL_PASS }
    });

    try {
        await transporter.sendMail({
            from: `"Seabe Bot" <${EMAIL_USER}>`,
            to: church.email,
            subject: `📊 Weekly Financial Report: ${church.name}`,
            text: `Dear Treasurer,\n\nAttached is your automated weekly transaction report for ${church.name}.\n\nRegards,\nSeabe Digital Team`,
            attachments: [
                { filename: `${churchCode}_Weekly_Report.csv`, content: csvContent }
            ]
        });
        return `✅ Sent to ${church.email}`;
    } catch (error) {
        console.error(error);
        return `❌ Failed for ${churchCode}`;
    }
}

// --- 🕰️ SCHEDULED TASKS (NEW) ---
// Syntax: '0 8 * * 1' = At 08:00 on Monday
cron.schedule('0 8 * * 1', async () => {
    console.log("⏰ Running Weekly Reports...");
    
    // Loop through ALL churches and send reports
    for (const church of cachedChurches) {
        if (church.code && church.email) {
            console.log(`📤 Sending report for ${church.name}...`);
            const result = await emailReport(church.code);
            console.log(result);
        }
    }
}, {
    timezone: "Africa/Johannesburg"
});


// --- 📄 PDF & LOGGING ---
function generatePDF(type, amount, ref, date, phone, churchName) {
    const doc = new PDFDocument({ size: 'A5', margin: 50 });
    const filename = `receipt_${Date.now()}_${phone.slice(-4)}.pdf`;
    const filePath = path.join(__dirname, 'public', 'receipts', filename);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)){ fs.mkdirSync(dir, { recursive: true }); }
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    
    doc.fontSize(20).text(type === 'TICKET' ? 'ADMIT ONE' : 'RECEIPT', 50, 100, { align: 'right' });
    doc.fontSize(10).text(churchName, { align: 'right' });
    doc.moveDown();
    doc.text('Powered by Seabe', { align: 'right', color: 'grey' });
    doc.moveTo(50, 160).lineTo(370, 160).stroke();
    doc.moveDown(2);
    doc.text(`Date: ${date}`, 50);
    doc.text(`Reference: ${ref}`);
    doc.text(`Member: ${phone}`);
    doc.moveDown(2);
    doc.fontSize(16).text(`AMOUNT:  R ${amount}.00`, 50);
    doc.end();
    return filename;
}

async function logToSheet(phone, churchCode, type, amount, ref) {
    const doc = await getDoc();
    const sheet = doc.sheetsByIndex[0]; 
    await sheet.addRow({ "Church Code": churchCode, Date: new Date().toLocaleString(), "Name/Phone": phone, Type: type, Amount: amount, Reference: ref });
}

function getAdSuffix(lang, churchCode) {
    const relevantAds = cachedAds.filter(ad => ad.target === 'Global' || ad.target === churchCode);
    if (relevantAds.length === 0) return "";
    const randomAd = relevantAds[Math.floor(Math.random() * relevantAds.length)];
    const adText = randomAd[lang] || randomAd['ENGLISH'];
    return `\n\n----------------\n📢 *News/Ads:*\n${adText}`;
}

// --- 🤖 WHATSAPP LOGIC ---
app.post('/whatsapp', async (req, res) => {
    const incomingMsg = req.body.Body.trim().toLowerCase(); 
    const sender = req.body.From; 
    const cleanPhone = sender.replace('whatsapp:', '');
    const twiml = new MessagingResponse();
    let reply = "";

    // Manual Report Trigger (For Admin Testing)
    if (incomingMsg.startsWith('report ')) {
        const targetCode = incomingMsg.split(' ')[1].toUpperCase();
        reply = await emailReport(targetCode);
        twiml.message(reply);
        res.type('text/xml').send(twiml.toString());
        return;
    }

    let churchCode = userSession[cleanPhone]?.churchCode;
    if (!churchCode) {
        churchCode = await getUserChurch(cleanPhone);
        if (churchCode) userSession[cleanPhone] = { ...userSession[cleanPhone], churchCode };
    }

    if (!churchCode) {
        if (!userSession[cleanPhone]?.onboarding) {
            let list = "Welcome to Seabe! 🇿🇦\nPlease select your church:\n";
            cachedChurches.forEach((c, index) => { list += `*${index + 1}.* ${c.name}\n`; });
            reply = list;
            userSession[cleanPhone] = { onboarding: true };
        } else {
            const selection = parseInt(incomingMsg) - 1;
            if (cachedChurches[selection]) {
                const selectedChurch = cachedChurches[selection];
                await registerUser(cleanPhone, selectedChurch.code);
                userSession[cleanPhone] = { churchCode: selectedChurch.code };
                delete userSession[cleanPhone].onboarding;
                reply = `Welcome to *${selectedChurch.name}*! 🎉\nReply *Hi* to see your menu.`;
            } else { reply = "⚠️ Invalid selection."; }
        }
    } 
    else {
        const church = cachedChurches.find(c => c.code === churchCode);
        const churchName = church ? church.name : "Church";
        
        if (['hi', 'menu', 'hello'].includes(incomingMsg)) {
            userSession[cleanPhone].step = 'MENU';
            reply = `Welcome to *${churchName}* 👋\n\n*1.* General Offering 🎁\n*2.* Pay Tithe 🏛️\n*3.* ${church.eventName || 'Event'} (R${church.eventPrice || '0'}) 🎟️\n*4.* Switch Church 🔄` + getAdSuffix('ENGLISH', churchCode);
        }
        else if (['1', '2', '3'].includes(incomingMsg) && userSession[cleanPhone]?.step === 'MENU') {
            userSession[cleanPhone].step = 'PAY';
            userSession[cleanPhone].choice = incomingMsg;
            if (incomingMsg === '3') reply = `Confirm Ticket for ${church.eventName} (R${church.eventPrice})?\nReply *Yes*`;
            else reply = "Enter Amount (e.g. R100):";
        }
        else if (userSession[cleanPhone]?.step === 'PAY') {
            let amount = incomingMsg.replace(/\D/g,'');
            let type = userSession[cleanPhone].choice === '1' ? 'OFFERING' : 'TITHE';
            
            if (userSession[cleanPhone].choice === '3') {
                if (incomingMsg.includes('yes')) { amount = church.eventPrice; type = 'TICKET'; } 
                else { reply = "Cancelled."; twiml.message(reply); res.type('text/xml').send(twiml.toString()); return; }
            }

            const ref = `${churchCode}-${type}-${cleanPhone.slice(-4)}`;
            const link = await createPaymentLink(amount + ".00", ref);
            reply = `Tap to pay R${amount}:\n👉 ${link}`;
            
            if (client) {
                setTimeout(async () => {
                    const pdfName = generatePDF(type, amount, ref, new Date().toLocaleString(), cleanPhone, churchName);
                    const hostUrl = req.headers.host || 'seabe-bot.onrender.com';
                    const pdfUrl = `https://${hostUrl}/public/receipts/${pdfName}`;
                    try { await client.messages.create({ from: 'whatsapp:+14155238886', to: sender, body: `🎉 Payment Received! ${getAdSuffix('ENGLISH', churchCode)}`, mediaUrl: [pdfUrl] }); } catch(e) {}
                    await logToSheet(cleanPhone, churchCode, type, amount, ref);
                }, 15000);
            }
            userSession[cleanPhone].step = 'MENU';
        } else if (incomingMsg === '4') {
             reply = "Please contact support to switch churches.";
        } else {
             reply = "Reply *Hi* to see the menu.";
        }
    }

    twiml.message(reply);
    res.type('text/xml').send(twiml.toString());
});

app.post('/stitch-webhook', (req, res) => res.sendStatus(200));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Seabe Platform running on ${PORT}`));