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

// --- 🧠 MEMORY ---
let userSession = {}; 
let cachedChurches = []; // Stores list of churches
let cachedAds = [];      // Stores all ads

// --- 🔄 DATABASE ENGINE (SHEETS) ---
async function getDoc() {
    const serviceAccountAuth = new JWT({ email: GOOGLE_EMAIL, key: GOOGLE_KEY, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    return doc;
}

// 1. Fetch Church List & Ads (Runs every 10 mins)
async function refreshCache() {
    if (!GOOGLE_EMAIL) return;
    try {
        const doc = await getDoc();
        
        // Load Churches (Tab 3: index 2)
        const churchSheet = doc.sheetsByIndex[2]; 
        const churchRows = await churchSheet.getRows();
        cachedChurches = churchRows.map(row => ({
            code: row.get('Code'),
            name: row.get('Name'),
            eventName: row.get('Event_Name'),
            eventPrice: row.get('Event_Price')
        }));

        // Load Ads (Tab 2: index 1)
        const adSheet = doc.sheetsByIndex[1];
        const adRows = await adSheet.getRows();
        cachedAds = adRows
            .filter(row => row.get('Status') === 'Active')
            .map(row => ({
                target: row.get('Target'), // 'Global' or Church Code
                ENGLISH: row.get('English'),
                ZULU: row.get('Zulu'),
                SOTHO: row.get('Sotho')
            }));
            
        console.log(`♻️ Cache Updated: ${cachedChurches.length} Churches, ${cachedAds.length} Ads.`);
    } catch (e) { console.error("❌ Cache Error:", e.message); }
}
setInterval(refreshCache, 600000); // 10 mins
refreshCache(); // Start immediately

// 2. Find User's Church
async function getUserChurch(phone) {
    const doc = await getDoc();
    const userSheet = doc.sheetsByIndex[3]; // Tab 4: Users
    const rows = await userSheet.getRows();
    const userRow = rows.find(r => r.get('Phone') === phone);
    return userRow ? userRow.get('Church_Code') : null;
}

// 3. Register New User
async function registerUser(phone, churchCode) {
    const doc = await getDoc();
    const userSheet = doc.sheetsByIndex[3];
    await userSheet.addRow({ Phone: phone, Church_Code: churchCode });
}

// 4. Get Ad (Mixed Global + Local)
function getAdSuffix(lang, churchCode) {
    // Filter ads: Show 'Global' OR ads for this specific church
    const relevantAds = cachedAds.filter(ad => ad.target === 'Global' || ad.target === churchCode);
    
    if (relevantAds.length === 0) return "";
    const randomAd = relevantAds[Math.floor(Math.random() * relevantAds.length)];
    const adText = randomAd[lang] || randomAd['ENGLISH'];
    return `\n\n----------------\n📢 *News/Ads:*\n${adText}`;
}

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
    doc.fontSize(10).text(churchName, { align: 'right' }); // 👈 Dynamic Church Name
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
    const sheet = doc.sheetsByIndex[0]; // Tab 1: Transactions
    await sheet.addRow({ 
        "Church Code": churchCode, 
        Date: new Date().toLocaleString(), 
        "Name/Phone": phone, 
        Type: type, 
        Amount: amount, 
        Reference: ref 
    });
}

// --- 🤖 WHATSAPP LOGIC ---
app.post('/whatsapp', async (req, res) => {
    const incomingMsg = req.body.Body.trim().toLowerCase(); 
    const sender = req.body.From; 
    const cleanPhone = sender.replace('whatsapp:', '');
    const twiml = new MessagingResponse();
    let reply = "";

    // 1. Identify User & Church
    let churchCode = userSession[cleanPhone]?.churchCode;
    
    // If not in session, check DB
    if (!churchCode) {
        churchCode = await getUserChurch(cleanPhone);
        if (churchCode) userSession[cleanPhone] = { ...userSession[cleanPhone], churchCode };
    }

    // 2. ONBOARDING (If no church found)
    if (!churchCode) {
        if (!userSession[cleanPhone]?.onboarding) {
            // Step A: List Churches
            let list = "Welcome to Seabe! 🇿🇦\nPlease select your church:\n";
            cachedChurches.forEach((c, index) => {
                list += `*${index + 1}.* ${c.name}\n`;
            });
            reply = list;
            userSession[cleanPhone] = { onboarding: true };
        } else {
            // Step B: User Selects Church
            const selection = parseInt(incomingMsg) - 1;
            if (cachedChurches[selection]) {
                const selectedChurch = cachedChurches[selection];
                await registerUser(cleanPhone, selectedChurch.code);
                
                // Update Session
                userSession[cleanPhone] = { churchCode: selectedChurch.code };
                delete userSession[cleanPhone].onboarding;
                
                reply = `Welcome to *${selectedChurch.name}*! 🎉\nReply *Hi* to see your menu.`;
            } else {
                reply = "⚠️ Invalid selection. Please try again.";
            }
        }
    } 
    
    // 3. MAIN MENU (Church is Known)
    else {
        const church = cachedChurches.find(c => c.code === churchCode);
        const churchName = church ? church.name : "Church";
        
        // Define Languages (Simplified for brevity, expandable)
        const menuText = `Welcome to *${churchName}* 👋\n\n*1.* General Offering 🎁\n*2.* Pay Tithe 🏛️\n*3.* ${church.eventName || 'Event'} (R${church.eventPrice || '0'}) 🎟️\n*4.* Switch Church 🔄`;

        if (['hi', 'menu', 'hello'].includes(incomingMsg)) {
            userSession[cleanPhone].step = 'MENU';
            reply = menuText + getAdSuffix('ENGLISH', churchCode);
        }
        else if (incomingMsg === '4') {
             // Reset User (Optional feature to switch churches)
             // In real app, you'd delete row from Users sheet. For MVP:
             reply = "To switch churches, please contact support.";
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
                if (incomingMsg.includes('yes')) {
                    amount = church.eventPrice;
                    type = 'TICKET';
                } else {
                    reply = "Cancelled.";
                    twiml.message(reply);
                    res.type('text/xml').send(twiml.toString());
                    return;
                }
            }

            // Generate Link with CHURCH CODE in reference
            const ref = `${churchCode}-${type}-${cleanPhone.slice(-4)}`;
            const link = await createPaymentLink(amount + ".00", ref);
            
            reply = `Tap to pay R${amount}:\n👉 ${link}`;
            
            // Async Receipt
            if (client) {
                setTimeout(async () => {
                    const pdfName = generatePDF(type, amount, ref, new Date().toLocaleString(), cleanPhone, churchName);
                    const hostUrl = req.headers.host || 'seabe-bot.onrender.com';
                    const pdfUrl = `https://${hostUrl}/public/receipts/${pdfName}`;
                    
                    try {
                        await client.messages.create({
                            from: 'whatsapp:+14155238886', to: sender,
                            body: `🎉 Payment Received! ${getAdSuffix('ENGLISH', churchCode)}`,
                            mediaUrl: [pdfUrl]
                        });
                    } catch(e) {}
                    await logToSheet(cleanPhone, churchCode, type, amount, ref);
                }, 15000);
            }
            
            // Clear Step
            userSession[cleanPhone].step = 'MENU';
        }
    }

    twiml.message(reply);
    res.type('text/xml').send(twiml.toString());
});

app.post('/stitch-webhook', (req, res) => res.sendStatus(200));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Seabe Platform running on ${PORT}`));