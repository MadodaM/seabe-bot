// ==========================================
// SEABE PLATFORM - VERSION 3.1 (Webhooks & Profiles)
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

// 🔴 Added getTransactionHistory to imports
const { createPaymentLink, createSubscriptionLink, getTransactionHistory } = require('./services/paystack');

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
    if (ACCOUNT_SID && AUTH_TOKEN) {
        client = require('twilio')(ACCOUNT_SID, AUTH_TOKEN);
    }
} catch (e) { console.log("⚠️ Twilio Initialization Error"); }

const app = express();
const upload = multer({ dest: 'uploads/' }); 

app.use(bodyParser.urlencoded({ extended: false }));

// 🔴 FIX: Save the RAW body for Paystack Webhook verification
app.use(bodyParser.json({
    verify: (req, res, buf) => {
        req.rawBody = buf; 
    }
}));
app.use('/public', express.static(path.join(__dirname, 'public')));

// --- MEMORY ---
let userSession = {}; 

// --- HUBSPOT INTEGRATION ---
async function syncToHubSpot(data) {
    if (!process.env.HUBSPOT_TOKEN) return;
    try {
        await axios.post('https://api.hubapi.com/crm/v3/objects/contacts', {
            properties: { 
                firstname: data.name, 
                email: data.email, 
                phone: data.phone, 
                lifecyclestage: 'lead' 
            }
        }, { 
            headers: { 'Authorization': `Bearer ${process.env.HUBSPOT_TOKEN}` } 
        });
    } catch (e) { console.error("HubSpot Sync Failed"); }
}

// --- LOAD EXTERNAL ROUTES ---
require('./routes/web')(app, upload, { prisma, syncToHubSpot });
require('./routes/admin')(app, { prisma });

// --- AUTOMATED REPORTS ---
async function emailReport(churchCode) {
    const church = await prisma.church.findUnique({ where: { code: churchCode } });
    if (!church || !church.email) return `❌ Church not found or no email available.`;

    const transactions = await prisma.transaction.findMany({ 
        where: { churchCode: churchCode, status: 'SUCCESS' }, 
        orderBy: { date: 'desc' } 
    });
    
    let csvContent = "Date,Type,Amount,Reference,Phone\n"; 
    transactions.forEach(t => { 
        csvContent += `${t.date.toISOString()},${t.type},${t.amount},${t.reference},${t.phone}\n`; 
    });

    try { 
        await sgMail.send({ 
            to: church.email, 
            from: EMAIL_FROM, 
            subject: `📊 Seabe Report: ${church.name}`, 
            text: "Attached is your automated financial report.",
            attachments: [{ 
                content: Buffer.from(csvContent).toString('base64'), 
                filename: `${churchCode}_Report.csv`, 
                type: 'text/csv' 
            }] 
        }); 
        return `✅ Report sent to ${church.email}`; 
    } catch (e) { return `❌ Email failed to send.`; }
}

// Run every Monday at 8:00 AM SAST
cron.schedule('0 8 * * 1', async () => {
    const churches = await prisma.church.findMany();
    for (const church of churches) { 
        if (church.email) await emailReport(church.code); 
    }
}, { timezone: "Africa/Johannesburg" });

// --- PDF RECEIPT GENERATOR ---
function generatePDF(type, amount, ref, date, phone, churchName) {
    const doc = new PDFDocument({ size: 'A5', margin: 50 });
    const filename = `receipt_${ref}.pdf`;
    
    // 🔴 THE FIX: Ensure the folder path is absolute and exists
    const receiptsDir = path.join(__dirname, 'public', 'receipts');
    if (!fs.existsSync(receiptsDir)){
        fs.mkdirSync(receiptsDir, { recursive: true });
    }

    const filePath = path.join(receiptsDir, filename);
    const stream = fs.createWriteStream(filePath);
    
    doc.pipe(stream);
    // ... rest of your PDF drawing code (Title, Amount, Church Name) ...
    doc.fontSize(20).text('OFFICIAL RECEIPT', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Church: ${churchName}`);
    doc.text(`Amount: R${amount}`);
    doc.text(`Reference: ${ref}`);
    doc.text(`Date: ${date}`);
    doc.end();
    
    return filename;
}

// --- DYNAMIC AD ENGINE ---
async function getAdSuffix(churchCode) {
    try {
        const ad = await prisma.ad.findFirst({ 
            where: { 
                status: 'Active', 
                expiryDate: { gte: new Date() }, 
                OR: [{ target: 'Global' }, { target: churchCode }] 
            } 
        });
        if (ad) return `\n\n----------------\n💡 *Did you know?*\n${ad.text}`;
        return "";
    } catch (e) { return ""; }
}

// ==========================================
// 🛡️ WEBHOOK: PAYSTACK LISTENER
// ==========================================
app.post('/webhook/paystack', async (req, res) => {
    try {
        const hash = crypto.createHmac('sha512', PAYSTACK_SECRET).update(req.rawBody).digest('hex');
        if (hash !== req.headers['x-paystack-signature']) return res.status(400).send("Security Check Failed");

        res.sendStatus(200);
        const event = req.body;

        if (event.event === 'charge.success') {
            const ref = event.data.reference;
            const amount = event.data.amount / 100;

            const tx = await prisma.transaction.findUnique({ where: { reference: ref } });
            
            if (tx && tx.status !== 'SUCCESS') {
                await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'SUCCESS' } });
                const church = await prisma.church.findUnique({ where: { code: tx.churchCode } });
                include: { church: true } // 🔴 FIX: Get church name for the PDF
                const pdfName = generatePDF(tx.type, amount, ref, new Date().toLocaleString(), tx.phone, church.name);
                
                setTimeout(async () => {
                    if (client) {
                        const hostUrl = req.headers.host || 'seabe-bot.onrender.com';
                        await client.messages.create({ 
                            from: process.env.TWILIO_PHONE_NUMBER, // ✅ Dynamic Live Number 
                            to: `whatsapp:${tx.phone}`, 
                            body: `🎉 Payment Confirmed! Thank you for your R${amount} contribution to ${church.name}.`, 
                            mediaUrl: [`https://${hostUrl}/public/receipts/${pdfName}`] 
                        });
                    }
                }, 1500);
				// Send to WhatsApp
        await client.messages.create({
            from: process.env.TWILIO_PHONE_NUMBER, // ✅ Dynamic Live Number
            to: `whatsapp:${tx.phone}`,
            body: `✅ Payment Confirmed! Here is your receipt for ${tx.church.name}.`,
            mediaUrl: [`https://${req.headers.host}/public/receipts/${pdfName}`]
        });
            }
        }
    } catch (error) { console.error("Webhook Error:", error); }
});

// ==========================================
// 🤖 WHATSAPP BOT LOGIC
// ==========================================
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
            twiml.message(reply); 
            res.type('text/xml').send(twiml.toString()); 
            return;
        }

        if (!userSession[cleanPhone]) userSession[cleanPhone] = {};
        
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

        if (!userSession[cleanPhone].churchCode) {
            if (['hi', 'hello', 'menu', 'start'].includes(incomingMsg) || !userSession[cleanPhone]?.onboarding) {
                const churches = await prisma.church.findMany({ orderBy: { name: 'asc' } });
                let list = "Welcome to Seabe! 🇿🇦\nPlease select your church:\n";
                churches.forEach((c, index) => { list += `*${index + 1}.* ${c.name}\n`; });
                reply = list; 
                userSession[cleanPhone].onboarding = true; 
                userSession[cleanPhone].churchList = churches; 
            } else {
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
                    reply = `Welcome to *${selectedChurch.name}*! 🎉\nReply *Hi* to see your menu.`;
                } else {
                    reply = "⚠️ Invalid selection.";
                }
            }
        } 
        
        else {
            const churchCode = userSession[cleanPhone].churchCode;
            const churchName = userSession[cleanPhone].churchName;
            
            // MAIN MENU (Updated with 7 & 8)
            if (['hi', 'menu', 'hello'].includes(incomingMsg)) {
                userSession[cleanPhone].step = 'MENU';
                const adText = await getAdSuffix(churchCode);
                reply = `Welcome to *${churchName}* 👋\n\n*1.* General Offering 🎁\n*2.* Pay Tithe 🏛️\n*3.* Events & Tickets 🎟️\n*4.* Switch Church 🔄\n*5.* Monthly Partner 🔁\n*6.* Ministry News 📰\n*7.* My Profile 👤\n*8.* My History 📜` + adText;
            }
            // MY HISTORY (Option 8)
            else if (incomingMsg === '8' && userSession[cleanPhone]?.step === 'MENU') {
                const member = await prisma.member.findUnique({ where: { phone: cleanPhone } });
                const userEmail = member?.email || `${cleanPhone}@seabe.io`; 
                reply = await getTransactionHistory(userEmail);
                userSession[cleanPhone].step = 'MENU';
            }
            // MY PROFILE (Option 7)
            else if (incomingMsg === '7' && userSession[cleanPhone]?.step === 'MENU') {
                userSession[cleanPhone].step = 'UPDATE_EMAIL';
                reply = "👤 *Update Profile*\n\nPlease reply with your new *Email Address* (e.g., john@gmail.com) so we can send your tax receipts:";
            }
            // CAPTURE EMAIL FOR PROFILE
            else if (userSession[cleanPhone]?.step === 'UPDATE_EMAIL') {
                const newEmail = incomingMsg.toLowerCase();
                if (!newEmail.includes('@')) {
                    reply = "⚠️ That doesn't look like a valid email. Please try again:";
                } else {
                    await prisma.member.update({ where: { phone: cleanPhone }, data: { email: newEmail } });
                    reply = `✅ Success! Your email is now: *${newEmail}*\n\nReply *8* to see your giving history.`;
                    userSession[cleanPhone].step = 'MENU'; 
                }
            }
            // NEWS (Option 6)
            else if (incomingMsg === '6' && userSession[cleanPhone]?.step === 'MENU') {
                const news = await prisma.news.findMany({ 
                    where: { status: 'Active', expiryDate: { gte: new Date() } }, 
                    orderBy: { createdAt: 'desc' }, 
                    take: 3 
                });
                reply = news.length === 0 ? "📰 No news updates." : "*Latest Ministry News:*\n\n" + news.map(n => `📌 *${n.headline}*\n${n.body || ''}\n\n`).join('');
                userSession[cleanPhone].step = 'MENU';
            }
            // EVENTS LIST (Option 3)
            else if (incomingMsg === '3' && userSession[cleanPhone]?.step === 'MENU') {
                const events = await prisma.event.findMany({ 
                    where: { churchCode: churchCode, status: 'Active', expiryDate: { gte: new Date() } } 
                });
                if (events.length === 0) { 
                    reply = "⚠️ No active events found."; 
                    userSession[cleanPhone].step = 'MENU'; 
                } else {
                    let list = "*Select an Event:*\n"; 
                    events.forEach((e, index) => { list += `*${index + 1}.* ${e.name} (R${e.price})\n`; });
                    reply = list; 
                    userSession[cleanPhone].step = 'EVENT_SELECT'; 
                    userSession[cleanPhone].availableEvents = events; 
                }
            }
            // EVENT SELECTION
            else if (userSession[cleanPhone]?.step === 'EVENT_SELECT') {
                const index = parseInt(incomingMsg) - 1;
                const events = userSession[cleanPhone].availableEvents;
                if (events && events[index]) { 
                    userSession[cleanPhone].step = 'PAY'; 
                    userSession[cleanPhone].choice = 'EVENT'; 
                    userSession[cleanPhone].selectedEvent = events[index]; 
                    reply = `Confirm Ticket for *${events[index].name}* (R${events[index].price})?\nReply *Yes* to continue.`; 
                } else {
                    reply = "⚠️ Invalid selection.";
                }
            }
            // MONEY ENTRY PROMPT
            else if (['1', '2', '5'].includes(incomingMsg) && userSession[cleanPhone]?.step === 'MENU') {
                userSession[cleanPhone].step = 'PAY'; 
                userSession[cleanPhone].choice = incomingMsg;
                reply = incomingMsg === '5' ? "Enter Monthly Amount (e.g. R500):" : "Enter Amount (e.g. R100):";
            }
            // SWITCH CHURCH (FIXED)
else if (incomingMsg === '4' && userSession[cleanPhone]?.step === 'MENU') {
    // 🔴 FIX: Delete the user from the database so Auto-Login doesn't trap them
    await prisma.member.delete({ where: { phone: cleanPhone } });
    
    // Clear the temporary session
    delete userSession[cleanPhone]; 
    
    reply = "🔄 Church unlinked successfully!\n\nReply *Hi* to see the list of churches again.";
}
            // PAYMENT LINK GENERATION
            else if (userSession[cleanPhone]?.step === 'PAY') {
                let amount = incomingMsg.replace(/\D/g,''); 
                let type = ''; 
                
                if (userSession[cleanPhone].choice === '1') type = 'OFFERING';
                else if (userSession[cleanPhone].choice === '5') type = 'RECURRING';
                else if (userSession[cleanPhone].choice === 'EVENT') { 
                    type = 'TICKET'; 
                    const evt = userSession[cleanPhone].selectedEvent; 
                    amount = evt.price; 
                    if (!['yes', 'y', 'ok'].some(w => incomingMsg.includes(w))) { 
                        twiml.message("❌ Event Ticket Cancelled."); 
                        res.type('text/xml').send(twiml.toString()); 
                        return; 
                    } 
                } else type = 'TITHE'; 

                // 🔴 THE FINAL FIX: No Duplicate Declarations Here
                const memberInfo = await prisma.member.findUnique({ where: { phone: cleanPhone } });
                const customerEmail = memberInfo?.email || `${cleanPhone}@seabe.io`;

                const ref = `${churchCode}-${type}-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-5)}`;
                const finalSubaccount = userSession[cleanPhone].subaccount;
                
                const link = (type === 'RECURRING') 
                    ? await createSubscriptionLink(amount, ref, customerEmail, finalSubaccount) 
                    : await createPaymentLink(amount, ref, customerEmail, finalSubaccount);
                
                if (link) {
                    reply = `Tap to pay R${amount}:\n👉 ${link}`;
                    await prisma.transaction.create({ 
                        data: { 
                            churchCode, phone: cleanPhone, type, amount: parseFloat(amount), reference: ref, status: 'PENDING', date: new Date() 
                        } 
                    });
                } else {
                    reply = "⚠️ Payment link error. Please try again later.";
                }
                userSession[cleanPhone].step = 'MENU';
            } 
            else {
                reply = "I didn't understand that. Reply *Hi* for the main menu.";
            }
        }
        
        twiml.message(reply); 
        res.type('text/xml').send(twiml.toString());
        
    } catch (e) { 
        console.error(e);
        twiml.message("⚠️ System Error. We have been notified."); 
        res.type('text/xml').send(twiml.toString()); 
    }
});

// --- SUCCESS REDIRECT PAGE ---
app.get('/payment-success', (req, res) => {
    const rawNumber = process.env.TWILIO_PHONE_NUMBER || '';
    const botNumber = rawNumber.replace('whatsapp:', '').replace('+', '');
    // END OF FIX
		res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>	
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Payment Successful | Seabe</title>
            <style>
                body { font-family: 'Segoe UI', sans-serif; background: #f4f7f6; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
                .card { background: white; padding: 40px; border-radius: 15px; width: 100%; max-width: 350px; box-shadow: 0 10px 30px rgba(0,0,0,0.05); text-align: center; }
                .icon { font-size: 60px; color: #0a4d3c; margin-bottom: 10px; }
                h2 { color: #0a4d3c; margin: 0; }	
                p { color: #666; margin-top: 10px; font-size: 14px; }
                .btn { display: inline-block; margin-top: 20px; padding: 12px 24px; background: #D4AF37; color: #0a4d3c; text-decoration: none; font-weight: bold; border-radius: 6px; }
            </style>
        </head>
        <body>
            <div class="card">
                <div class="icon">✅</div>
                <h2>Payment Successful!</h2>
                <p>Thank you for your contribution. You can now close this window and return to WhatsApp for your receipt.</p>
                <a href="https://wa.me/${botNumber}?text=Hi">Back to WhatsApp</a>	
            </div>
        </body>
        </html>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Seabe Engine v3.1 running on ${PORT}`));