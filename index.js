require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { MessagingResponse } = require('twilio').twiml;
const { createPaymentLink } = require('./services/stitch');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// --- TRANSLATIONS ---
const TRANSLATIONS = {
    'ENGLISH': {
        welcome: "Welcome to Seabe! 🇿🇦\n\nChoose your language:\n*1.* English\n*2.* isiZulu\n*3.* Sesotho",
        menu: "Welcome! 👋\nReply with a number:\n*1.* General Offering 🎁\n*2.* Pay Tithe (10%) 🏛️",
        ask_offering: "Amen! 🎁\nHow much is your *Offering*? (e.g. R100)",
        ask_tithe: "Bringing the full tithe. 🏛️\nEnter amount: (e.g. R500)",
        click_to_pay: "Tap to pay",
        receipt_text: "Attached is your official receipt. Thank you! 🙏",
        news_header: "📢 *Church News:*"
    },
    'ZULU': {
        menu: "Siyakwamukela! 👋\nPhendula ngenombolo:\n*1.* Umnikelo Jikelele 🎁\n*2.* Okweshumi (10%) 🏛️",
        ask_offering: "Amen! 🎁\nUngakanani *Umnikelo* wakho? (isib. R100)",
        ask_tithe: "Ukuletha okweshumi okuphelele. 🏛️\nFaka inani: (isib. R500)",
        click_to_pay: "Cindezela ukukhokha",
        receipt_text: "Namathisela irisidi lakho elisemthethweni. Siyabonga! 🙏",
        news_header: "📢 *Izaziso:*"
    },
    'SOTHO': {
        menu: "Re a o amohela! 👋\nAraba ka nomoro:\n*1.* Nyehelo 🎁\n*2.* Boshome (10%) 🏛️",
        ask_offering: "Amen! 🎁\nKe bokae *Nyehelo* ea hau? (mohl. R100)",
        ask_tithe: "O tlisa boshome bo feletseng. 🏛️\nKenya chelete: (mohl. R500)",
        click_to_pay: "Tobetsa ho lefa",
        receipt_text: "Re rometse rasiti ea hau ea molao. Re a leboha! 🙏",
        news_header: "📢 *Tsebisano:*"
    }
};

// --- CONFIG ---
const ACCOUNT_SID = process.env.TWILIO_SID; 
const AUTH_TOKEN = process.env.TWILIO_AUTH;
const GOOGLE_EMAIL = process.env.GOOGLE_EMAIL;
const GOOGLE_KEY = process.env.GOOGLE_KEY ? process.env.GOOGLE_KEY.replace(/\\n/g, '\n') : null;
const SHEET_ID = process.env.SHEET_ID;

let client;
try {
    if (ACCOUNT_SID && AUTH_TOKEN) client = require('twilio')(ACCOUNT_SID, AUTH_TOKEN);
} catch (e) { console.log("⚠️ Twilio Error"); }

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

let userSession = {}; 
let activeAds = []; // Store ads in memory

// --- 📢 AD ENGINE ---
async function fetchAds() {
    if (!GOOGLE_EMAIL || !GOOGLE_KEY || !SHEET_ID) return;
    try {
        const serviceAccountAuth = new JWT({ email: GOOGLE_EMAIL, key: GOOGLE_KEY, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
        const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
        await doc.loadInfo();
        
        // Assume 'Ads' is the second tab (index 1)
        const sheet = doc.sheetsByIndex[1]; 
        if (!sheet) return;

        const rows = await sheet.getRows();
        
        // Filter only rows where Status is 'Active'
        activeAds = rows
            .filter(row => row.get('Status') && row.get('Status').trim().toLowerCase() === 'active')
            .map(row => ({
                ENGLISH: row.get('English'),
                ZULU: row.get('Zulu'),
                SOTHO: row.get('Sotho')
            }));
        
        console.log(`📢 Ad Engine: Loaded ${activeAds.length} active ads.`);
    } catch (e) { console.error("❌ Ad Fetch Error:", e.message); }
}

// Refresh ads every 10 minutes
setInterval(fetchAds, 600000);
fetchAds(); // Initial fetch on startup

function getAdSuffix(lang) {
    if (activeAds.length === 0) return "";
    const randomAd = activeAds[Math.floor(Math.random() * activeAds.length)];
    const adText = randomAd[lang] || randomAd['ENGLISH']; // Fallback to English
    const header = TRANSLATIONS[lang].news_header;
    return `\n\n----------------\n${header}\n${adText}`;
}

// --- HELPERS ---
function generateReceipt(amount, ref, date, phone) {
    const doc = new PDFDocument({ size: 'A5', margin: 50 });
    const filename = `receipt_${Date.now()}_${phone.slice(-4)}.pdf`;
    const filePath = path.join(__dirname, 'public', 'receipts', filename);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)){ fs.mkdirSync(dir, { recursive: true }); }
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    
    const logoPath = path.join(__dirname, 'public', 'logo.png');
    if (fs.existsSync(logoPath)) { doc.image(logoPath, 50, 40, { width: 50 }); doc.moveDown(2); }

    doc.fontSize(20).text('OFFICIAL RECEIPT', 50, 100, { align: 'right', color: '#333' });
    doc.moveDown();
    doc.fontSize(10).text('Seabe Digital Treasury', { align: 'right' });
    
    doc.moveDown();
    doc.moveTo(50, 160).lineTo(370, 160).stroke();
    
    doc.moveDown(2);
    doc.fontSize(12).text(`Date: ${date}`, 50);
    doc.moveDown(0.5);
    doc.text(`Reference: ${ref}`);
    doc.moveDown(0.5);
    doc.text(`Contributor: ${phone}`);
    
    doc.moveDown(2);
    doc.rect(50, doc.y, 320, 40).fillAndStroke('#f0f0f0', '#333');
    doc.fillColor('#000').fontSize(16).text(`AMOUNT:  R ${amount}.00`, 70, doc.y - 30);
    
    doc.moveDown(4);
    doc.fontSize(10).text('Thank you for your generosity.', { align: 'center' });
    doc.end();
    return filename;
}

async function logToSheet(phone, type, amount, ref) {
    if (!GOOGLE_EMAIL || !GOOGLE_KEY || !SHEET_ID) return;
    try {
        const serviceAccountAuth = new JWT({ email: GOOGLE_EMAIL, key: GOOGLE_KEY, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
        const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
        await doc.loadInfo(); 
        const sheet = doc.sheetsByIndex[0];
        await sheet.addRow({ Date: new Date().toLocaleString(), "Name/Phone": phone, "Type": type, "Amount": amount, "Reference": ref });
    } catch (error) { console.error("❌ Sheet Error:", error.message); }
}

// --- WHATSAPP BOT ---
app.post('/whatsapp', async (req, res) => {
    const incomingMsg = req.body.Body.trim().toLowerCase(); 
    const sender = req.body.From; 
    const cleanPhone = sender.replace('whatsapp:', '');
    const twiml = new MessagingResponse();
    
    let userLang = userSession[cleanPhone]?.language || 'ENGLISH';
    let reply = "";

    if (['hi', 'hello', 'dumela', 'sawubona', 'menu'].includes(incomingMsg)) {
        reply = TRANSLATIONS['ENGLISH'].welcome;
        userSession[cleanPhone] = { step: 'LANG_SELECT', language: 'ENGLISH' };
    } 
    else if (userSession[cleanPhone]?.step === 'LANG_SELECT') {
        if (incomingMsg === '1') userLang = 'ENGLISH';
        else if (incomingMsg === '2') userLang = 'ZULU';
        else if (incomingMsg === '3') userLang = 'SOTHO';
        userSession[cleanPhone] = { step: 'PAYMENT_SELECT', language: userLang };
        
        // Show Menu + Ad
        reply = TRANSLATIONS[userLang].menu + getAdSuffix(userLang);
    }
    else if (userSession[cleanPhone]?.step === 'PAYMENT_SELECT' && ['1', '2'].includes(incomingMsg)) {
        const paymentType = incomingMsg === '1' ? 'OFFERING' : 'TITHE';
        userSession[cleanPhone].paymentType = paymentType;
        userSession[cleanPhone].step = 'AMOUNT_INPUT';
        if (paymentType === 'OFFERING') reply = TRANSLATIONS[userLang].ask_offering;
        else reply = TRANSLATIONS[userLang].ask_tithe;
    }
    else if (incomingMsg.match(/R?\d+/)) {
        const amount = incomingMsg.replace(/\D/g,''); 
        const paymentType = userSession[cleanPhone]?.paymentType || 'OFFERING';
        const churchRef = `${paymentType}-${cleanPhone.slice(-4)}`;
        const compoundRef = `${cleanPhone}__${churchRef}`;
        
        const paymentUrl = await createPaymentLink(amount + ".00", compoundRef); 
        const clickText = TRANSLATIONS[userLang].click_to_pay;
        reply = `${clickText} R${amount}:\n👉 ${paymentUrl}`;
        delete userSession[cleanPhone]; 

        if (client) {
            setTimeout(async () => {
                const now = new Date().toLocaleString();
                const pdfFilename = generateReceipt(amount, churchRef, now, cleanPhone);
                const hostUrl = req.headers.host || 'seabe-bot.onrender.com';
                const pdfUrl = `https://${hostUrl}/public/receipts/${pdfFilename}`;

                try {
                    const receiptText = TRANSLATIONS[userLang].receipt_text;
                    // Send Receipt + Ad
                    await client.messages.create({
                        from: 'whatsapp:+14155238886', 
                        to: sender,
                        body: `🎉 *Seabe* \n\n${receiptText} ${getAdSuffix(userLang)}`,
                        mediaUrl: [pdfUrl]
                    });
                } catch (err) { console.error("❌ Receipt Failed", err); }
                
                await logToSheet(cleanPhone, paymentType, amount, churchRef);
            }, 15000); 
        }
    }
    else { reply = `Sorry, reply with *Hi* to start over.`; }

    twiml.message(reply);
    res.type('text/xml').send(twiml.toString());
});

app.post('/stitch-webhook', (req, res) => res.sendStatus(200));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Seabe Bot running on ${PORT}`));