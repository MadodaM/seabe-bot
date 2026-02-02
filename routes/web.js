// routes/web.js
// PURPOSE: Public Website (Home, Register, Demo, Terms)
const sgMail = require('@sendgrid/mail');
const fs = require('fs');
require('dotenv').config();

const EMAIL_FROM = process.env.EMAIL_FROM;
if (process.env.SENDGRID_KEY) sgMail.setApiKey(process.env.SENDGRID_KEY);

module.exports = function(app, upload, { prisma, syncToHubSpot }) {

    // --- EMAIL HELPERS ---
    const emailStyle = "font-family: 'Segoe UI', sans-serif; color: #333; line-height: 1.6;";
    const headerStyle = "background-color: #0a4d3c; color: #ffffff; padding: 30px; text-align: center; border-bottom: 4px solid #D4AF37;";
    const btnStyle = "display: inline-block; background-color: #D4AF37; color: #0a4d3c; padding: 12px 25px; text-decoration: none; font-weight: bold; border-radius: 4px; margin-top: 20px;";

    // 1. PUBLIC HOMEPAGE
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
                    .nav-links a { color: white; text-decoration: none; font-weight: 600; margin-left: 20px; font-size: 0.9rem; }
                    .nav-links a:hover { color: var(--accent); }
                    .sign-in-btn { border: 1px solid var(--accent); padding: 8px 18px; border-radius: 5px; color: var(--accent) !important; transition:0.3s; }
                    .sign-in-btn:hover { background: var(--accent); color: var(--primary) !important; }

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
                    
                    @media(max-width: 768px) { .hero h1 { font-size: 2.5rem; } .hero { padding: 140px 0 80px; clip-path: none; } .stats-grid { flex-direction: column; gap: 30px; } .nav-links { display:none; } }
                </style>
            </head>
            <body>
                <nav>
                    <div class="container">
                        <a href="/" class="logo">SEABE<span style="color:var(--accent)">.</span></a>
                        <div class="nav-links">
                            <a href="/demo">Book Demo</a>
                            <a href="/register">Register Church</a>
                            <a href="/login" class="sign-in-btn">Sign In</a>
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

    // 2. REGISTRATION PAGES
    app.get('/register', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="viewport" content="width=device-width, initial-scale=1.0">
                <title>Register | Seabe Digital</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: #f4f7f6; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
                    .card { background: white; padding: 40px; border-radius: 15px; width: 100%; max-width: 450px; box-shadow:0 10px 30px rgba(0,0,0,0.05); }
                    h2 { color: #0a4d3c; text-align: center; margin-bottom:5px; }
                    input[type="text"], input[type="email"], input[type="file"] { width: 100%; padding: 12px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; }
                    button { width: 100%; padding: 15px; background: #0a4d3c; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; transition:0.3s; }
                    button:hover { background: #07382c; }
                    a { color: #D4AF37; text-decoration: none; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>Register Your Ministry</h2>
                    <p style="text-align:center; color:#888; margin-bottom:30px;">Complete KYC to activate automated giving.</p>
                    <form action="/register-church" method="POST" enctype="multipart/form-data">
                        <label style="font-size:12px; font-weight:bold;">Church Name</label>
                        <input type="text" name="churchName" placeholder="e.g. Grace Family Church" required>
                        <label style="font-size:12px; font-weight:bold;">Official Email</label>
                        <input type="email" name="email" placeholder="admin@church.co.za" required>
                        
                        <div style="background:#eefdf5; padding:15px; border-radius:6px; margin-bottom:20px;">
                            <strong style="color:#0a4d3c; font-size:13px;">KYC Documents:</strong><br><br>
                            <label style="font-size:12px;">1. Admin ID (PDF/JPG)</label>
                            <input type="file" name="idDoc" accept=".pdf,.jpg,.png" required style="background:white;">
                            <label style="font-size:12px;">2. Bank Letter</label>
                            <input type="file" name="bankDoc" accept=".pdf,.jpg,.png" required style="background:white;">
                        </div>
                        
                        <div style="margin-bottom:20px; font-size:13px; color:#555; display:flex; align-items:start; gap:8px;">
                            <input type="checkbox" name="tos" required style="width:auto; margin-top:3px;"> 
                            <span>I accept the <a href="/terms" target="_blank">Master Service Agreement</a>.</span>
                        </div>
                        <button type="submit">Complete Registration</button>
                    </form>
                    <p style="text-align:center; margin-top:20px;"><a href="/" style="color:#999; font-size:13px;">Cancel</a></p>
                </div>
            </body>
            </html>
        `);
    });

    app.post('/register-church', upload.fields([{ name: 'idDoc', maxCount: 1 }, { name: 'bankDoc', maxCount: 1 }]), async (req, res) => {
        const { churchName, email, tos } = req.body;
        if (!tos) return res.send("⚠️ You must accept the Master Service Agreement.");

        try {
            const attachments = []; const filePathsToDelete = [];
            const processFile = (fieldName, prefix) => {
                if (req.files[fieldName]) {
                    const f = req.files[fieldName][0];
                    attachments.push({ content: fs.readFileSync(f.path).toString('base64'), filename: `${prefix}_${churchName.replace(/[^a-zA-Z0-9]/g,'_')}_${f.originalname}`, type: f.mimetype, disposition: 'attachment' });
                    filePathsToDelete.push(f.path);
                }
            };
            processFile('idDoc', 'ID'); processFile('bankDoc', 'BANK');

            const prefix = churchName.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
            const newCode = `${prefix}${Math.floor(100 + Math.random() * 900)}`;
            
            await prisma.church.create({ data: { name: churchName, code: newCode, email: email, subaccountCode: 'PENDING_KYC', tosAcceptedAt: new Date() } });

            if (process.env.SENDGRID_KEY) {
                // Email Admin
                await sgMail.send({ to: EMAIL_FROM, from: EMAIL_FROM, subject: `📝 NEW APPLICATION: ${churchName}`, html: `<h2>New Application</h2><p>Name: ${churchName}</p><p>Email: ${email}</p>`, attachments: attachments });
                
                // Email User
                await sgMail.send({
                    to: email, from: EMAIL_FROM, subject: 'Application Received | Seabe Digital',
                    html: `
                        <div style="${emailStyle}">
                            <div style="${headerStyle}"><h1 style="margin:0;">SEABE.</h1><p>Kingdom Connectivity</p></div>
                            <div style="padding: 30px; background: #fff;">
                                <h2>Registration Received</h2>
                                <p>Thank you for registering <strong>${churchName}</strong>. Our compliance team is reviewing your documents (24-48 hours).</p>
                                <p>Once approved, you will receive your unique Church Code.</p>
                                <a href="https://seabe.co.za/terms" style="${btnStyle}">View Terms</a>
                            </div>
                        </div>`
                });
            }
            filePathsToDelete.forEach(p => { try { fs.unlinkSync(p); } catch(e){} });
            
            res.send(`<div style="font-family:sans-serif; text-align:center; padding:50px; color:#0a4d3c;"><h1>🎉 Application Received</h1><p>Confirmation sent to <strong>${email}</strong>.</p><a href="/">Return Home</a></div>`);
        } catch (e) { console.error(e); res.send("<h1>Error</h1><p>Please try again.</p>"); }
    });

    // 3. DEMO PAGE
    app.get('/demo', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="viewport" content="width=device-width, initial-scale=1.0">
                <title>Book Demo</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: #f4f7f6; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
                    .card { background: white; padding: 40px; border-radius: 15px; width: 100%; max-width: 400px; box-shadow:0 10px 30px rgba(0,0,0,0.05); }
                    h2 { color: #0a4d3c; text-align: center; }
                    input { width: 100%; padding: 12px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; }
                    button { width: 100%; padding: 15px; background: #D4AF37; color: #0a4d3c; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; transition:0.3s; }
                    button:hover { background: #b5952f; }
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
        await syncToHubSpot({ name: firstname, email: email, phone: phone });
        
        if (process.env.SENDGRID_KEY) {
            await sgMail.send({ to: EMAIL_FROM, from: EMAIL_FROM, subject: `🔥 LEAD: ${firstname}`, html: `<p>New Lead: ${firstname} (${email})</p>` });
            await sgMail.send({
                to: email, from: EMAIL_FROM, subject: 'Seabe Demo Request',
                html: `
                    <div style="${emailStyle}">
                        <div style="${headerStyle}"><h1 style="margin:0;">SEABE.</h1><p>Premium Stewardship</p></div>
                        <div style="padding: 30px; background: #fff;">
                            <h2>Hi ${firstname},</h2>
                            <p>We received your request. A manager will contact you via WhatsApp shortly.</p>
                        </div>
                    </div>`
            });
        }
        res.send(`<div style="font-family:sans-serif; text-align:center; padding:50px;"><h1 style="color:#0a4d3c;">Request Received ✅</h1><p>Check your email.</p><a href="/">Return Home</a></div>`);
    });

    // 4. TERMS
    app.get('/terms', (req, res) => {
        res.send(`<div style="font-family:sans-serif; max-width:800px; margin:auto; padding:50px; line-height:1.6;"><h1 style="color:#0a4d3c; border-bottom:2px solid #D4AF37;">Master Service Agreement</h1><p><strong>Last Updated: Feb 2026</strong></p><h3>1. Introduction</h3><p>By using Seabe Digital, you agree to these terms...</p><br><a href="/register" style="color:#0a4d3c;">&larr; Back</a></div>`);
    });

    app.post('/payment-success', (req, res) => res.send("<h1>Payment Successful! 🎉</h1>"));
};