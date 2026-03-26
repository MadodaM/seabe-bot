// ==========================================
// SEABE PLATFORM - VERSION 4.1 (Stable)
// ==========================================
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const axios = require('axios'); 
const prisma = require('./services/db');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');// ==========================================
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
const webhookRouter = require('./routes/webhooks');

const app = express();
app.use(globalLimiter); 

// 🛡️ TRUST PROXY (Required for Render/Heroku)
app.set('trust proxy', 1);

// 🛠️ SET VIEW ENGINE (Crucial for rendering .ejs files!)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

if (process.env.SENDGRID_KEY) sgMail.setApiKey(process.env.SENDGRID_KEY);

const upload = multer({ dest: 'uploads/' }); 

// ==========================================
// 1. GLOBAL MIDDLEWARES
// ==========================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

// Rate Limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 300, 
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// ==========================================
// 2. HELPER FUNCTIONS
// ==========================================
const syncToHubSpot = async (data) => {
    if(process.env.NODE_ENV === 'development') console.log("📝 HubSpot Sync:", data);
};

// ==========================================
// 3. MOUNT ROUTES
// ==========================================

// Route to serve the Credit Passport UI for testing
app.get('/passport-test', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'credit-passport.html'));
});
app.use('/', require('./routes/checkout'));

app.use('/api/fica', ficaPortalRoutes);
app.use('/mandate', mandatesRouter);
app.use(webhookRouter); 
app.get('/ping', (req, res) => res.status(200).send("Heartbeat received. Seabe Engine is awake."));

app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/legal', (req, res) => res.sendFile(path.join(__dirname, 'public', 'legal.html')));

try { require('./routes/platform')(app, { prisma }); } catch (e) { console.error("⚠️ Platform routes failed:", e.message); }
try { require('./routes/admin')(app, { prisma }); } catch (e) { console.error("⚠️ Admin routes failed:", e.message); }

try { 
    require('./routes/web')(app, upload, { prisma, syncToHubSpot }); 
    console.log("✅ Web Routes Loaded");
} catch (e) { console.error("❌ CRITICAL: Web routes failed!", e); }

try { 
    require('./routes/adminPricing')(app, { prisma }); 
    console.log("✅ Pricing Dashboard Loaded");
} catch (e) { console.error("⚠️ Pricing routes failed:", e.message); }

app.use('/api/whatsapp', require('./routes/whatsappRouter'));
app.use('/api/public', require('./routes/quoteGenerator')); 

try { app.use('/kyc', require('./routes/kyc').router); } catch(e){}
try { app.use('/api/surepol', require('./routes/surepol')); } catch(e){}
try { app.use('/api/prospect', require('./routes/prospectKYC')); } catch(e){}
try { require('./routes/link')(app, { prisma }); } catch (e) {}
try { require('./routes/collectionbot')(app, { prisma }); } catch (e) {}

// ==========================================
// 🚀 SEABE PAY LANDING PAGE ROUTES
// ==========================================
app.get('/seabe-pay', (req, res) => {
    res.render('seabe-pay'); 
});

app.post('/api/demo-request', async (req, res) => {
    const { fullName, shopName, businessType, teamSize, whatsappNumber } = req.body;
    try {
        console.log(`🚀 New Seabe Pay Lead: ${shopName} (${fullName})`);
        res.send(`
            <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                <h1 style="color: #2563EB;">Request Received!</h1>
                <p>Thank you, ${fullName}. Our team will contact you on WhatsApp shortly.</p>
                <br>
                <a href="/seabe-pay" style="color: #4B5563; text-decoration: underline;">Return to home</a>
            </div>
        `);
    } catch (error) {
        console.error("Lead capture error:", error);
        res.status(500).send("Something went wrong. Please try again.");
    }
});

// ============================================================
// 🔒 SECURE AES-256 PAYMENT ROUTER (NETCASH)
// ============================================================
app.get('/secure-pay/:token', async (req, res) => {
    try {
        const { decryptReference, generateAutoPostForm } = require('./services/netcash');
        const reference = decryptReference(req.params.token);
        if (!reference) return res.status(400).send("<h1>Link Expired or Invalid</h1>");

        const transaction = await prisma.transaction.findUnique({
            where: { reference: reference },
            include: { church: true, member: true }
        });

        if (!transaction) return res.status(404).send("Transaction not found in ledger.");
        if (transaction.status === 'SUCCESS') return res.send("<h1>Payment Already Received</h1>");

        const churchName = transaction.church ? transaction.church.name : 'Seabe Digital';
        const txType = transaction.type ? transaction.type.replace(/_/g, ' ') : 'Payment';
        const userEmail = transaction.member ? transaction.member.email : '';

        const txData = {
            reference: transaction.reference,
            amount: transaction.amount,
            description: `${churchName} - ${txType}`, 
            phone: transaction.phone || '',
            email: userEmail || ''
        };

        const html = generateAutoPostForm(txData);
        res.send(html);
    } catch (error) {
        console.error("Secure Link Error:", error);
        res.status(500).send("Secure link generation failed.");
    }
});
    
app.all('/api/netcash/success', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Payment Successful</title></head><body style="font-family: sans-serif; text-align: center; padding: 50px;"><h1>✅ Payment Successful!</h1><p>Your receipt has been sent via WhatsApp.</p></body></html>`);
});

app.all('/api/netcash/decline', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Payment Cancelled</title></head><body style="font-family: sans-serif; text-align: center; padding: 50px;"><h1>⚠️ Payment Incomplete</h1><p>Your transaction was cancelled or declined.</p></body></html>`);
}); 

// F. Catch-Alls (Must be last so they don't block seabe-pay!)
app.use('/', blastEngineRoute);
app.use('/', webhooksRoute);
app.use('/', crmClaimsRoute);
try { app.use('/', require('./routes/paymentRoutes')); } catch(e){}

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
const { globalLimiter } = require('./middleware/rateLimiter');

// Cron Services
const { startCronJobs } = require('./services/scheduler');
const { startCourseEngine } = require('./services/courseCron');
const { startDripCampaign } = require('./services/dripCampaign');
const { startBillingEngine } = require('./services/billingCron');
const { startBatchEngine } = require('./services/batchCron');  
const { startWeeklyReportEngine } = require('./services/weeklyReportCron');

const app = express();
app.use(globalLimiter); 
app.set('trust proxy', 1);
app.set('view engine', 'ejs'); // 🛠️ EJS Engine initialized
app.set('views', path.join(__dirname, 'views'));

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

// Helper
const syncToHubSpot = async (data) => { if(process.env.NODE_ENV === 'development') console.log("📝 HubSpot Sync:", data); };

// ==========================================
// 🚀 MOUNT ROUTES
// ==========================================
app.use('/', require('./routes/checkout'));
app.use('/api/fica', require('./routes/ficaPortal'));
app.use('/mandate', require('./routes/mandates'));
app.use(require('./routes/webhooks')); 
app.get('/ping', (req, res) => res.status(200).send("Heartbeat received. Seabe Engine is awake."));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));

try { require('./routes/platform')(app, { prisma }); } catch (e) {}
try { require('./routes/admin')(app, { prisma }); } catch (e) {}
try { require('./routes/web')(app, multer({ dest: 'uploads/' }), { prisma, syncToHubSpot }); } catch (e) {}
try { require('./routes/adminPricing')(app, { prisma }); } catch (e) {}

app.use('/api/whatsapp', require('./routes/whatsappRouter'));
app.use('/api/public', require('./routes/quoteGenerator')); 

// ✂️ THE MAGIC: 100 lines of Seabe Pay logic reduced to one line!
app.use('/seabe-pay', require('./routes/seabePay'));

// Legacy Catch-Alls
try { app.use('/kyc', require('./routes/kyc').router); } catch(e){}
app.use('/', require('./routes/blastEngine'));
app.use('/', require('./routes/crmClaims'));

// ==========================================
// ⚙️ SERVER INIT & CRON
// ==========================================
const PORT = process.env.PORT || 10000;
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        console.log(`✅ Seabe Engine running securely on port ${PORT}`);
        try {
            startCronJobs(); startDripCampaign(); startBillingEngine();
            startWeeklyReportEngine(); startBatchEngine(); startCourseEngine();       
        } catch (e) { console.log("⚠️ Scheduler module failed to start."); }
    });
}

if (process.env.HOST_URL) {
    setInterval(() => { axios.get(`https://${process.env.HOST_URL}/ping`).catch(() => {}); }, 600000);
}

module.exports = app;