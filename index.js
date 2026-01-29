require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const sgMail = require('@sendgrid/mail'); 
const cron = require('node-cron');
const { MessagingResponse } = require('twilio').twiml;
const { createPaymentLink } = require('./services/paystack');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// --- CONFIG ---
const ACCOUNT_SID = process.env.TWILIO_SID; 
const AUTH_TOKEN = process.env.TWILIO_AUTH;
const GOOGLE_EMAIL = process.env.GOOGLE_EMAIL;
const GOOGLE_KEY = process.env.GOOGLE_KEY ? process.env.GOOGLE_KEY.replace(/\\n/g, '\n') : null;
const SHEET_ID = process.env.SHEET_ID;
const SENDGRID_KEY = process.env.SENDGRID_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM;

if (SENDGRID_KEY) sgMail.setApiKey(SENDGRID_KEY);

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
        
        cachedChurches = churchRows.map(row => {
            const code = row.get('Church Code') || row.get('Code'); 
            const eventName = row.get('Event_Name') || row.get('Event Name') || 'Special Event';
            const eventPrice = row.get('Event_Price') || row.get('Event Price') || '0';
            // 👇 NEW: Capture Subaccount Code
            const subaccount = row.get('Subaccount_Code') || row.get('Subaccount Code') || null;

            // Smart Email Detection
            let email = "";
            const rawData = row.toObject(); 
            for (const key in rawData) {
                if (typeof rawData[key] === 'string' && rawData[key].includes('@')) {
                    email = rawData[key]; 
                    break;
                }
            }
            return { code, name: row.get('Name'), eventName, eventPrice, email, subaccount };
        });

        // Load Ads (Tab 2)
        const adSheet = doc.sheetsByIndex[1];
        const adRows = await adSheet.getRows();
        cachedAds = adRows.filter(r => r.get('Status') === 'Active').map(r => ({
             target: r.get('Target'), ENGLISH: r.get('English'), ZULU: r.get('Zulu'), SOTHO: r.get('Sotho')
        }));
        
        console.log(`♻️ System Ready: ${cachedChurches.length} Churches Active.`);
    } catch (e) { console.error("❌ Cache Error:", e.message); }
}
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

async function removeUser(phone) {
    try {
        const doc = await getDoc();
        const userSheet = doc.sheetsByIndex[3]; 
        const rows = await userSheet.getRows();
        const rowToDelete = rows.find(r => r.get('Phone') === phone);
        if (rowToDelete) { await rowToDelete.delete(); }
    } catch (e) { console.error("Remove Error:", e); }
}

// --- 📧 REPORTING ENGINE ---
async function emailReport(churchCode) {
    const church = cachedChurches.find(c => c.code === churchCode);
    if (!church || !church.email) return `❌ Skipped ${churchCode}`;

    const doc = await getDoc();
    const transSheet = doc.sheetsByIndex[0];
    const rows = await transSheet.getRows();
    const churchRows = rows.filter(r => r.get('Church Code') === churchCode);
    
    if (churchRows.length === 0) return `⚠️ ${churchCode}: No transactions.`;

    let csvContent = "Date,Type,Amount,Reference,Phone\n"; 
    churchRows.forEach(row => {
        csvContent += `${row.get('Date')},${row.get('Type')},${row.get('Amount')},${row.get('Reference')},${row.get('Name/Phone')}\n`;
    });

    const attachment = Buffer.from(csvContent).toString('base64');
    const msg = {
        to: church.email,
        from: EMAIL_FROM, 
        subject: `📊 Weekly Report: ${church.name}`,
        text: `Attached is your automated financial report from Seabe Digital.`,
        attachments: [{ content: attachment, filename: `${churchCode}_Report.csv`, type: 'text/csv', disposition: 'attachment' }]
    };

    try {
        await sgMail.send(msg);
        return `✅ Sent to ${church.email}`;
    } catch (error) { 
        console.error("❌ SendGrid Error:", error.message);
        return `❌ Failed for ${churchCode}`; 
    }
}

// --- 🕰️ SCHEDULED TASKS ---
cron.schedule('0 8 * * 1', async () => {
    console.log("⏰ Running Monday Reports...");
    for (const church of cachedChurches) {
        if (church.code && church.email) await emailReport(church.code);
    }
}, { timezone: "Africa/Johannesburg" });

// --- 📄 PDF FACTORY ---
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
    doc.moveDown(); doc.moveTo(50, 160).lineTo(370, 160).stroke(); doc.moveDown(2);
    doc.text(`Ref: ${ref}`); doc.text(`Member: ${phone}`); doc.moveDown(2);
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

    // Admin Command
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
        else if (incomingMsg === '4' && userSession[cleanPhone]?.step === 'MENU') {
            await removeUser(cleanPhone);
            delete userSession[cleanPhone];
            let list = "🔄 *Switch Church*\n\nPlease select your church:\n";
            cachedChurches.forEach((c, index) => { list += `*${index + 1}.* ${c.name}\n`; });
            reply = list;
            userSession[cleanPhone] = { onboarding: true };
        }
        else if (userSession[cleanPhone]?.step === 'PAY') {
            let amount = incomingMsg.replace(/\D/g,''); 
            let type = userSession[cleanPhone].choice === '1' ? 'OFFERING' : 'TITHE';
            
            if (userSession[cleanPhone].choice === '3') {
                const sheetPrice = (church.eventPrice || '0').toString().replace(/\D/g,'');
                const isAffirmative = ['yes', 'y', 'yeah', 'yebo', 'ok', 'sure', 'confirm'].some(w => incomingMsg.includes(w));
                const isPriceMatch = amount === sheetPrice;
                if (isAffirmative || isPriceMatch) { amount = sheetPrice; type = 'TICKET'; } 
                else { reply = "❌ Cancelled."; twiml.message(reply); res.type('text/xml').send(twiml.toString()); return; }
            }

            // 👇 THIS IS WHERE YOU WERE MISSING THE DEFINITION 👇
            const ref = `${churchCode}-${type}-${cleanPhone.slice(-4)}`;
            const systemEmail = `${cleanPhone}@seabe.io`;
            
            const finalChurchCode = churchCode; 
            const finalType = type;
            const finalAmount = amount;
            const finalRef = ref;
            // Get subaccount from memory
            const finalSubaccount = church.subaccount; 

            // Pass subaccount to Paystack
            const link = await createPaymentLink(amount, ref, systemEmail, finalSubaccount);
            
            if (link) {
                reply = `Tap to pay R${amount}:\n👉 ${link}`;
                if (client) {
                    setTimeout(async () => {
                        const pdfName = generatePDF(finalType, finalAmount, finalRef, new Date().toLocaleString(), cleanPhone, churchName);
                        const hostUrl = req.headers.host || 'seabe-bot.onrender.com';
                        const pdfUrl = `https://${hostUrl}/public/receipts/${pdfName}`;
                        try { await client.messages.create({ from: 'whatsapp:+14155238886', to: sender, body: `🎉 Payment Received! ${getAdSuffix('ENGLISH', finalChurchCode)}`, mediaUrl: [pdfUrl] }); } catch(e) {}
                        await logToSheet(cleanPhone, finalChurchCode, finalType, finalAmount, finalRef);
                    }, 15000);
                }
            } else { reply = "⚠️ Error creating link."; }

            userSession[cleanPhone].step = 'MENU';
        } 
        else { reply = "Reply *Hi* to see the menu."; }
    }

    twiml.message(reply);
    res.type('text/xml').send(twiml.toString());
});

app.post('/payment-success', (req, res) => res.send("<h1>Payment Successful! 🎉</h1><p>You can return to WhatsApp.</p>"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Seabe Platform running on ${PORT}`));