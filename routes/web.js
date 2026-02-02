// routes/web.js
// VERSION: 2.2 (Premium African Tech + HubSpot + PostgreSQL)
// STRATEGY: "No Apps to Download" | Emerald Green & Gold Theme

const sgMail = require('@sendgrid/mail');
const fs = require('fs');
require('dotenv').config();

const EMAIL_FROM = process.env.EMAIL_FROM;
if (process.env.SENDGRID_KEY) sgMail.setApiKey(process.env.SENDGRID_KEY);

module.exports = function(app, upload, { prisma, syncToHubSpot }) {

    // ==========================================
    // 1. PREMIUM HOMEPAGE (The "Hook")
    // ==========================================
    app.get('/', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Seabe | The Operating System for African Ministries</title>
                <style>
                    :root { 
                        --primary: #0a4d3c; /* Deep Emerald Green */
                        --accent: #D4AF37; /* African Gold */
                        --text: #1a1a1a;
                        --light: #f4f7f6;
                        --white: #ffffff;
                    }
                    body { font-family: 'Inter', system-ui, -apple-system, sans-serif; margin: 0; padding: 0; color: var(--text); background: var(--white); line-height: 1.6; }
                    
                    /* UTILITIES */
                    .container { max-width: 1200px; margin: 0 auto; padding: 0 20px; }
                    .btn { display: inline-block; padding: 16px 32px; border-radius: 8px; font-weight: 600; text-decoration: none; transition: all 0.3s ease; font-size: 1.1rem; cursor: pointer; border: none; }
                    .btn-gold { background: var(--accent); color: var(--primary); }
                    .btn-gold:hover { background: #b5952f; transform: translateY(-2px); box-shadow: 0 10px 20px rgba(212, 175, 55, 0.3); }
                    .btn-outline { border: 2px solid var(--white); color: var(--white); margin-left: 10px; background: transparent; }
                    .btn-outline:hover { background: rgba(255,255,255,0.1); }
                    .text-gold { color: var(--accent); }

                    /* NAV */
                    nav { padding: 25px 0; position: absolute; width: 100%; top: 0; z-index: 10; }
                    nav .container { display: flex; justify-content: space-between; align-items: center; }
                    .logo { font-size: 1.8rem; font-weight: 900; color: var(--white); text-decoration: none; letter-spacing: -1px; }
                    
                    /* HERO */
                    .hero { 
                        background: linear-gradient(170deg, #05281e 0%, #0a4d3c 60%, #0d5e49 100%);
                        color: var(--white); padding: 180px 0 120px; text-align: center; clip-path: polygon(0 0, 100% 0, 100% 90%, 0 100%);
                    }
                    .hero h1 { font-size: 3.8rem; line-height: 1.1; font-weight: 800; margin-bottom: 20px; letter-spacing: -1px; }
                    .hero p { font-size: 1.4rem; opacity: 0.9; max-width: 700px; margin: 0 auto 40px; font-weight: 300; }

                    /* STATS BAR */
                    .stats-bar { padding: 60px 0; border-bottom: 1px solid #eee; margin-top: -50px; position: relative; z-index: 5; }
                    .stats-grid { display: flex; justify-content: space-around; flex-wrap: wrap; text-align: center; background: white; max-width: 900px; margin: auto; padding: 40px; border-radius: 15px; box-shadow: 0 20px 40px rgba(0,0,0,0.05); }
                    .stat h4 { font-size: 2.5rem; color: var(--primary); margin: 0; font-weight: 800; }
                    .stat p { color: #666; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px; margin-top: 5px; font-weight: 600; }

                    /* FEATURES */
                    .section { padding: 100px 0; }
                    .grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 40px; }
                    .feature-card { padding: 40px; border-radius: 20px; background: var(--white); border: 1px solid #f0f0f0; transition: 0.3s; }
                    .feature-card:hover { transform: translateY(-5px); box-shadow: 0 20px 40px rgba(0,0,0,0.08); border-color: var(--accent); }
                    .icon-box { width: 60px; height: 60px; background: #eefdf5; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 25px; color: var(--primary); }

                    /* FOOTER */
                    footer { background: #05281e; color: #888; padding: 80px 0 40px; }
                    footer h4 { color: white; margin-bottom: 20px; }
                    footer a { display: block; color: #888; text-decoration: none; margin-bottom: 10px; transition: 0.2s; }
                    footer a:hover { color: var(--accent); }

                    /* RESPONSIVE */
                    @media(max-width: 768px) {
                        .hero h1 { font-size: 2.5rem; }
                        .hero { padding: 140px 0 80px; clip-path: none; }
                        .stats-grid { flex-direction: column; gap: 30px; }
                        .btn { display: block; width: 100%; margin: 10px 0; box-sizing: border-box; }
                    }
                </style>
            </head>
            <body>

                <nav>
                    <div class="container">
                        <a href="/" class="logo">SEABE<span class="text-gold">.</span></a>
                        <div style="display:none; @media(min-width:768px){display:block;}">
                            <a href="/demo" style="color:white; text-decoration:none; font-weight:600; margin-right:20px;">Book Demo</a>
                            <a href="/register" style="color:var(--accent); text-decoration:none; font-weight:600;">Client Login</a>
                        </div>
                    </div>
                </nav>

                <header class="hero">
                    <div class="container">
                        <h1>Digital Stewardship for<br>the <span class="text-gold">African Church</span></h1>
                        <p>No apps to download. No data friction. Just automated giving, compliance, and communication via WhatsApp.</p>
                        <br>
                        <a href="/register" class="btn btn-gold">Register Your Church</a>
                        <a href="/demo" class="btn btn-outline">Request a Demo</a>
                    </div>
                </header>

                <div class="stats-bar">
                    <div class="container stats-grid">
                        <div class="stat"><h4>100%</h4><p>WhatsApp Native</p></div>
                        <div class="stat"><h4>Auto</h4><p>PDF Receipts</p></div>
                        <div class="stat"><h4>Zero</h4><p>Admin Headache</p></div>
                    </div>
                </div>

                <section class="section">
                    <div class="container">
                        <div class="grid-3">
                            <div class="feature-card">
                                <div class="icon-box">📱</div>
                                <h3>Mobile-First Design</h3>
                                <p>Africa lives on WhatsApp. We bring your ministry tools to the platform your members already use 50 times a day.</p>
                            </div>
                            <div class="feature-card">
                                <div class="icon-box">💳</div>
                                <h3>Seamless Payments</h3>
                                <p>Accept Tithes, Offerings, and Building Funds instantly via Paystack. Secure, local, and incredibly fast.</p>
                            </div>
                            <div class="feature-card">
                                <div class="icon-box">⚖️</div>
                                <h3>Automated Compliance</h3>
                                <p>We auto-generate financial reports and tax certificates, keeping your ministry compliant without the paperwork.</p>
                            </div>
                        </div>
                    </div>
                </section>

                <footer>
                    <div class="container" style="display:grid; gap:40px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
                        <div>
                            <h4 style="color:var(--accent)">SEABE.</h4>
                            <p>Empowering the African Church with premium digital tools for growth and governance.</p>
                        </div>
                        <div>
                            <h4>Platform</h4>
                            <a href="/register">Register Church</a>
                            <a href="/demo">Book Demo</a>
                        </div>
                        <div>
                            <h4>Legal</h4>
                            <a href="/terms">Terms of Service</a>
                            <a href="#">Privacy Policy</a>
                        </div>
                        <div>
                            <h4>Contact</h4>
                            <a href="mailto:hello@seabe.co.za">hello@seabe.co.za</a>
                            <p>Johannesburg, SA</p>
                        </div>
                    </div>
                </footer>

            </body>
            </html>
        `);
    });

    // ==========================================
    // 2. REGISTER CHURCH (Self-Service + KYC + DB Log)
    // ==========================================
    app.get('/register', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="viewport" content="width=device-width, initial-scale=1.0">
                <title>Register | Seabe Digital</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: #f4f7f6; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
                    .card { background: white; padding: 40px; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.05); width: 100%; max-width: 450px; }
                    h2 { color: #0a4d3c; text-align: center; margin-bottom: 10px; }
                    p { text-align: center; color: #666; margin-bottom: 30px; font-size: 0.9rem; }
                    input[type="text"], input[type="email"], input[type="file"] { width: 100%; padding: 12px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; }
                    button { width: 100%; padding: 15px; background: #0a4d3c; color: white; border: none; border-radius: 6px; font-weight: bold; font-size: 16px; cursor: pointer; transition: 0.2s; }
                    button:hover { background: #07382c; }
                    .tos-box { background: #eefdf5; padding: 15px; border-radius: 6px; margin-bottom: 20px; font-size: 13px; color: #0a4d3c; }
                    a { color: #D4AF37; text-decoration: none; font-weight: 600; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>Register Your Ministry</h2>
                    <p>Complete the KYC steps below to activate your automated stewardship platform.</p>
                    
                    <form action="/register-church" method="POST" enctype="multipart/form-data">
                        <label style="font-size:12px; font-weight:bold; color:#333;">Church Name</label>
                        <input type="text" name="churchName" placeholder="e.g. Grace Family Church" required>
                        
                        <label style="font-size:12px; font-weight:bold; color:#333;">Official Email</label>
                        <input type="email" name="email" placeholder="admin@church.co.za" required>
                        
                        <div class="tos-box">
                            <strong>KYC Documents Required:</strong><br><br>
                            <label>1. Admin ID Document (PDF/JPG)</label>
                            <input type="file" name="idDoc" accept=".pdf,.jpg,.png" required style="background:white; margin-top:5px;">
                            
                            <label>2. Bank Confirmation Letter</label>
                            <input type="file" name="bankDoc" accept=".pdf,.jpg,.png" required style="background:white; margin-top:5px;">
                        </div>
                        
                        <div style="display:flex; align-items:start; gap:10px; margin-bottom:20px; font-size:13px; color:#555;">
                            <input type="checkbox" name="tos" required style="margin-top:3px;"> 
                            <span>I have authority to bind this organization and I accept the <a href="/terms" target="_blank">Master Service Agreement</a>.</span>
                        </div>
                        
                        <button type="submit">Complete Registration</button>
                    </form>
                    
                    <div style="text-align: center; margin-top: 20px;">
                        <a href="/" style="color: #999; font-size: 13px;">Cancel and Return Home</a>
                    </div>
                </div>
            </body>
            </html>
        `);
    });

    app.post('/register-church', upload.fields([{ name: 'idDoc', maxCount: 1 }, { name: 'bankDoc', maxCount: 1 }]), async (req, res) => {
        const { churchName, email, tos } = req.body;
        
        // 1. Strict TOS Check
        if (!tos) return res.send("⚠️ Legal Error: You must accept the Master Service Agreement.");

        try {
            // 2. Handle KYC Files (Read -> Attach -> Delete)
            const attachments = [];
            const filePathsToDelete = [];
            
            const processFile = (fieldName, prefix) => {
                if (req.files[fieldName]) {
                    const f = req.files[fieldName][0];
                    // Read file to buffer for SendGrid
                    attachments.push({
                        content: fs.readFileSync(f.path).toString('base64'),
                        filename: `${prefix}_${churchName.replace(/[^a-zA-Z0-9]/g,'_')}_${f.originalname}`,
                        type: f.mimetype,
                        disposition: 'attachment'
                    });
                    filePathsToDelete.push(f.path);
                }
            };
            
            processFile('idDoc', 'ID');
            processFile('bankDoc', 'BANK');

            // 3. Database: Log Church + TOS Timestamp (PostgreSQL)
            const prefix = churchName.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
            const newCode = `${prefix}${Math.floor(100 + Math.random() * 900)}`;

            await prisma.church.create({
                data: {
                    name: churchName,
                    code: newCode,
                    email: email,
                    subaccountCode: 'PENDING_KYC', // Default status
                    tosAcceptedAt: new Date() // ✅ LOGGED: Exact time of tick
                }
            });

            // 4. Email Admin (The "Human" Review Step)
            if (process.env.SENDGRID_KEY) {
                await sgMail.send({
                    to: EMAIL_FROM,
                    from: EMAIL_FROM,
                    subject: `📝 NEW APPLICATION: ${churchName}`,
                    html: `
                        <h2>New Ministry Registration</h2>
                        <p><strong>Name:</strong> ${churchName}</p>
                        <p><strong>Code:</strong> ${newCode}</p>
                        <p><strong>Email:</strong> ${email}</p>
                        <p><strong>TOS Accepted:</strong> ${new Date().toISOString()}</p>
                        <hr>
                        <p>KYC Documents are attached for compliance review.</p>
                    `,
                    attachments: attachments
                });
            }

            // 5. Cleanup Temp Files
            filePathsToDelete.forEach(p => { try { fs.unlinkSync(p); } catch(e){} });

            // 6. Success Response
            res.send(`
                <div style="font-family:sans-serif; text-align:center; padding:50px; color:#0a4d3c;">
                    <h1 style="font-size:50px;">🎉</h1>
                    <h1>Application Received</h1>
                    <p>Thank you for registering <strong>${churchName}</strong>.</p>
                    <p>Your unique Church Code is <strong>${newCode}</strong>.</p>
                    <p>Our compliance team will review your documents and activate your account within 24 hours.</p>
                    <br><br>
                    <a href="/" style="color:#D4AF37; text-decoration:none; font-weight:bold;">Return to Home</a>
                </div>
            `);

        } catch (e) {
            console.error("Registration Error:", e);
            res.send("<h1>System Error</h1><p>We could not process your registration. Please try again.</p>");
        }
    });

    // ==========================================
    // 3. REQUEST A DEMO (HubSpot Sync)
    // ==========================================
    app.get('/demo', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="viewport" content="width=device-width, initial-scale=1.0">
                <title>Book Demo | Seabe Digital</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: #f4f7f6; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
                    .card { background: white; padding: 40px; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); width: 100%; max-width: 400px; }
                    h2 { color: #0a4d3c; text-align: center; }
                    p { text-align: center; color: #666; margin-bottom: 30px; }
                    input { width: 100%; padding: 12px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; }
                    button { width: 100%; padding: 15px; background: #D4AF37; color: #0a4d3c; border: none; border-radius: 6px; font-weight: bold; font-size: 16px; cursor: pointer; }
                    button:hover { background: #b5952f; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>Schedule a Demo</h2>
                    <p>See how Seabe can automate your ministry.</p>
                    <form action="/request-demo" method="POST">
                        <input name="firstname" placeholder="Your Name" required>
                        <input name="email" placeholder="Email Address" required type="email">
                        <input name="phone" placeholder="WhatsApp Number" required>
                        <button type="submit">Request Demo</button>
                    </form>
                    <p style="text-align: center; margin-top: 20px;"><a href="/" style="color: #999; text-decoration: none; font-size: 13px;">&larr; Return Home</a></p>
                </div>
            </body>
            </html>
        `);
    });

    app.post('/request-demo', upload.none(), async (req, res) => {
        const { firstname, email, phone } = req.body;
        
        // 1. HubSpot Sync (Adds as LEAD / Status OPEN)
        await syncToHubSpot({ 
            name: firstname, 
            email: email, 
            phone: phone 
        });

        // 2. Notify Admin via Email
        if (process.env.SENDGRID_KEY) {
            await sgMail.send({
                to: EMAIL_FROM,
                from: EMAIL_FROM,
                subject: `🔥 HOT LEAD: ${firstname}`,
                html: `<p><strong>New Demo Request</strong></p><p>Name: ${firstname}</p><p>Email: ${email}</p><p>Phone: ${phone}</p><p><em>Synced to HubSpot</em></p>`
            });
        }
        
        res.send(`
            <div style="font-family:sans-serif; text-align:center; padding:50px;">
                <h1 style="color:#0a4d3c;">Request Received ✅</h1>
                <p>Thanks ${firstname}! Our team will contact you on WhatsApp shortly.</p>
                <a href="/" style="color:#D4AF37; text-decoration:none; font-weight:bold;">Return Home</a>
            </div>
        `);
    });

    // ==========================================
    // 4. TERMS OF SERVICE (Legal)
    // ==========================================
    app.get('/terms', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Master Service Agreement | Seabe Digital</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; line-height: 1.8; color: #333; background: #f9f9f9; margin: 0; padding: 40px; }
                    .container { max-width: 800px; margin: auto; background: white; padding: 60px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
                    h1 { color: #0a4d3c; border-bottom: 2px solid #D4AF37; padding-bottom: 10px; }
                    h2 { color: #0a4d3c; margin-top: 40px; font-size: 1.2rem; }
                    a { color: #0a4d3c; font-weight: bold; text-decoration: none; }
                </style>
            </head>
            <body>
                <div class="container">
                    <a href="/register">&larr; Back to Registration</a>
                    <h1>Master Service Agreement</h1>
                    <p><em>Last Updated: February 2, 2026</em></p>

                    <p>Welcome to Seabe Digital. By registering your organization, you agree to the following terms:</p>

                    <h2>1. Platform Usage</h2>
                    <p>Seabe provides a digital interface for donations and communication. We are a technical service provider, not a bank.</p>

                    <h2>2. KYC & Compliance</h2>
                    <p>You agree to provide accurate KYC documentation (ID, Bank Letter) as required by South African FICA laws. False information will result in immediate termination.</p>

                    <h2>3. Fees & Payments</h2>
                    <p>Transactions are processed via Paystack. Platform fees are deducted automatically at the time of transaction.</p>

                    <h2>4. Data Protection (POPIA)</h2>
                    <p>We process member data solely for the purpose of facilitating transactions and receipts. We do not sell data to third parties.</p>

                    <br>
                    <p><strong>Seabe Digital (Pty) Ltd</strong><br>Johannesburg, South Africa</p>
                </div>
            </body>
            </html>
        `);
    });

    // Payment Success Page (Kept simple)
    app.post('/payment-success', (req, res) => {
        res.send("<h1>Payment Successful! 🎉</h1><p>You may close this window and return to WhatsApp.</p>");
    });
};