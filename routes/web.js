// routes/web.js
// VERSION: 2.3 (User Confirmation Emails)
// FEATURES: HubSpot Sync, PostgreSQL Logging, Paystack, SendGrid User Confirmations

const sgMail = require('@sendgrid/mail');
const fs = require('fs');
require('dotenv').config();

const EMAIL_FROM = process.env.EMAIL_FROM;
if (process.env.SENDGRID_KEY) sgMail.setApiKey(process.env.SENDGRID_KEY);

module.exports = function(app, upload, { prisma, syncToHubSpot }) {

    // --- HELPER: COMMON EMAIL STYLE ---
    const emailStyle = `
        font-family: 'Segoe UI', sans-serif; color: #333; line-height: 1.6;
    `;
    const headerStyle = `
        background-color: #0a4d3c; color: #ffffff; padding: 30px; text-align: center; border-bottom: 4px solid #D4AF37;
    `;
    const btnStyle = `
        display: inline-block; background-color: #D4AF37; color: #0a4d3c; padding: 12px 25px; text-decoration: none; font-weight: bold; border-radius: 4px; margin-top: 20px;
    `;

    // ==========================================
    // 1. PREMIUM HOMEPAGE
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
                    :root { --primary: #0a4d3c; --accent: #D4AF37; --text: #1a1a1a; --white: #ffffff; }
                    body { font-family: 'Inter', system-ui, sans-serif; margin: 0; color: var(--text); background: var(--white); line-height: 1.6; }
                    .container { max-width: 1200px; margin: 0 auto; padding: 0 20px; }
                    .btn { display: inline-block; padding: 16px 32px; border-radius: 8px; font-weight: 600; text-decoration: none; transition: 0.3s; cursor: pointer; border: none; }
                    .btn-gold { background: var(--accent); color: var(--primary); }
                    .btn-gold:hover { background: #b5952f; transform: translateY(-2px); }
                    .btn-outline { border: 2px solid var(--white); color: var(--white); margin-left: 10px; background: transparent; }
                    .btn-outline:hover { background: rgba(255,255,255,0.1); }
                    nav { padding: 25px 0; position: absolute; width: 100%; top: 0; z-index: 10; }
                    nav .container { display: flex; justify-content: space-between; align-items: center; }
                    .logo { font-size: 1.8rem; font-weight: 900; color: var(--white); text-decoration: none; }
                    .hero { background: linear-gradient(170deg, #05281e 0%, #0a4d3c 60%, #0d5e49 100%); color: var(--white); padding: 180px 0 120px; text-align: center; clip-path: polygon(0 0, 100% 0, 100% 90%, 0 100%); }
                    .hero h1 { font-size: 3.8rem; line-height: 1.1; font-weight: 800; margin-bottom: 20px; }
                    .hero p { font-size: 1.4rem; opacity: 0.9; max-width: 700px; margin: 0 auto 40px; }
                    .stats-bar { padding: 60px 0; margin-top: -50px; position: relative; z-index: 5; }
                    .stats-grid { display: flex; justify-content: space-around; flex-wrap: wrap; text-align: center; background: white; max-width: 900px; margin: auto; padding: 40px; border-radius: 15px; box-shadow: 0 20px 40px rgba(0,0,0,0.05); }
                    .stat h4 { font-size: 2.5rem; color: var(--primary); margin: 0; font-weight: 800; }
                    .stat p { color: #666; font-size: 0.9rem; text-transform: uppercase; font-weight: 600; }
                    .section { padding: 100px 0; }
                    .grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 40px; }
                    .feature-card { padding: 40px; border-radius: 20px; background: var(--white); border: 1px solid #f0f0f0; transition: 0.3s; }
                    .feature-card:hover { transform: translateY(-5px); box-shadow: 0 20px 40px rgba(0,0,0,0.08); border-color: var(--accent); }
                    .icon-box { width: 60px; height: 60px; background: #eefdf5; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 25px; color: var(--primary); }
                    footer { background: #05281e; color: #888; padding: 80px 0 40px; }
                    footer h4 { color: white; margin-bottom: 20px; }
                    footer a { display: block; color: #888; text-decoration: none; margin-bottom: 10px; }
                    footer a:hover { color: var(--accent); }
                    @media(max-width: 768px) { .hero h1 { font-size: 2.5rem; } .hero { padding: 140px 0 80px; clip-path: none; } .stats-grid { flex-direction: column; gap: 30px; } }
                </style>
            </head>
            <body>
                <nav>
                    <div class="container">
                        <a href="/" class="logo">SEABE<span style="color:var(--accent)">.</span></a>
                        <div style="display:none; @media(min-width:768px){display:block;}">
                            <a href="/demo" style="color:white; text-decoration:none; font-weight:600; margin-right:20px;">Book Demo</a>
                            <a href="/register" style="color:var(--accent); text-decoration:none; font-weight:600;">Client Login</a>
                        </div>
                    </div>
                </nav>
                <header class="hero">
                    <div class="container">
                        <h1>Digital Stewardship for<br>the <span style="color:var(--accent)">African Church</span></h1>
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
                        <div><h4 style="color:var(--accent)">SEABE.</h4><p>Empowering the African Church.</p></div>
                        <div><h4>Platform</h4><a href="/register">Register</a><a href="/demo">Book Demo</a></div>
                        <div><h4>Legal</h4><a href="/terms">Terms of Service</a><a href="#">Privacy</a></div>
                        <div><h4>Contact</h4><a href="mailto:hello@seabe.co.za">hello@seabe.co.za</a></div>
                    </div>
                </footer>
            </body>
            </html>
        `);
    });

    // ==========================================
    // 2. REGISTER CHURCH (Logic + User Email)
    // ==========================================
    app.get('/register', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="viewport" content="width=device-width, initial-scale=1.0">
                <title>Register | Seabe Digital</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: #f4f7f6; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
                    .card { background: white; padding: 40px; border-radius: 15px; width: 100%; max-width: 450px; }
                    h2 { color: #0a4d3c; text-align: center; }
                    input[type="text"], input[type="email"], input[type="file"] { width: 100%; padding: 12px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; }
                    button { width: 100%; padding: 15px; background: #0a4d3c; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; }
                    a { color: #D4AF37; text-decoration: none; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>Register Your Ministry</h2>
                    <form action="/register-church" method="POST" enctype="multipart/form-data">
                        <label>Church Name</label><input type="text" name="churchName" placeholder="e.g. Grace Family Church" required>
                        <label>Official Email</label><input type="email" name="email" placeholder="admin@church.co.za" required>
                        <div style="background:#eefdf5; padding:15px; border-radius:6px; margin-bottom:20px;">
                            <strong>KYC Documents:</strong><br><br>
                            <label>Admin ID (PDF/JPG)</label><input type="file" name="idDoc" accept=".pdf,.jpg,.png" required>
                            <label>Bank Letter</label><input type="file" name="bankDoc" accept=".pdf,.jpg,.png" required>
                        </div>
                        <div style="margin-bottom:20px; font-size:13px;"><input type="checkbox" name="tos" required> I accept the <a href="/terms" target="_blank">Master Service Agreement</a>.</div>
                        <button type="submit">Complete Registration</button>
                    </form>
                    <p style="text-align:center; margin-top:20px;"><a href="/" style="color:#999;">Cancel</a></p>
                </div>
            </body>
            </html>
        `);
    });

    app.post('/register-church', upload.fields([{ name: 'idDoc', maxCount: 1 }, { name: 'bankDoc', maxCount: 1 }]), async (req, res) => {
        const { churchName, email, tos } = req.body;
        if (!tos) return res.send("⚠️ You must accept the Master Service Agreement.");

        try {
            // Process Files
            const attachments = []; const filePathsToDelete = [];
            const processFile = (fieldName, prefix) => {
                if (req.files[fieldName]) {
                    const f = req.files[fieldName][0];
                    attachments.push({ content: fs.readFileSync(f.path).toString('base64'), filename: `${prefix}_${churchName.replace(/[^a-zA-Z0-9]/g,'_')}_${f.originalname}`, type: f.mimetype, disposition: 'attachment' });
                    filePathsToDelete.push(f.path);
                }
            };
            processFile('idDoc', 'ID'); processFile('bankDoc', 'BANK');

            // Save to DB
            const prefix = churchName.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
            const newCode = `${prefix}${Math.floor(100 + Math.random() * 900)}`;
            
            await prisma.church.create({
                data: {
                    name: churchName, code: newCode, email: email, subaccountCode: 'PENDING_KYC', tosAcceptedAt: new Date()
                }
            });

            // --- 1. EMAIL TO ADMIN (You) ---
            if (process.env.SENDGRID_KEY) {
                await sgMail.send({
                    to: EMAIL_FROM, from: EMAIL_FROM,
                    subject: `📝 NEW APPLICATION: ${churchName}`,
                    html: `<h2>New Application</h2><p>Name: ${churchName}</p><p>Email: ${email}</p><p>Status: KYC Attached</p>`,
                    attachments: attachments
                });

                // --- 2. EMAIL TO USER (Confirmation) ---
                await sgMail.send({
                    to: email, 
                    from: EMAIL_FROM,
                    subject: 'Application Received | Seabe Digital',
                    html: `
                        <div style="${emailStyle}">
                            <div style="${headerStyle}">
                                <h1 style="margin:0;">SEABE.</h1>
                                <p>Kingdom Connectivity</p>
                            </div>
                            <div style="padding: 30px; background: #fff;">
                                <h2>Registration Received</h2>
                                <p>Dear Admin,</p>
                                <p>Thank you for registering <strong>${churchName}</strong> with Seabe Digital. We have successfully received your application and KYC documents.</p>
                                
                                <h3 style="color: #0a4d3c; border-bottom: 2px solid #eee; padding-bottom: 10px;">What Happens Next?</h3>
                                <ul>
                                    <li><strong>Review:</strong> Our compliance team is reviewing your documents (ID & Bank Letter).</li>
                                    <li><strong>Duration:</strong> This typically takes <strong>24-48 hours</strong>.</li>
                                    <li><strong>Activation:</strong> Once approved, you will receive your unique "Church Code" and WhatsApp Link.</li>
                                </ul>

                                <h3 style="color: #0a4d3c; border-bottom: 2px solid #eee; padding-bottom: 10px;">Your Premium Benefits</h3>
                                <ul>
                                    <li>✅ <strong>Zero Friction:</strong> Members give via WhatsApp.</li>
                                    <li>✅ <strong>Automated Receipts:</strong> PDF tax receipts sent instantly.</li>
                                    <li>✅ <strong>Weekly Reconciliation:</strong> Automated spreadsheets every Monday.</li>
                                </ul>

                                <div style="background: #f9f9f9; padding: 15px; border-radius: 5px; margin-top: 20px;">
                                    <strong>Terms of Service Reference:</strong><br>
                                    <p style="font-size: 13px; color: #666;">By submitting your application, you have agreed to the Seabe Master Service Agreement. Key points include: Seabe acts as a technical intermediary; Transaction fees apply per Paystack's schedule; Data is processed per POPIA compliance.</p>
                                    <a href="https://seabe.co.za/terms" style="color: #0a4d3c; font-weight: bold;">Read Full Terms Online</a>
                                </div>
                                
                                <p style="margin-top:30px;">Blessings,<br>The Seabe Team</p>
                            </div>
                            <div style="text-align: center; padding: 20px; color: #888; font-size: 12px;">
                                &copy; 2026 Seabe Digital. Johannesburg, South Africa.
                            </div>
                        </div>
                    `
                });
            }

            filePathsToDelete.forEach(p => { try { fs.unlinkSync(p); } catch(e){} });

            res.send(`
                <div style="font-family:sans-serif; text-align:center; padding:50px; color:#0a4d3c;">
                    <h1 style="font-size:50px;">🎉</h1>
                    <h1>Application Received</h1>
                    <p>Thank you! We have sent a confirmation email to <strong>${email}</strong>.</p>
                    <p>Our team will review your KYC documents shortly.</p>
                    <a href="/" style="color:#D4AF37; text-decoration:none; font-weight:bold;">Return Home</a>
                </div>
            `);
        } catch (e) { console.error(e); res.send("<h1>Error</h1><p>Please try again later.</p>"); }
    });

    // ==========================================
    // 3. REQUEST DEMO (HubSpot + User Email)
    // ==========================================
    app.get('/demo', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="viewport" content="width=device-width, initial-scale=1.0">
                <title>Book Demo</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: #f4f7f6; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
                    .card { background: white; padding: 40px; border-radius: 15px; width: 100%; max-width: 400px; }
                    h2 { color: #0a4d3c; text-align: center; }
                    input { width: 100%; padding: 12px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; }
                    button { width: 100%; padding: 15px; background: #D4AF37; color: #0a4d3c; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>Schedule a Demo</h2>
                    <p style="text-align:center; color:#666;">See how Seabe can transform your ministry.</p>
                    <form action="/request-demo" method="POST">
                        <input name="firstname" placeholder="Your Name" required>
                        <input name="email" placeholder="Email Address" required type="email">
                        <input name="phone" placeholder="WhatsApp Number" required>
                        <button type="submit">Request Demo</button>
                    </form>
                    <p style="text-align:center;"><a href="/" style="color:#999; text-decoration:none;">Back</a></p>
                </div>
            </body>
            </html>
        `);
    });

    app.post('/request-demo', upload.none(), async (req, res) => {
        const { firstname, email, phone } = req.body;
        
        // 1. HubSpot Sync
        await syncToHubSpot({ name: firstname, email: email, phone: phone });

        // 2. Email Admin
        if (process.env.SENDGRID_KEY) {
            await sgMail.send({
                to: EMAIL_FROM, from: EMAIL_FROM, subject: `🔥 LEAD: ${firstname}`,
                html: `<p>New Lead: ${firstname} (${email})</p>`
            });

            // 3. Email User (The Sell)
            await sgMail.send({
                to: email,
                from: EMAIL_FROM,
                subject: 'Seabe Demo Request | We will be in touch!',
                html: `
                    <div style="${emailStyle}">
                        <div style="${headerStyle}">
                            <h1 style="margin:0;">SEABE.</h1>
                            <p>Premium Digital Stewardship</p>
                        </div>
                        <div style="padding: 30px; background: #fff;">
                            <h2>Hi ${firstname},</h2>
                            <p>Thank you for your interest in Seabe Digital. We have received your request for a demo.</p>
                            <p>One of our Relationship Managers will contact you shortly via <strong>WhatsApp</strong> at ${phone} to schedule a walkthrough.</p>
                            
                            <h3 style="color: #0a4d3c; margin-top: 30px;">Why Churches Choose Seabe?</h3>
                            <div style="display:flex; gap:15px; margin-bottom:15px;">
                                <span style="font-size:20px;">📱</span>
                                <div><strong>No Apps to Download:</strong><br>We operate entirely inside WhatsApp, ensuring 100% adoption from day one.</div>
                            </div>
                            <div style="display:flex; gap:15px; margin-bottom:15px;">
                                <span style="font-size:20px;">🔒</span>
                                <div><strong>Trust & Compliance:</strong><br>We handle the heavy lifting of PDF receipts and FICA compliance for you.</div>
                            </div>
                            <div style="display:flex; gap:15px; margin-bottom:15px;">
                                <span style="font-size:20px;">🌍</span>
                                <div><strong>Built for Africa:</strong><br>Optimized for low-data environments and local payment methods (EFT/Card).</div>
                            </div>

                            <a href="https://seabe.co.za" style="${btnStyle}">Visit Our Website</a>
                        </div>
                         <div style="text-align: center; padding: 20px; color: #888; font-size: 12px;">
                            &copy; 2026 Seabe Digital. Johannesburg, South Africa.
                        </div>
                    </div>
                `
            });
        }
        
        res.send(`
            <div style="font-family:sans-serif; text-align:center; padding:50px;">
                <h1 style="color:#0a4d3c;">Request Received ✅</h1>
                <p>We've sent a confirmation email to <strong>${email}</strong>.</p>
                <p>Expect a WhatsApp message from us shortly.</p>
                <a href="/" style="color:#D4AF37; font-weight:bold; text-decoration:none;">Return Home</a>
            </div>
        `);
    });

    // 4. TERMS PAGE
    app.get('/terms', (req, res) => {
        res.send(`
            <div style="font-family:sans-serif; max-width:800px; margin:auto; padding:50px; line-height:1.6;">
                <h1 style="color:#0a4d3c; border-bottom:2px solid #D4AF37;">Master Service Agreement</h1>
                <p><strong>Last Updated: Feb 2026</strong></p>
                <h3>1. Introduction</h3>
                <p>Welcome to Seabe Digital. By using our services, you agree to be bound by these terms...</p>
                <h3>2. Compliance</h3>
                <p>You agree to provide accurate KYC data...</p>
                <h3>3. Fees</h3>
                <p>Transaction fees apply via Paystack...</p>
                <br><a href="/register" style="color:#0a4d3c; font-weight:bold;">&larr; Back to Registration</a>
            </div>
        `);
    });

    app.post('/payment-success', (req, res) => res.send("<h1>Payment Successful! 🎉</h1>"));
};