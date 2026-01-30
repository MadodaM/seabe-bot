require('dotenv').config();
const axios = require('axios'); // For HubSpot
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const sgMail = require('@sendgrid/mail'); 
const cron = require('node-cron');
const { MessagingResponse } = require('twilio').twiml;
const { createPaymentLink, createSubscriptionLink } = require('./services/paystack');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' }); // Temporary storage
const ADMIN_NUMBERS = ['27832182707'];

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

// 1. Import Nodemailer
const nodemailer = require('nodemailer');

// 2. Configure the Transporter (The Mailman)
// 👇 TRY PORT 587 (STARTTLS) - Works better on Cloud Servers
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // Must be false for Port 587 (it upgrades to secure automatically)
    auth: {
        user: process.env.EMAIL_FROM,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false
    }
});

// 👇 NEW: Serve the Website at the Root URL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 👇 NEW: Terms of Service Page
app.get('/terms', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});

// 👇 NEW: Serve Registration Page
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// 👇 NEW: Handle Demo Requests (Corrected)
// 1. Import SendGrid at the top of your file (add this with other requires)

// ...

// 👇 CORRECTED ROUTE: SendGrid + HubSpot
app.post('/request-demo', upload.none(), async (req, res) => {
    const { firstname, email, phone } = req.body;

    // Set the API Key dynamically
    if (process.env.SENDGRID_KEY) {
        sgMail.setApiKey(process.env.SENDGRID_KEY);
    }

    try {
        // --- ACTION 1: Send Email via SendGrid ---
        // We wrap this in its OWN try/catch so email errors don't crash the whole app
        try {
            const msg = {
                to: process.env.EMAIL_FROM,    // Send TO yourself
                from: process.env.EMAIL_FROM,  // Send FROM yourself (Must match SendGrid Verified Sender)
                subject: `🔥 New Lead: ${firstname}`,
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px;">
                        <h2 style="color: #075E54;">New Demo Request</h2>
                        <p><strong>Name:</strong> ${firstname}</p>
                        <p><strong>Email:</strong> ${email}</p>
                        <p><strong>Phone:</strong> ${phone}</p>
                        <hr>
                        <p><em>This lead has been synced to HubSpot.</em></p>
                    </div>
                `,
            };
            await sgMail.send(msg);
            console.log("✅ Email Sent via SendGrid API");
        } catch (emailError) {
            // Log the specific error if SendGrid fails
            console.error("❌ SendGrid Error:", emailError.response ? emailError.response.body : emailError.message);
        }

        // --- ACTION 2: Send to HubSpot CRM ---
        if (process.env.HUBSPOT_TOKEN) {
            await axios.post('https://api.hubapi.com/crm/v3/objects/contacts', {
                properties: {
                    firstname: firstname,
                    email: email,
                    phone: phone,
                    lifecyclestage: 'lead',
                    hs_lead_status: 'OPEN'
                }
            }, {
                headers: {
                    'Authorization': `Bearer ${process.env.HUBSPOT_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            });
            console.log(`✅ HubSpot Contact Created`);
        }

        // --- ACTION 3: Success Page ---
        res.send(`
            <div style="font-family:sans-serif; text-align:center; padding:100px;">
                <h1 style="color:#25D366; font-size:3rem;">Received! ✅</h1>
                <p style="font-size:1.5rem;">Thanks, ${firstname}. We will call you shortly.</p>
                <a href="/" style="color:#075E54; text-decoration:underline;">Back to Home</a>
            </div>
        `);

    } catch (error) {
        // This is the MAIN catch block that was missing!
        console.error("General Error:", error.message);
        res.send('<h1>Received! (Saved locally)</h1><a href="/">Back</a>');
    }
});

// 👇 UPDATED: Church Registration (SendGrid + Attachments)
app.post('/register-church', upload.fields([{ name: 'idDoc' }, { name: 'bankDoc' }]), async (req, res) => {
    try {
        const { churchName, email, eventName, eventPrice } = req.body;
        const files = req.files; // Access uploaded files

        // 1. Generate Church Code
        const prefix = churchName.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
        const randomNum = Math.floor(100 + Math.random() * 900);
        const newCode = `${prefix}${randomNum}`;

        // 2. Save to Google Sheet
        const doc = await getDoc();
        const churchSheet = doc.sheetsByTitle['Churches'] || doc.sheetsByIndex[2];
        await churchSheet.addRow({
            'Name': churchName,
            'Church Code': newCode,
            'Email': email,
            'Subaccount Code': 'PENDING',
            'Event Name': eventName || 'Special Event',
            'Event_Price': eventPrice || '0'
        });

        await refreshCache();

        // 3. Prepare Attachments for SendGrid
        // We must read the file from disk and convert to Base64
        const idFile = files['idDoc'][0];
        const bankFile = files['bankDoc'][0];

        const attachment1 = fs.readFileSync(idFile.path).toString("base64");
        const attachment2 = fs.readFileSync(bankFile.path).toString("base64");

        // 4. Send Email via SendGrid
        if (process.env.SENDGRID_KEY) {
            sgMail.setApiKey(process.env.SENDGRID_KEY);
            
            const msg = {
                to: process.env.EMAIL_FROM,    // Send to Admin
                from: process.env.EMAIL_FROM,  // From Verified Sender
                subject: `🆕 New Church Application: ${churchName}`,
                html: `
                    <h2>New Registration Received</h2>
                    <p><strong>Church:</strong> ${churchName}</p>
                    <p><strong>Code:</strong> ${newCode}</p>
                    <p><strong>Contact:</strong> ${email}</p>
                    <hr>
                    <p>Attached are the KYC documents for Paystack verification.</p>
                `,
                attachments: [
                    {
                        content: attachment1,
                        filename: `${newCode}_ID.pdf`, // Renaming for clarity
                        type: idFile.mimetype,
                        disposition: "attachment"
                    },
                    {
                        content: attachment2,
                        filename: `${newCode}_Bank.pdf`,
                        type: bankFile.mimetype,
                        disposition: "attachment"
                    }
                ]
            };
            await sgMail.send(msg);
            console.log("✅ Registration Email Sent with Attachments");
        }

        // 5. Clean up (Delete temp files from server)
        fs.unlinkSync(idFile.path); 
        fs.unlinkSync(bankFile.path);

        // 6. Success Response
        res.send(`
            <div style="font-family:sans-serif; text-align:center; padding:50px;">
                <h1 style="color:#25D366;">🎉 Application Received!</h1>
                <p><strong>${churchName}</strong> is under review.</p>
                <p>We have received your documents.</p>
                <p>Your System Code is: <strong style="font-size:1.5em;">${newCode}</strong></p>
                <a href="/register">Add Another</a>
            </div>
        `);

    } catch (error) {
        console.error("Registration Error:", error);
        res.send(`<h1>❌ Error</h1><p>${error.message}</p>`);
    }
});

// --- 🧠 MEMORY ---
let userSession = {}; 
let cachedChurches = []; 
let cachedAds = [];  
let cachedEvents = []; 

// --- 🔄 DATABASE ENGINE (BULLETPROOF VERSION) ---
async function getDoc() {
    if (!GOOGLE_EMAIL || !GOOGLE_KEY) throw new Error("Missing Google Credentials");
    const serviceAccountAuth = new JWT({ email: GOOGLE_EMAIL, key: GOOGLE_KEY, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    return doc;
}

// Global Refresh Function (Exposed for Debugging)
async function refreshCache() {
    console.log("🔄 Starting Cache Refresh...");
    try {
        const doc = await getDoc();
        
        // 1. Load Churches (Tab 3) - Uses strict headers from your X-Ray
        const churchSheet = doc.sheetsByTitle['Churches'] || doc.sheetsByIndex[2];
        const churchRows = await churchSheet.getRows();
        
        cachedChurches = churchRows.map(row => {
            // STRICT MAPPING based on your X-Ray report
            const name = row.get('Name');
            const code = row.get('Church Code');
            const subaccount = row.get('Subaccount Code'); 
            const email = row.get('Email');

            // Validation: Must have at least a Name and Code
            if (!name || !code) return null;

            return { 
                code: code.trim(), 
                name: name.trim(), 
                email: email ? email.trim() : "", 
                subaccount: subaccount ? subaccount.trim() : null 
            };
        }).filter(c => c !== null); // Filter out empty rows

        // 2. Load Ads (Tab 2)
        const adSheet = doc.sheetsByTitle['Ads'] || doc.sheetsByIndex[1];
        if (adSheet) {
            const adRows = await adSheet.getRows();
            cachedAds = adRows.filter(r => r.get('Status') && r.get('Status').trim() === 'Active')
                .map(r => ({
                     target: r.get('Target') ? r.get('Target').trim() : 'Global', 
                     ENGLISH: r.get('English'), ZULU: r.get('Zulu'), SOTHO: r.get('Sotho')
                }));
        }

        // 3. Load Events (Tab 5)
        const eventSheet = doc.sheetsByTitle['Events'] || doc.sheetsByIndex[4];
        if (eventSheet) {
            const eventRows = await eventSheet.getRows();
            cachedEvents = eventRows
                .filter(r => r.get('Status') && r.get('Status').trim() === 'Active')
                .map(r => ({
                    churchCode: r.get('Church Code') ? r.get('Church Code').trim() : null,
                    name: r.get('Event Name'),
                    price: r.get('Price'),
                    date: r.get('Date')
                }));
        }
        
        console.log(`♻️ REFRESH COMPLETE: ${cachedChurches.length} Churches, ${cachedEvents.length} Events.`);
        return `Success: Loaded ${cachedChurches.length} Churches`;

    } catch (e) { 
        console.error("❌ CRITICAL CACHE ERROR:", e.message); 
        return `Error: ${e.message}`;
    }
}
// Run once on startup
refreshCache();
// Run every 10 mins
setInterval(refreshCache, 600000); 

// --- 👥 USER MANAGEMENT ---
async function getHeaders(sheet) {
    await sheet.loadHeaderRow();
    const headers = sheet.headerValues;
    const phoneHeader = headers.find(h => h.toLowerCase().includes('phone')) || 'Phone';
    const codeHeader = headers.find(h => h.toLowerCase().includes('code') || h.toLowerCase().includes('church')) || 'Church_Code';
    return { phoneHeader, codeHeader };
}

async function getUserChurch(phone) {
    try {
        const doc = await getDoc();
        const userSheet = doc.sheetsByIndex[3]; 
        const rows = await userSheet.getRows();
        const { phoneHeader, codeHeader } = await getHeaders(userSheet);
        const userRow = rows.find(r => r.get(phoneHeader) === phone);
        return userRow ? userRow.get(codeHeader) : null;
    } catch (e) { return null; }
}

async function registerUser(phone, churchCode) {
    try {
        const doc = await getDoc();
        const userSheet = doc.sheetsByIndex[3]; 
        const { phoneHeader, codeHeader } = await getHeaders(userSheet);
        const rowData = {};
        rowData[phoneHeader] = phone;
        rowData[codeHeader] = churchCode;
        await userSheet.addRow(rowData);
    } catch (e) { console.error("Register Error:", e.message); }
}

async function removeUser(phone) {
    try {
        const doc = await getDoc();
        const userSheet = doc.sheetsByIndex[3]; 
        const rows = await userSheet.getRows();
        const { phoneHeader } = await getHeaders(userSheet);
        const rowToDelete = rows.find(r => r.get(phoneHeader) === phone);
        if (rowToDelete) { await rowToDelete.delete(); }
    } catch (e) { console.error("Remove Error:", e.message); }
}

// --- 📧 REPORTING ---
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

    try { await sgMail.send(msg); return `✅ Sent to ${church.email}`; } 
    catch (error) { return `❌ Failed for ${churchCode}`; }
}

cron.schedule('0 8 * * 1', async () => {
    for (const church of cachedChurches) {
        if (church.code && church.email) await emailReport(church.code);
    }
}, { timezone: "Africa/Johannesburg" });

// --- 📄 PDF FACTORY (ASYNC VERSION) ---
function generatePDF(type, amount, ref, date, phone, churchName, eventDetail = '') {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'A5', margin: 50 });
            const filename = `receipt_${Date.now()}_${phone.slice(-4)}.pdf`;
            const filePath = path.join(__dirname, 'public', 'receipts', filename);
            const dir = path.dirname(filePath);

            // Ensure directory exists
            if (!fs.existsSync(dir)){ fs.mkdirSync(dir, { recursive: true }); }

            const stream = fs.createWriteStream(filePath);
            doc.pipe(stream);

            // Content
            doc.fontSize(20).text(type === 'TICKET' ? 'ADMIT ONE' : 'RECEIPT', 50, 100, { align: 'right' });
            doc.fontSize(10).text(churchName, { align: 'right' });
            doc.moveDown(); doc.moveTo(50, 160).lineTo(370, 160).stroke(); doc.moveDown(2);
            doc.text(`Ref: ${ref}`); doc.text(`Member: ${phone}`); 
            if(eventDetail) doc.text(`Event: ${eventDetail}`); 
            doc.moveDown(2);
            doc.fontSize(16).text(`AMOUNT:  R ${amount}.00`, 50);

            doc.end();

            // 👇 CRITICAL: Wait for the file to be fully written
            stream.on('finish', () => {
                resolve(filename); // Only returns when file is ready
            });

            stream.on('error', (err) => {
                reject(err);
            });

        } catch (e) {
            reject(e);
        }
    });
}

async function logToSheet(phone, churchCode, type, amount, ref) {
    const doc = await getDoc();
    const sheet = doc.sheetsByIndex[0]; 
    await sheet.addRow({ "Church Code": churchCode, Date: new Date().toLocaleString(), "Name/Phone": phone, Type: type, Amount: amount, Reference: ref });
}

function getAdSuffix(lang, churchCode) {
    const safeLang = lang || 'ENGLISH'; 
    const relevantAds = cachedAds.filter(ad => ad.target === 'Global' || ad.target === churchCode);
    if (relevantAds.length === 0) return "";
    const randomAd = relevantAds[Math.floor(Math.random() * relevantAds.length)];
    const adText = randomAd[safeLang] || randomAd['ENGLISH'];
    return `\n\n----------------\n📢 *News/Ads:*\n${adText}`;
}

// --- 🩺 DIAGNOSTIC TOOL (WITH REFRESH BUTTON) ---
app.get('/test-connection', async (req, res) => {
    // Allows manual refresh from browser
    if (req.query.refresh === 'true') {
        const result = await refreshCache();
        res.send(`<h1>${result}</h1><p><a href="/test-connection">Back to Report</a></p>`);
        return;
    }

    res.send(`
        <h1>🔍 LIVE STATUS REPORT</h1>
        <p><strong>Status:</strong> ${cachedChurches.length > 0 ? "✅ ONLINE" : "⚠️ LOADING..."}</p>
        <hr>
        <h3>Bot Memory:</h3>
        <p>Cached Churches: <strong>${cachedChurches.length}</strong></p>
        <p>Cached Events: <strong>${cachedEvents.length}</strong></p>
        <p>Cached Ads: <strong>${cachedAds.length}</strong></p>
        <hr>
        <button onclick="window.location.href='/test-connection?refresh=true'" style="padding:15px; font-size:18px;">🔄 FORCE REFRESH DATABASE</button>
    `);
});

// --- 👤 PROFILE ENGINE ---
async function getMemberProfile(phone) {
    try {
        const doc = await getDoc();
        const sheet = doc.sheetsByIndex[0]; // Transactions Tab
        const rows = await sheet.getRows();
        
        // Filter transactions for this user
        // We look for the phone number in the "Name/Phone" column
        const myTransactions = rows.filter(r => {
            const rowPhone = r.get('Name/Phone');
            return rowPhone && rowPhone.includes(phone);
        });

        if (myTransactions.length === 0) return null;

        let totalGiven = 0;
        let lastDate = "N/A";
        let txCount = 0;

        myTransactions.forEach(row => {
            // Clean the amount string (remove 'R' and spaces) to add it up
            const rawAmount = row.get('Amount');
            if (rawAmount) {
                const amount = parseFloat(rawAmount.toString().replace(/[^0-9.]/g, ''));
                if (!isNaN(amount)) {
                    totalGiven += amount;
                    txCount++;
                }
            }
            lastDate = row.get('Date'); // Updates to the most recent one
        });

        return { total: totalGiven.toFixed(2), count: txCount, lastDate: lastDate };

    } catch (e) {
        console.error("Profile Error:", e);
        return null;
    }
}
// 👇 1. Helper Function for Reports (Paste this ABOVE the route)
async function emailReport(code) {
    console.log(`Generating report for: ${code}`);
    // For now, we just return a success message so the bot doesn't crash.
    // We can add the real PDF logic later.
    return "Report functionality is ready (Simulated)."; 
}

// 👇 1. Helper Function (Paste this ABOVE the route if you don't have it)
async function emailReport(target) {
    console.log("Generating report for:", target);
    return "Report functionality coming soon.";
}

// 👇 2. The Corrected WhatsApp Route
// Notice: We added 'async' here to fix the 'await' error

app.post('/whatsapp', async (req, res) => {
    const twiml = new MessagingResponse();
    
    // --- STEP 1: DEFINITIONS (Must be first!) ---
    const sender = req.body.From;
    const cleanPhone = sender.replace('whatsapp:', '').replace('+', '').trim();
    // We define msgBody HERE so it is ready for the logs below
    const msgBody = req.body.Body ? req.body.Body.trim().toLowerCase() : ''; 

    // --- STEP 2: DEBUG LOG ---
    // Now it is safe to log because msgBody exists
    console.log(`🕵️ ADMIN DEBUG: User=[${cleanPhone}] Msg=[${msgBody}] IsAdmin? ${ADMIN_NUMBERS.includes(cleanPhone)}`);

    // --- STEP 3: ADMIN MENU CHECK ---
    if (msgBody === 'admin' && ADMIN_NUMBERS.includes(cleanPhone)) {
        twiml.message(
            `🛠️ *Admin Command Center*\n\n` +
            `1. 📅 New Event\n` +
            `2. 📊 Send Report\n` +
            `3. ❌ Cancel`
        );
        userState[cleanPhone] = { step: 'ADMIN_MENU' };
        res.type('text/xml').send(twiml.toString());
        return; 
    }

    // --- STEP 4: RESET / CANCEL ---
    if (msgBody === 'cancel' || msgBody === 'reset') {
        delete userState[cleanPhone];
        twiml.message("🔄 Session reset. Reply *Hi*.");
        res.type('text/xml').send(twiml.toString());
        return;
    }

    // --- STEP 5: CONVERSATION LOGIC ---
    const currentState = userState[cleanPhone] ? userState[cleanPhone].step : null;

    if (currentState === 'ADMIN_MENU') {
        if (msgBody === '1') {
            twiml.message("📅 Reply with *Event Name*:");
            userState[cleanPhone] = { step: 'ADMIN_EVENT_NAME' };
        } else if (msgBody === '2') {
            // This 'await' works now because the function is async
            try {
                const reportMsg = await emailReport('ALL');
                twiml.message("✅ " + reportMsg);
            } catch (e) {
                console.error(e);
                twiml.message("❌ Failed to generate report.");
            }
            delete userState[cleanPhone];
        } else {
            twiml.message("❌ Invalid option.");
        }
    
    } else if (currentState === 'ADMIN_EVENT_NAME') {
        userState[cleanPhone] = { step: 'ADMIN_EVENT_DATE', eventName: req.body.Body };
        twiml.message("🗓️ Reply with *Date*:");

    } else if (currentState === 'ADMIN_EVENT_DATE') {
        const name = userState[cleanPhone].eventName;
        const date = req.body.Body;
        twiml.message(`🎉 Event Created:\n*${name}* on *${date}*`);
        delete userState[cleanPhone];

    // --- STEP 6: MAIN MENU (Default) ---
    } else if (msgBody === 'hi' || msgBody === 'hello' || msgBody === 'menu') {
        const msg = twiml.message();
        msg.body(
            `👋 *Welcome to Seabe*\n` +
            `1️⃣ Events\n` +
            `2️⃣ Churches\n` +
            `3️⃣ Register`
        );
        userState[cleanPhone] = { step: 'MAIN_MENU' };

    } else {
        twiml.message("👋 I didn't catch that. Reply with *Hi* for the menu.");
    }

    res.type('text/xml').send(twiml.toString());
});

// --- 🛠️ ADMIN FLOW END ---
// ... continue with your existing 'else if (incomingMsg === 'Hi') ...'

        if (incomingMsg.startsWith('report ')) {
            const targetCode = incomingMsg.split(' ')[1].toUpperCase();
            reply = emailReport(targetCode);
            twiml.message(reply);
            res.type('text/xml').send(twiml.toString());
            return;
        }

        if (!userSession[cleanPhone]) userSession[cleanPhone] = {};
        
        let churchCode = userSession[cleanPhone]?.churchCode;
        if (!churchCode) {
            churchCode = await getUserChurch(cleanPhone);
            if (churchCode) userSession[cleanPhone].churchCode = churchCode;
        }

        if (!churchCode) {
            if (['hi', 'hello', 'menu', 'start'].includes(incomingMsg) || !userSession[cleanPhone]?.onboarding) {
                let list = "Welcome to Seabe! 🇿🇦\nPlease select your church:\n";
                if (cachedChurches.length === 0) {
                    list = "⚠️ System Startup... Please reply 'Hi' in 1 minute.";
                    // Attempt background refresh if empty
                    refreshCache(); 
                } else {
                    cachedChurches.forEach((c, index) => { list += `*${index + 1}.* ${c.name}\n`; });
                }
                reply = list;
                userSession[cleanPhone].onboarding = true;
            } 
            else {
                const selection = parseInt(incomingMsg) - 1;
                if (!isNaN(selection) && cachedChurches[selection]) {
                    const selectedChurch = cachedChurches[selection];
                    await registerUser(cleanPhone, selectedChurch.code);
                    userSession[cleanPhone].churchCode = selectedChurch.code;
                    delete userSession[cleanPhone].onboarding;
                    reply = `Welcome to *${selectedChurch.name}*! 🎉\nReply *Hi* to see your menu.`;
                } else { 
                    reply = "⚠️ Invalid number. Reply *Hi* to see the list."; 
                }
            }
        } else {
            const church = cachedChurches.find(c => c.code === churchCode);
            if (!church) {
                await removeUser(cleanPhone);
                delete userSession[cleanPhone];
                reply = "⚠️ Your church setup has changed. Reply *Hi* to reset.";
            } else {
                const churchName = church.name;
                
                if (['hi', 'menu', 'hello'].includes(incomingMsg)) {
                    userSession[cleanPhone].step = 'MENU';
                    const currentLang = userSession[cleanPhone].lang || 'ENGLISH';
                    // OLD LINE:
					// reply = `Welcome to *${churchName}* 👋\n\n*1.* General Offering 🎁\n*2.* Pay Tithe 🏛️\n*3.* Events & Tickets 🎟️\n*4.* Switch Church 🔄\n*5.* Monthly Partner (Auto) 🔁\n*6.* Language / Lulwimi 🗣️` + getAdSuffix(currentLang, churchCode);

					// 👇 REPLACE WITH THIS NEW BLOCK:
reply = `Welcome to *${churchName}* 👋\n\n` +
        `*1.* General Offering 🎁\n` +
        `*2.* Pay Tithe 🏛️\n` +
        `*3.* Events & Tickets 🎟️\n` +
        `*4.* Switch Church 🔄\n` +
        `*5.* Monthly Partner (Auto) 🔁\n` +
        `*6.* Language / Lulwimi 🗣️\n` +
        `*7.* My Profile / History 👤` + 
        getAdSuffix(currentLang, churchCode);
                }
                else if (incomingMsg === '3' && userSession[cleanPhone]?.step === 'MENU') {
                    const events = cachedEvents.filter(e => e.churchCode === churchCode);
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
                else if (incomingMsg === '6' && userSession[cleanPhone]?.step === 'MENU') {
                    userSession[cleanPhone].step = 'LANG';
                    reply = "Select Language / Khetha Lulwimi:\n\n*1.* English 🇬🇧\n*2.* isiZulu 🇿🇦\n*3.* Sesotho 🇱🇸";
                }
				
				// ... (existing code for option 6) ...

else if (incomingMsg === '7' && userSession[cleanPhone]?.step === 'MENU') {
    // 1. Notify user we are checking (it takes 1-2 seconds)
    // Note: In a simple bot, we just wait and send the result.
    
    const profile = await getMemberProfile(cleanPhone);
    
    if (profile) {
        reply = `👤 *Member Profile*\n` +
                `------------------\n` +
                `📞 Phone: ${cleanPhone}\n` +
                `⛪ Church: ${church.name}\n` +
                `------------------\n` +
                `💰 *Total Giving:* R${profile.total}\n` +
                `🔢 *Transactions:* ${profile.count}\n` +
                `📅 *Last Activity:* ${profile.lastDate}\n\n` +
                `_Thank you for your faithful support!_ 🙏\n` +
                `Reply *Hi* to return to menu.`;
    } else {
        reply = `👤 *Member Profile*\n\n` +
                `We couldn't find any transaction history for this number yet.\n\n` +
                `Make your first contribution today! Reply *Hi* to see options.`;
    }
}

// ... (existing code for other options) ...
				
                else if (['1', '2', '3'].includes(incomingMsg) && userSession[cleanPhone]?.step === 'LANG') {
                    if (incomingMsg === '1') userSession[cleanPhone].lang = 'ENGLISH';
                    if (incomingMsg === '2') userSession[cleanPhone].lang = 'ZULU';
                    if (incomingMsg === '3') userSession[cleanPhone].lang = 'SOTHO';
                    userSession[cleanPhone].step = 'MENU';
                    reply = "✅ Language Updated! Reply *Hi*.";
                }
                else if (['1', '2', '5'].includes(incomingMsg) && userSession[cleanPhone]?.step === 'MENU') {
                    userSession[cleanPhone].step = 'PAY';
                    userSession[cleanPhone].choice = incomingMsg;
                    if (incomingMsg === '5') reply = "Enter Monthly Amount (e.g. R500):";
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
                    const finalSubaccount = church.subaccount; 
                    
                    let link;
                    if (type === 'RECURRING') link = await createSubscriptionLink(amount, ref, systemEmail, finalSubaccount);
                    else link = await createPaymentLink(amount, ref, systemEmail, finalSubaccount);
                    
                    if (link) {
                        reply = `Tap to pay R${amount}:\n👉 ${link}`;
                        const currentLang = userSession[cleanPhone].lang || 'ENGLISH';
                        // 👇 REPLACE THE OLD setTimeout BLOCK WITH THIS DEBUG VERSION
setTimeout(async () => {
        try {
            // 1. Generate PDF and WAIT for it to finish
            const pdfName = await generatePDF(type, amount, ref, new Date().toLocaleString(), cleanPhone, church.name, eventNameForPdf);
            
            // 2. Construct URL
            // Using your new domain ensures SSL trust
            // TEMPORARY FIX: Use the Render URL until seabe.co.za Certificate is Green
			// const hostUrl = 'seabe.co.za';  <-- COMMENT THIS OUT FOR NOW
			const hostUrl = 'seabe-bot.onrender.com'; // <-- USE THIS TEMPORARILY 
            const pdfUrl = `https://${hostUrl}/public/receipts/${pdfName}`;
            console.log("📄 PDF Ready on Disk. Sending to Twilio:", pdfUrl);

            // 3. Send WhatsApp
            await client.messages.create({ 
                from: 'whatsapp:+14155238886', 
                to: sender, 
                body: `🎉 Payment Received! ${getAdSuffix(currentLang, churchCode)}`, 
                mediaUrl: [pdfUrl] 
            });
            console.log("✅ PDF Delivered");

            // 4. Log to Sheet
            await logToSheet(cleanPhone, churchCode, type, amount, ref);

        } catch (e) {
            console.error("❌ PDF ERROR:", e.message); 
            // Log money anyway
            await logToSheet(cleanPhone, churchCode, type, amount, ref);
        }
    }, 15000);
                    } else { reply = "⚠️ Error creating link."; }
                    userSession[cleanPhone].step = 'MENU';
                } else { reply = "Reply *Hi* to see the menu."; }
            }
        }
        
        twiml.message(reply);
        res.type('text/xml').send(twiml.toString());

    } catch (error) {
        console.error("❌ FATAL BOT CRASH:", error);
        twiml.message("⚠️ System Error: Please try again in 1 minute.");
        res.type('text/xml').send(twiml.toString());
    }
});

// ✅ NEW (Correct)
app.get('/payment-success', (req, res) => {
    res.send(`
        <div style="text-align:center; padding:50px; font-family:sans-serif;">
            <h1 style="color:#25D366;">Payment Successful! 🎉</h1>
            <p>You have successfully donated.</p>
            <p>You can close this window and return to WhatsApp.</p>
        </div>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Seabe Platform running on ${PORT}`));