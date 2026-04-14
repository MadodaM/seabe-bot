// ==========================================
// SEABE PLATFORM - VERSION 4.1 (Stable)
// ==========================================
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const axios = require('axios'); 
const { Resend } = require('resend');
const prisma = require('./services/db');
const netcash = require('./services/netcash');
const cookieParser = require('cookie-parser');
const { globalLimiter } = require('./middleware/rateLimiter');

// Cron Services
const { startCronJobs } = require('./services/scheduler');
const { startCourseEngine } = require('./services/courseCron');
const { startDripCampaign } = require('./services/dripCampaign');
const { startBillingEngine } = require('./services/billingCron');
const { startBatchEngine } = require('./services/batchCron');  
const { startWeeklyReportEngine } = require('./services/weeklyReportCron');
const { runEngagementMonitor } = require('./jobs/engagementMonitor');
const cron = require('node-cron');
const { runArrearsChaser } = require('./jobs/arrearsChaser');

// Route Imports
const blastEngineRoute = require('./routes/blastEngine');
const webhooksRoute = require('./routes/webhooks');
const crmClaimsRoute = require('./routes/crmClaims');
const ficaPortalRoutes = require('./routes/ficaPortal');
const mandatesRouter = require('./routes/mandates');
const metaRouter = require('./routes/metaRouter');

const app = express();

// 🛡️ SECURITY & ENGINE CONFIG
app.use(globalLimiter); 
app.set('trust proxy', 1);
app.set('view engine', 'ejs'); 
app.set('views', path.join(__dirname, 'views'));

const resend = new Resend(process.env.RESEND_API_KEY || 're_test_fallback_123456789');

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

// ==========================================
// 2. HELPER FUNCTIONS
// ==========================================
const syncToHubSpot = async (data) => {
    if(process.env.NODE_ENV === 'development') console.log("📝 HubSpot Sync:", data);
};


// ==========================================
// 3. MOUNT ROUTES
// ==========================================

// A. Public & Static
app.get('/ping', (req, res) => res.status(200).send("Heartbeat received. Seabe Engine is awake."));
app.use('/meta-webhook', metaRouter);
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/legal', (req, res) => res.sendFile(path.join(__dirname, 'public', 'legal.html')));
app.get('/passport-test', (req, res) => res.sendFile(path.join(__dirname, 'views', 'credit-passport.html')));
app.get('/lwazi', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'lwazi.html'));
});

// B. Core System Modules
app.use('/', require('./routes/checkout'));
app.use('/api/fica', ficaPortalRoutes);
app.use('/mandate', mandatesRouter);
app.use(require('./routes/webhooks')); // Netcash ITN

// C. Dynamic Modules (Platform, Admin, etc.)
try { require('./routes/platform')(app, { prisma }); } catch (e) { console.error("⚠️ Platform routes failed:", e.message); }
try { require('./routes/admin')(app, { prisma }); } catch (e) { console.error("⚠️ Admin routes failed:", e.message); }
try { 
    require('./routes/web')(app, upload, { prisma, syncToHubSpot }); 
    console.log("✅ Web Routes Loaded");
} catch (e) { console.error("❌ CRITICAL: Web routes failed!", e.message); }

try { 
    require('./routes/adminPricing')(app, { prisma }); 
    console.log("✅ Pricing Dashboard Loaded");
} catch (e) { console.error("⚠️ Pricing routes failed:", e.message); }

// D. API & WhatsApp
app.use('/api/whatsapp', require('./routes/whatsappRouter'));
app.use('/api/public', require('./routes/quoteGenerator')); 

// E. Feature Specific Routes
try { app.use('/kyc', require('./routes/kyc').router); } catch(e){}
try { app.use('/api/surepol', require('./routes/surepol')); } catch(e){}
try { app.use('/api/prospect', require('./routes/prospectKYC')); } catch(e){}
try { require('./routes/link')(app, { prisma }); } catch (e) {}
try { require('./routes/collectionbot')(app, { prisma }); } catch (e) {}

// F. SEABE PAY LANDING PAGE (New)
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
        res.status(500).send("Something went wrong.");
    }
});

// G. SECURE PAYMENT ROUTER (NETCASH)
app.get('/secure-pay/:token', async (req, res) => {
    try {
        const { decryptReference, generateAutoPostForm } = require('./services/netcash');
        const reference = decryptReference(req.params.token);
        if (!reference) return res.status(400).send("<h1>Link Expired or Invalid</h1>");

        const transaction = await prisma.transaction.findUnique({
            where: { reference: reference },
            include: { church: true, member: true }
        });

        if (!transaction || transaction.status === 'SUCCESS') return res.status(400).send("Transaction invalid or already paid.");

        const txData = {
            reference: transaction.reference,
            amount: transaction.amount,
            description: `${transaction.church ? transaction.church.name : 'Seabe Digital'} - ${transaction.type}`, 
            phone: transaction.phone || '',
            email: transaction.member ? transaction.member.email : ''
        };

        res.send(generateAutoPostForm(txData));
    } catch (error) {
        res.status(500).send("Secure link failed.");
    }
});

app.all('/api/netcash/success', (req, res) => res.send(`<html><body style="text-align:center;padding:50px;"><h1>✅ Payment Successful!</h1></body></html>`));
app.all('/api/netcash/decline', (req, res) => res.send(`<html><body style="text-align:center;padding:50px;"><h1>⚠️ Payment Incomplete</h1></body></html>`));

// H. Catch-Alls
app.use('/', blastEngineRoute);
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
            console.log(`✅ All ${6} Cron Jobs scheduled.`);          
        } catch (e) {
            console.log("⚠️ Scheduler module failed to start.");
        }
    });
}

// Run Arrears Chaser every morning at 09:00 AM
if (process.env.NODE_ENV !== 'test') {
    cron.schedule('0 9 * * *', () => {
        runArrearsChaser();
    });
}	

// Keep-Warm
if (process.env.HOST_URL) {
    setInterval(() => { axios.get(`https://${process.env.HOST_URL}/ping`).catch(() => {}); }, 600000);
}

module.exports = app;