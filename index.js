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
const { PrismaClient } = require('@prisma/client');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

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
const prisma = new PrismaClient();
const upload = multer({ dest: 'uploads/' }); 

// 🛡️ TRUST PROXY (Required for Render/Heroku)
app.set('trust proxy', 1);

if (process.env.SENDGRID_KEY) sgMail.setApiKey(process.env.SENDGRID_KEY);

// ==========================================
// 1. GLOBAL MIDDLEWARES
// ==========================================
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Required for Twilio
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