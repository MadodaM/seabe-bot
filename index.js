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
             twiml.message("👋 Welcome! Reply *Hi* to start.");
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
    const { reference } = req.query; // 👈 Capture the reference from Paystack
    console.log(`🔎 User returned with Ref: ${reference}`);

    if (reference) {
        try {
            // 1. Double-check with Paystack immediately
            const resp = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
                headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
            });

            // 2. If Paystack says it's good, update the DB right now
            if (resp.data.data.status === 'success') {
                await prisma.transaction.updateMany({
                    where: { reference: reference },
                    data: { status: 'SUCCESS' } // 👈 Ensure this matches your DB casing
                });
                console.log(`✅ DB Synced instantly for ${reference}`);
            }
        } catch (e) {
            // If this fails, it's okay—the Webhook is our backup safety net
            console.log("⏳ Verification skipped, waiting for webhook.");
        }
    }

    // 3. NOW send the HTML you wrote
    res.send(`
        <html>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body { font-family: sans-serif; text-align: center; padding: 50px; background: #f4f7f6; }
                    .card { background: white; padding: 40px; border-radius: 15px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); max-width: 400px; margin: auto; }
                    .btn { background: #25D366; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; margin-top: 20px; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h1>✅ Payment Successful</h1>
                    <p>Thank you! Your transaction has been recorded.</p>
                    <br>
                    <a href="https://wa.me/${process.env.TWILIO_PHONE_NUMBER ? process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '') : ''}?text=Hi" class="btn">Return to WhatsApp</a>
                </div>
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