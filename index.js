// ==========================================
// SEABE PLATFORM - VERSION 4.0 (Modular Router)
// ==========================================
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const axios = require('axios'); 
const sgMail = require('@sendgrid/mail'); 
const { PrismaClient } = require('@prisma/client');
const { startCronJobs } = require('./services/scheduler');
const { startDripCampaign } = require('./services/dripCampaign');
const { startBillingEngine } = require('./services/billingCron');
const { startWeeklyReportEngine } = require('./services/weeklyReportCron');
const blastEngineRoute = require('./routes/blastEngine');
const webhooksRoute = require('./routes/webhooks');
const crmClaimsRoute = require('./routes/crmClaims');
const ficaPortalRoutes = require('./routes/ficaPortal');


const app = express();
const prisma = new PrismaClient();
const upload = multer({ dest: 'uploads/' }); 

if (process.env.SENDGRID_KEY) sgMail.setApiKey(process.env.SENDGRID_KEY);

// ==========================================
// 1. GLOBAL MIDDLEWARES
// ==========================================
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true })); // Required for Twilio Webhooks
app.use(bodyParser.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/api/fica', ficaPortalRoutes);

// Dedicated ping route to keep Render awake
app.get('/ping', (req, res) => res.status(200).send("Heartbeat received. Seabe Engine is awake."));

// ==========================================
// 2. STATIC LEGAL PAGES
// ==========================================
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/legal', (req, res) => res.sendFile(path.join(__dirname, 'public', 'legal.html')));

// ==========================================
// 3. MOUNT DEDICATED ROUTERS (ORDER MATTERS)
// ==========================================

// 🚀 1. SPECIFIC SYSTEM MODULES FIRST
try { require('./routes/platform')(app, { prisma }); } catch (e) { console.error("⚠️ Platform routes error:", e); }
try { require('./routes/admin')(app, { prisma }); } catch (e) { console.error("⚠️ Client Admin routes error:", e); }
try { require('./routes/web')(app, upload, { prisma }); } catch (e) { console.error("⚠️ Web routes error:", e); }

// 📱 2. API & WHATSAPP ENDPOINTS
app.use('/api/whatsapp', require('./routes/whatsappRouter'));
app.use('/api/public', require('./routes/quoteGenerator')); 
try { app.use('/kyc', require('./routes/kyc').router); } catch(e){}
try { app.use('/api/surepol', require('./routes/surepol')); } catch(e){}
try { app.use('/api/prospect', require('./routes/prospectKYC')); } catch(e){}

// ⚓ 3. GENERIC ROOT ('/') CATCH-ALLS LAST
app.use('/', blastEngineRoute);
app.use('/', webhooksRoute);
app.use('/', crmClaimsRoute);
try { app.use('/', require('./routes/paymentRoutes')); } catch(e){}



// 🛠️ 4. DIRECT INJECT FILES (Fixed Syntax)
try { require('./routes/link')(app, { prisma }); } catch (e) { console.error("⚠️ Link routes error:", e); }
try { require('./routes/collectionbot')(app, { prisma }); } catch (e) { console.error("⚠️ Collection routes error:", e); }
try { require('./routes/collections')(app); } catch (e) { console.error("⚠️ Old Collection routes error:", e); }

// ==========================================
// 4. CRON & SERVER INIT
// ==========================================
const PORT = process.env.PORT || 10000;

// Only start the server if we are NOT running test scripts
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        console.log(`✅ Seabe Engine running securely on port ${PORT}`);
        try {
            startCronJobs(); 
            startDripCampaign(); // Turn on the LMS Heartbeat
			startBillingEngine();
			startWeeklyReportEngine();
            console.log(`✅ Automated Cron Jobs scheduled.`);			
        } catch (e) {
            console.log("⚠️ Scheduler module failed to start.");
        }
    });
}

// --- ☀️ KEEP-WARM HEARTBEAT ---
if (process.env.HOST_URL) {
    const SELF_URL = `https://${process.env.HOST_URL}/ping`;
    setInterval(() => {
        axios.get(SELF_URL).catch(() => {});
    }, 600000); // 10 minutes
}

module.exports = app;