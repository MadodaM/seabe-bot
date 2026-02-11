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
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER; 
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

// --- UTILITY: PHONE FORMATTER ---
const formatPhone = (phone) => {
    if (!phone) return "";
    let clean = phone.replace(/\D/g, '');
    if (clean.startsWith('0')) clean = '27' + clean.slice(1);
    return '+' + clean;
};

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Dedicated ping route to keep Render awake
app.get('/ping', (req, res) => {
    res.status(200).send("Heartbeat received. Seabe Engine is awake.");
});

// --- ROUTES ---
// ==========================================
// 1. STATIC LEGAL PAGES
// (These are specific files, so they go first)
// ==========================================
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/legal', (req, res) => res.sendFile(path.join(__dirname, 'public', 'legal.html')));

// ==========================================
// 2. SUPER ADMIN CONSOLE (Routes: /login, /admin/churches)
// ⚠️ MUST be before Client Admin!
// ==========================================
try {
    require('./routes/platform')(app, { prisma });
    console.log("✅ Super Admin Platform Loaded");
} catch (e) { console.log("⚠️ Platform routes missing"); }

// ==========================================
// 3. CLIENT PORTAL (Routes: /admin/:code)
// ⚠️ Captures /admin/ANYTHING, so it must come AFTER specific admin routes
// ==========================================
try {
    require('./routes/admin')(app, { prisma });
    console.log("✅ Client Admin Loaded");
} catch (e) { console.log("⚠️ Client Admin routes missing"); }

// ==========================================
// 4. PUBLIC PAYMENT LINKS (Routes: /link/:code)
// ==========================================
try {
    require('./routes/link')(app, { prisma });
    console.log("✅ Payment Link Routes Loaded");
} catch (e) { console.log("⚠️ Link routes missing"); }

// ==========================================
// 5. GENERAL WEB & UPLOADS
// (Usually contains catch-all or home pages)
// ==========================================
try {
    // Ensure 'upload' middleware is defined before this line in your main file
    require('./routes/web')(app, upload, { prisma });
    console.log("✅ Web Routes Loaded");
} catch (e) { console.log("⚠️ Web routes missing"); }


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
        const hash = crypto.createHmac('sha512', PAYSTACK_SECRET).update(JSON.stringify(req.body)).digest('hex');
        if (hash !== req.headers['x-paystack-signature']) return res.sendStatus(400);

        const event = req.body;
        if (event.event === 'charge.success') {
            const data = event.data;
            const ref = data.reference;

            // 1. Check if already processed by Success Page
            const existingTx = await prisma.transaction.findUnique({ where: { reference: ref } });
            if (existingTx && existingTx.status === 'SUCCESS') {
                console.log(`♻️ Webhook ignored: ${ref} already handled.`);
                return res.sendStatus(200);
            }

            // 2. Otherwise, process as normal
            const transaction = await prisma.transaction.update({
                where: { reference: ref },
                data: { status: 'SUCCESS' }
            });

            // 3. Send Receipt (Fallback)
            if (transaction && client) {
                const userPhone = transaction.phone;
                const date = new Date().toISOString().split('T')[0];
                const pdfUrl = `https://invoice-generator.com?currency=ZAR&from=Seabe&to=${userPhone}&date=${date}&items[0][name]=Contribution&items[0][unit_cost]=${transaction.amount}`;

                await client.messages.create({
                    from: process.env.TWILIO_PHONE_NUMBER,
                   	to: `whatsapp:${formatPhone(userPhone)}`,
                    body: `✅ *Receipt: Payment Received*\n\nRef: ${ref}\nAmount: R${transaction.amount}\n\nThank you! 🙏`,
                    mediaUrl: [ pdfUrl ]
                });
            }
        }
        res.sendStatus(200);
    } catch (e) {
        console.error("Webhook Error:", e);
        res.sendStatus(500);
    }
});;


// ==========================================
// 🚦 WHATSAPP TRAFFIC CONTROLLER (ROUTER)
// ==========================================
app.post('/whatsapp', async (req, res) => {
    app.post('/whatsapp', (req, res) => {
    const incomingMsg = req.body.Body?.trim().toLowerCase();
    const cleanPhone = req.body.From.replace('whatsapp:', '');

    // 1. Respond to Twilio IMMEDIATELY to prevent the 15s timeout
    res.type('text/xml').send('<Response></Response>');

    // 2. Handle everything else in the background
    (async () => {
        try {
            if (!userSession[cleanPhone]) userSession[cleanPhone] = {};
            const session = userSession[cleanPhone];

            // Now we do the slow database work
            const member = await prisma.member.findUnique({
                where: { phone: cleanPhone },
                include: { church: true, society: true }
            });

            // LOGIC GATE: Is it a new user or existing?
            if (!member) {
                await client.messages.create({
                    from: process.env.TWILIO_PHONE_NUMBER,
                    to: `whatsapp:${cleanPhone}`,
                    body: "👋 Welcome! It looks like you aren't registered yet. Please reply with your *Church Code* to get started."
                });
                return;
            }

            // --- [START OF BOT BRAIN] ---

// 1. Handle Global "Cancel" or "Reset"
if (incomingMsg === 'exit' || incomingMsg === 'cancel') {
    delete userSession[cleanPhone];
    await sendMessage(cleanPhone, "🔄 Session cleared. Reply *Hi* to see the main menu.");
    return;
}

// 2. Handle Burial Society Flows (If session exists)
if (session.flow === 'SOCIETY_PAYMENT' || incomingMsg === 'society') {
    return handleSocietyMessage(cleanPhone, incomingMsg, session, member);
}

// 3. Handle Church Flows (If session exists)
if (session.flow === 'CHURCH_PAYMENT' || incomingMsg === 'pay') {
    return handleChurchPayment(cleanPhone, incomingMsg, session, member);
}

// 4. Main Menu Logic (For registered members)
if (incomingMsg === 'hi' || incomingMsg === 'menu') {
    const menu = `👋 Hello, ${member.name}!\n\n` +
                 `How can I help you today?\n` +
                 `1️⃣ *Pay* (Tithe/Offering)\n` +
                 `2️⃣ *Society* (Burial Fees)\n` +
                 `3️⃣ *Balance* (Check Statements)\n` +
                 `4️⃣ *Admin* (Reports)`;
    await sendMessage(cleanPhone, menu);
    return;
}

// 5. Default Fallback
await sendMessage(cleanPhone, "🤔 I didn't quite catch that. Reply *Menu* to see available options.");

// --- [END OF BOT BRAIN] ---
            
        } catch (error) {
            console.error("⚠️ Background processing error:", error);
        }
    })();
});
	
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

// ------------------------------------------------
        // 🛠️ ADMIN TRIGGER: SECURE EMAIL REPORT
        // Usage: "Report AFM" -> Sends CSV to admin@afm.com
        // ------------------------------------------------
		if (incomingMsg.startsWith('report ')) {       // ✅ CORRECT
            const targetCode = incomingMsg.split(' ')[1]?.toUpperCase();

            if (!targetCode) {
                twiml.message("⚠️ Please specify a code. Example: *Report AFM*");
            } else {
                // 1. Fetch Org Details AND Transactions together
                const org = await prisma.church.findUnique({
                    where: { code: targetCode },
                    include: { 
                        transactions: {
                            where: { status: 'SUCCESS' },
                            orderBy: { date: 'desc' },
                            take: 100 // Last 100 transactions
                        }
                    }
                });

                if (!org) {
                    twiml.message(`🚫 Organization *${targetCode}* not found.`);
                } else if (org.transactions.length === 0) {
                    twiml.message(`📉 No transactions found for *${org.name}*.`);
                } else if (!org.email) {
                    twiml.message(`⚠️ *${org.name}* has no email address configured in the database.`);
                } else {
                    // 2. Generate CSV Content (Hidden from WhatsApp)
                    let csvContent = "Date,Phone,Type,Amount,Reference\n";
                    let total = 0;

                    org.transactions.forEach(t => {
                        const date = t.date.toISOString().split('T')[0];
                        const amount = t.amount.toFixed(2);
                        csvContent += `${date},${t.phone},${t.type},${amount},${t.reference}\n`;
                        total += t.amount;
                    });
                    
                    // Add Summary Row at bottom of CSV
                    csvContent += `\nTOTAL,,,${total.toFixed(2)},`;

                    // 3. Send Email via SendGrid
                    const msg = {
                        to: org.email, // 🔒 Sent ONLY to the registered admin email
                        from: process.env.EMAIL_FROM || 'admin@seabe.io',
                        subject: `📊 Monthly Report: ${org.name}`,
                        text: `Attached is the latest transaction report for ${org.name}.\n\nTotal Processed: R${total.toFixed(2)}`,
                        attachments: [
                            {
                                content: Buffer.from(csvContent).toString('base64'),
                                filename: `Report_${targetCode}_${new Date().toISOString().split('T')[0]}.csv`,
                                type: 'text/csv',
                                disposition: 'attachment'
                            }
                        ]
                    };

                    try {
                        await sgMail.send(msg);
                        // 4. Secure WhatsApp Reply
                        twiml.message(`✅ Report for *${org.name}* has been emailed to *${org.email}*.`);
                    } catch (error) {
                        console.error("Email Error:", error);
                        twiml.message("⚠️ Error sending email. Please check server logs.");
                    }
                }
            }
            
            res.type('text/xml').send(twiml.toString());
            return; 
        }

// ------------------------------------------------
        // 🛠️ ADMIN TRIGGER: MANUAL VERIFY
        // Usage: "Verify REF123456789"
        // ------------------------------------------------
        if (incomingMsg.startsWith('verify ')) {
            const reference = incomingMsg.split(' ')[1];

            if (!reference) {
                twiml.message("⚠️ Please specify a reference. Example: *Verify REF-123*");
            } else {
                try {
                    // 1. Ask Paystack for the status
                    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
                        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
                    });

                    const status = response.data.data.status;
                    const amount = response.data.data.amount / 100;

                    if (status === 'success') {
                        // 2. Update Database
                        await prisma.transaction.update({
                            where: { reference: reference },
                            data: { status: 'SUCCESS' }
                        });
                        twiml.message(`✅ **Verified!**\nReference: ${reference}\nAmount: R${amount}\nStatus updated to *SUCCESS*.`);
                    } else {
                        twiml.message(`❌ **Payment Failed.**\nPaystack says this transaction is still: *${status}*.`);
                    }
                } catch (error) {
                    console.error("Verify Error:", error);
                    twiml.message("⚠️ Could not verify. Check the reference number.");
                }
            }
            
            res.type('text/xml').send(twiml.toString());
            return;
        }

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
                session.churchCode = member.society.id; // For ID-based logic

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
                session.churchCode = member.church.id; // For ads

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
             session.churchCode = member.church.id;
             return handleChurchMessage(incomingMsg, cleanPhone, session, prisma, twiml, res);
        } else {
             twiml.message("👋 Welcome! Reply *Join* to start.");
             res.type('text/xml').send(twiml.toString());
        }

    } catch (e) {
        console.error("Router Error:", e);
        res.sendStatus(500);
    }
});

// --- SUCCESS PAGE ---
// Add 'async' here so we can wait for the Database/Paystack
app.get('/payment-success', async (req, res) => {
    const { reference } = req.query;
    console.log(`🔎 Verification Check: ${reference}`);

    if (!reference) {
        return res.status(400).send("Missing reference.");
    }

    try {
        const resp = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
        });

        if (resp.data.data.status === 'success') {
            const paystackData = resp.data.data;
            const meta = paystackData.metadata || {};
            const verifiedAmount = paystackData.amount / 100; 
            const phone = meta.whatsapp_number || meta.phone;

            // 1. Find the transaction
            let transaction = await prisma.transaction.findUnique({
                where: { reference: reference }
            });

            if (!transaction && phone) {
                transaction = await prisma.transaction.findFirst({
                    where: {
                        phone: phone.replace('whatsapp:', ''),
                        amount: verifiedAmount,
                        status: 'PENDING'
                    }
                });
            }

            if (transaction) {
                // 2. Update Database
                await prisma.transaction.update({
                    where: { id: transaction.id },
                    data: { status: 'SUCCESS', reference: reference }
                });




                // 3. Prepare Receipt Data
                const invoiceDate = new Date().toISOString().split('T')[0];
                const receiptBody = 
                    `📜 *OFFICIAL DIGITAL RECEIPT*\n` +
                    `--------------------------------\n` +
                    `⛪ *Organization:* AFM - Life in Christ\n` +
                    `👤 *Member:* ${transaction.phone}\n` +
                    `💰 *Amount:* R${transaction.amount}.00\n` +
                    `📅 *Date:* ${invoiceDate}\n` +
                    `🔢 *Reference:* ${reference}\n` +
                    `--------------------------------\n` +
                    `✅ *Status:* Confirmed & Recorded\n\n` +
                    `_Thank you for your faithful contribution. This message serves as your proof of payment._`;

                // 4. THE BACKGROUND BUBBLE (Async IIFE)
                // This lets us send the browser response immediately 
                // while Twilio works in the background.
                (async () => {
                    try {
                        await client.messages.create({
                            from: process.env.TWILIO_PHONE_NUMBER,
                            to: `whatsapp:${formatPhone(transaction.phone)}`,
                            body: receiptBody
                        });
                        console.log(`📡 Text receipt sent successfully to ${transaction.phone}`);
                    } catch (error) {
                        console.error("❌ Receipt Delivery Error:", error.message);
                    }
                })(); 

                // 5. IMMEDIATE RESPONSE (Beat the 15-second Render wall)
                return res.send(`<h1>✅ Payment Received</h1><p>Check WhatsApp for your receipt.</p>`);
            }
        }
        
        res.send("<h1>Processing...</h1><p>We are still verifying your payment. Check WhatsApp shortly.</p>");

    } catch (error) {
        console.error("❌ Critical Payment Success Error:", error.message);
        res.status(500).send("An error occurred during verification.");
    }
});

const PORT = process.env.PORT || 3000;

// Only start the server if we are NOT testing
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => console.log(`✅ Seabe Engine running on ${PORT}`));
}

// Export the app for testing
module.exports = app;


// Dedicated ping route to keep Render awake (Place this ABOVE app.listen)
app.get('/ping', (req, res) => {
    res.status(200).send("Heartbeat received.");
});

// --- 🚀 SERVER START ---
// We use a unique name 'serverPort' to avoid the 'PORT' conflict
const serverPort = process.env.PORT || 10000;

app.listen(serverPort, () => {
    console.log(`✅ Seabe Engine running on port ${serverPort}`);
});

// --- ☀️ KEEP-WARM HEARTBEAT ---
const SELF_URL = `https://${process.env.HOST_URL}/ping`;
setInterval(() => {
    if (process.env.HOST_URL) {
        axios.get(SELF_URL)
            .then(() => console.log("☀️ Heartbeat: Successfully pinged /ping"))
            .catch((err) => console.error("⚠️ Heartbeat: Failed", err.message));
    }
}, 600000);