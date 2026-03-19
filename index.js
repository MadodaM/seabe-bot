// ==========================================
// SEABE PLATFORM - VERSION 4.1 (Stable)
// ==========================================
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const axios = require('axios'); 
const sgMail = require('@sendgrid/mail'); 
const prisma = require('./services/db');
const netcash = require('./services/netcash');
//const prisma = require('./services/db'); // or './services/prisma-client' depending on your setup
//const { PrismaClient } = require('@prisma/client');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { globalLimiter } = require('./middleware/rateLimiter');

// Cron Services
const { startCronJobs } = require('./services/scheduler');
const { startCourseEngine } = require('./services/courseCron');
const { startDripCampaign } = require('./services/dripCampaign');
const { startBillingEngine } = require('./services/billingCron');
const { startBatchEngine } = require('./services/batchCron');  
const { startWeeklyReportEngine } = require('./services/weeklyReportCron');

// Route Imports
const blastEngineRoute = require('./routes/blastEngine');
const webhooksRoute = require('./routes/webhooks');
const crmClaimsRoute = require('./routes/crmClaims');
const ficaPortalRoutes = require('./routes/ficaPortal');
const mandatesRouter = require('./routes/mandates');
const webhookRouter = require('./routes/webhooks'); // Yes, this is duplicated in imports but used differently below

const app = express();
app.use(globalLimiter); 

// Route to serve the Credit Passport UI for testing
app.get('/passport-test', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'credit-passport.html'));
});
app.use('/', require('./routes/checkout'));
//const prisma = new PrismaClient();
const upload = multer({ dest: 'uploads/' }); 

// 🛡️ TRUST PROXY (Required for Render/Heroku)
app.set('trust proxy', 1);

if (process.env.SENDGRID_KEY) sgMail.setApiKey(process.env.SENDGRID_KEY);

// ==========================================
// 1. GLOBAL MIDDLEWARES
// ==========================================
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Required for Twilio and Netcash ITN form data
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Raw Body for specific webhooks (if needed)
app.use(bodyParser.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

// Rate Limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Increased limit so you don't block yourself
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// ==========================================
// 2. HELPER FUNCTIONS
// ==========================================
// We need this because web.js expects it
const syncToHubSpot = async (data) => {
    // Placeholder for HubSpot Logic
    if(process.env.NODE_ENV === 'development') console.log("📝 HubSpot Sync:", data);
};

// ==========================================
// 3. MOUNT ROUTES
// ==========================================

// A. Special Routes (No Auth / Webhooks)
app.use('/api/fica', ficaPortalRoutes);
app.use('/mandate', mandatesRouter);
app.use(webhookRouter); // Netcash Webhooks
app.get('/ping', (req, res) => res.status(200).send("Heartbeat received. Seabe Engine is awake."));

// B. Static Legal Pages
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/legal', (req, res) => res.sendFile(path.join(__dirname, 'public', 'legal.html')));

// C. MAIN SYSTEM MODULES
// We wrap these in try/catch so one module crash doesn't kill the server,
// BUT we log the error loudly so you know if it failed.

// 1. Platform (Internal)
try { 
    require('./routes/platform')(app, { prisma }); 
} catch (e) { console.error("⚠️ Platform routes failed:", e.message); }

// 2. Admin Dashboard
try { 
    require('./routes/admin')(app, { prisma }); 
} catch (e) { console.error("⚠️ Admin routes failed:", e.message); }

// 3. PUBLIC WEBSITE (The one giving you 404)
try { 
    // We must pass syncToHubSpot here
    require('./routes/web')(app, upload, { prisma, syncToHubSpot }); 
    console.log("✅ Web Routes Loaded (Home, Register, Pay)");
} catch (e) { 
    console.error("❌ CRITICAL: Web routes failed to load!");
    console.error(e); // This will show you exactly why it failed
}
try { 
    require('./routes/adminPricing')(app, { prisma }); 
    console.log("✅ Pricing Dashboard Loaded");
} catch (e) { console.error("⚠️ Pricing routes failed:", e.message); }

// D. API & WhatsApp
app.use('/api/whatsapp', require('./routes/whatsappRouter'));
app.use('/api/public', require('./routes/quoteGenerator')); 

// E. Legacy / Specific Features
try { app.use('/kyc', require('./routes/kyc').router); } catch(e){}
try { app.use('/api/surepol', require('./routes/surepol')); } catch(e){}
try { app.use('/api/prospect', require('./routes/prospectKYC')); } catch(e){}
try { require('./routes/link')(app, { prisma }); } catch (e) {}
try { require('./routes/collectionbot')(app, { prisma }); } catch (e) {}

// F. Catch-Alls (Must be last)
app.use('/', blastEngineRoute);
app.use('/', webhooksRoute);
app.use('/', crmClaimsRoute);
try { app.use('/', require('./routes/paymentRoutes')); } catch(e){}

// ============================================================
// 🔒 SECURE AES-256 PAYMENT ROUTER (NETCASH)
// ============================================================
    app.get('/secure-pay/:token', async (req, res) => {
        try {
            const { decryptReference, generateAutoPostForm } = require('./services/netcash');
            
            // 1. Decrypt the military-grade token
            const reference = decryptReference(req.params.token);
            if (!reference) {
                return res.status(400).send("<h1>Link Expired or Invalid</h1><p>Please request a new payment link via WhatsApp.</p>");
            }

            // 2. Fetch the Ledger Record
            const transaction = await prisma.transaction.findUnique({
                where: { reference: reference },
                include: { church: true, member: true }
            });

            if (!transaction) return res.status(404).send("Transaction not found in ledger.");
            
            // Prevent double payments
            if (transaction.status === 'SUCCESS') {
                return res.send("<h1>Payment Already Received</h1><p>This transaction has already been settled successfully.</p>");
            }

            // 3. 🏷️ DYNAMIC BRANDING & DESCRIPTION
            const churchName = transaction.church ? transaction.church.name : 'Seabe Digital';
            
            // Format the type cleanly (e.g., converts "DEBIT_ORDER" to "DEBIT ORDER", or "TITHE" to "TITHE")
            const txType = transaction.type ? transaction.type.replace(/_/g, ' ') : 'Payment';
            
            const userEmail = transaction.member ? transaction.member.email : '';

            // 4. Build the payload for Netcash
            const txData = {
                reference: transaction.reference,
                amount: transaction.amount,
                // ✨ THE MAGIC: Passes "Org Name - Type" (e.g., "Grace Community - TITHE") to Netcash p3
                description: `${churchName} - ${txType}`, 
                phone: transaction.phone || '',
                email: userEmail || ''
            };

            // 5. Generate and send the Auto-Post loading screen
            const html = generateAutoPostForm(txData);
            res.send(html);

        } catch (error) {
            console.error("Secure Link Error:", error);
            res.status(500).send("Secure link generation failed.");
        }
    });
	
// ============================================================
    // 🌐 USER BROWSER REDIRECTS (From Netcash back to Seabe)
    // ============================================================

    // 1. When the user completes payment successfully
    app.all('/api/netcash/success', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Payment Successful</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #f8fafc; text-align: center; padding: 20px; }
                    .card { background: white; padding: 40px 20px; border-radius: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); max-width: 400px; width: 100%; border: 1px solid #e2e8f0; }
                    .icon { font-size: 64px; margin-bottom: 20px; }
                    h1 { color: #0f172a; margin: 0 0 10px 0; font-size: 24px; font-weight: 800; }
                    p { color: #64748b; margin: 0 0 30px 0; line-height: 1.5; }
                    .btn { background: #14b8a6; color: white; text-decoration: none; padding: 14px 24px; border-radius: 12px; font-weight: bold; display: inline-block; width: 80%; box-sizing: border-box; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="icon">✅</div>
                    <h1>Payment Successful!</h1>
                    <p>Thank you. Your transaction has been securely processed. Your receipt has been sent via WhatsApp.</p>
                    <a href="https://wa.me/27100000000" class="btn">Return to WhatsApp</a>
                </div>
            </body>
            </html>
        `);
    });

    // 2. When the user cancels or the card declines
    app.all('/api/netcash/decline', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Payment Cancelled</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #f8fafc; text-align: center; padding: 20px; }
                    .card { background: white; padding: 40px 20px; border-radius: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); max-width: 400px; width: 100%; border: 1px solid #e2e8f0; }
                    .icon { font-size: 64px; margin-bottom: 20px; }
                    h1 { color: #0f172a; margin: 0 0 10px 0; font-size: 24px; font-weight: 800; }
                    p { color: #64748b; margin: 0 0 30px 0; line-height: 1.5; }
                    .btn { background: #64748b; color: white; text-decoration: none; padding: 14px 24px; border-radius: 12px; font-weight: bold; display: inline-block; width: 80%; box-sizing: border-box; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="icon">⚠️</div>
                    <h1>Payment Incomplete</h1>
                    <p>Your transaction was cancelled or declined. No funds were deducted from your account.</p>
                    <a href="https://wa.me/27872657872" class="btn">Return to WhatsApp</a>
                </div>
            </body>
            </html>
        `);
    });	

// ==========================================
// 4. CRON & SERVER INIT
// ==========================================
const PORT = process.env.PORT || 10000;

if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        console.log(`✅ Seabe Engine running securely on port ${PORT}`);
        try {
            startCronJobs(); 
            startDripCampaign();
            startBillingEngine();
            startWeeklyReportEngine();
            startBatchEngine();
            startCourseEngine();
            console.log(`✅ Cron Jobs scheduled.`);          
        } catch (e) {
            console.log("⚠️ Scheduler module failed to start.");
        }
    });
}

// Keep-Warm
if (process.env.HOST_URL) {
    const SELF_URL = `https://${process.env.HOST_URL}/ping`;
    setInterval(() => { axios.get(SELF_URL).catch(() => {}); }, 600000);
}

module.exports = app;