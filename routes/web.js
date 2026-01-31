// routes/web.js
// VERSION: 2.0 (Premium African Tech Brand)
const sgMail = require('@sendgrid/mail');
const fs = require('fs');
require('dotenv').config();

const EMAIL_FROM = process.env.EMAIL_FROM;
if (process.env.SENDGRID_KEY) sgMail.setApiKey(process.env.SENDGRID_KEY);

module.exports = function(app, upload, { getDoc, refreshCache, syncToHubSpot }) {

    // ==========================================
    // 1. PREMIUM MARKETING HOMEPAGE 🌍
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
                        --primary: #0a4d3c; /* Deep Forest Green */
                        --accent: #D4AF37; /* African Gold */
                        --text: #1a1a1a;
                        --light: #f4f7f6;
                        --white: #ffffff;
                    }
                    body { font-family: 'Inter', system-ui, -apple-system, sans-serif; margin: 0; padding: 0; color: var(--text); background: var(--white); line-height: 1.6; }
                    
                    /* TYPOGRAPHY */
                    h1, h2, h3 { font-weight: 800; letter-spacing: -0.5px; margin-top: 0; }
                    h1 { font-size: 3.5rem; line-height: 1.1; }
                    h2 { font-size: 2.5rem; }
                    
                    /* UTILITIES */
                    .container { max-width: 1200px; margin: 0 auto; padding: 0 20px; }
                    .btn { display: inline-block; padding: 16px 32px; border-radius: 8px; font-weight: 600; text-decoration: none; transition: all 0.3s ease; font-size: 1.1rem; }
                    .btn-gold { background: var(--accent); color: var(--primary); }
                    .btn-gold:hover { background: #b5952f; transform: translateY(-2px); }
                    .btn-outline { border: 2px solid var(--white); color: var(--white); margin-left: 10px; }
                    .btn-outline:hover { background: rgba(255,255,255,0.1); }
                    .text-gold { color: var(--accent); }

                    /* NAV */
                    nav { padding: 20px 0; position: absolute; width: 100%; top: 0; z-index: 10; }
                    nav .container { display: flex; justify-content: space-between; align-items: center; }
                    .logo { font-size: 1.5rem; font-weight: 900; color: var(--white); text-decoration: none; }
                    
                    /* HERO */
                    .hero { 
                        background: linear-gradient(rgba(10, 77, 60, 0.95), rgba(5, 40, 30, 0.98)), url('https://images.unsplash.com/photo-1543269865-cbf427effbad?q=80&w=2070&auto=format&fit=crop');
                        background-size: cover; background-position: center;
                        color: var(--white); padding: 180px 0 120px; text-align: center;
                    }
                    .hero p { font-size: 1.35rem; opacity: 0.9; max-width: 700px; margin: 20px auto 40px; }

                    /* STATS BAR */
                    .stats-bar { background: var(--light); padding: 40px 0; border-bottom: 1px solid #eee; }
                    .stats-grid { display: flex; justify-content: space-around; flex-wrap: wrap; text-align: center; }
                    .stat h4 { font-size: 2.5rem; color: var(--primary); margin: 0; }
                    .stat p { color: #666; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px; margin-top: 5px; }

                    /* FEATURES */
                    .section { padding: 100px 0; }
                    .grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 40px; }
                    .feature-card { padding: 40px; border-radius: 20px; background: var(--white); border: 1px solid #eee; transition: 0.3s; }
                    .feature-card:hover { box-shadow: 0 20px 40px rgba(0,0,0,0.05); border-color: var(--accent); }
                    .icon-box { width: 60px; height: 60px; background: var(--light); border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 25px; color: var(--primary); }

                    /* COMPARISON */
                    .comparison { background: var(--primary); color: var(--white); }
                    .comparison-table { width: 100%; border-collapse: collapse; margin-top: 40px; }
                    .comparison-table th, .comparison-table td { padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: left; }
                    .check { color: var(--accent); }
                    .cross { color: #ff6b6b; }

                    /* FOOTER */
                    footer { background: #05281e; color: #888; padding: 80px 0 40px; }
                    .footer-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 40px; margin-bottom: 60px; }
                    .footer-col h4 { color: var(--white); margin-bottom: 20px; }
                    .footer-col a { display: block; color: #888; text-decoration: none; margin-bottom: 10px; transition: 0.2s; }
                    .footer-col a:hover { color: var(--accent); }

                    /* MOBILE */
                    @media(max-width: 768px) {
                        h1 { font-size: 2.5rem; }
                        .hero { padding: 140px 0 80px; }
                        .btn { display: block; margin: 10px 0; width: 100%; box-sizing: border-box; }
                    }
                </style>
            </head>
            <body>

                <nav>
                    <div class="container">
                        <a href="/" class="logo">SEABE<span class="text-gold">.</span></a>
                    </div>
                </nav>

                <header class="hero">
                    <div class="container">
                        <h1>Digital Stewardship for<br>the <span class="text-gold">African Church</span></h1>
                        <p>Increase generosity, automate compliance, and engage your congregation on the platform they already use every day: WhatsApp.</p>
                        <br>
                        <a href="/register" class="btn btn-gold">Get Started</a>
                        <a href="/demo" class="btn btn-outline">Book a Demo</a>
                    </div>
                </header>

                <div class="stats-bar">
                    <div class="container stats-grid">
                        <div class="stat"><h4>100%</h4><p>WhatsApp Based</p></div>
                        <div class="stat"><h4>15sec</h4><p>To Give</p></div>
                        <div class="stat"><h4>Auto</h4><p>Receipts & Reports</p></div>
                    </div>
                </div>

                <section class="section">
                    <div class="container">
                        <div style="text-align: center; max-width: 700px; margin: 0 auto 60px;">
                            <h2 style="color: var(--primary);">Why Leading Ministries Choose Seabe</h2>
                            <p style="font-size: 1.1rem; color: #666;">Legacy apps are built for the West. Seabe is built for Africa. No downloads, no data usage issues, just seamless connectivity.</p>
                        </div>
                        <div class="grid-3">
                            <div class="feature-card">
                                <div class="icon-box">📱</div>
                                <h3>No App to Download</h3>
                                <p>78% of church members refuse to download new apps. Seabe lives inside WhatsApp, ensuring 100% adoption from day one.</p>
                            </div>
                            <div class="feature-card">
                                <div class="icon-box">💳</div>
                                <h3>Smart Payments</h3>
                                <p>Accept Tithes, Offerings, and Building Projects via Card or EFT. Funds settle directly into your church bank account via Paystack.</p>
                            </div>
                            <div class="feature-card">
                                <div class="icon-box">🧾</div>
                                <h3>Automated Compliance</h3>
                                <p>We automatically generate PDF receipts for every transaction and email weekly financial spreadsheets to your treasury team.</p>
                            </div>
                        </div>
                    </div>
                </section>

                <section class="section comparison">
                    <div class="container">
                        <h2>The Premium Advantage</h2>
                        <table class="comparison-table">
                            <thead>
                                <tr>
                                    <th style="font-size: 1.2rem;">Feature</th>
                                    <th style="font-size: 1.2rem; color: var(--accent);">Seabe Digital</th>
                                    <th style="opacity: 0.7;">Other Apps</th>
                                    <th style="opacity: 0.7;">Card Machines</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td>Requires Data/App Download</td>
                                    <td><span class="check">✔ No (WhatsApp)</span></td>
                                    <td><span class="cross">✘ Yes</span></td>
                                    <td><span class="check">✔ No</span></td>
                                </tr>
                                <tr>
                                    <td>Instant PDF Receipts</td>
                                    <td><span class="check">✔ Automatic</span></td>
                                    <td><span class="cross">✘ Manual</span></td>
                                    <td><span class="cross">✘ Paper only</span></td>
                                </tr>
                                <tr>
                                    <td>Remote Giving</td>
                                    <td><span class="check">✔ Yes</span></td>
                                    <td><span class="check">✔ Yes</span></td>
                                    <td><span class="cross">✘ In-person only</span></td>
                                </tr>
                                <tr>
                                    <td>Weekly Financial Reports</td>
                                    <td><span class="check">✔ Emailed Weekly</span></td>
                                    <td><span class="cross">✘ Dashboard login</span></td>
                                    <td><span class="cross">✘ Manual Recon</span></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </section>

                <section class="section">
                    <div class="container" style="text-align: center;">
                        <h2 style="color: var(--primary);">Start Your Digital Journey</h2>
                        <p style="max-width: 600px; margin: 20px auto 40px;">Join the growing network of forward-thinking African ministries enhancing their stewardship today.</p>
                        <a href="/register" class="btn btn-gold">Register Your Church</a>
                    </div>
                </section>

                <footer>
                    <div class="container">
                        <div class="footer-grid">
                            <div class="footer-col">
                                <h4 style="color: var(--accent);">SEABE.</h4>
                                <p>Empowering the African Church with premium digital tools for growth and governance.</p>
                            </div>
                            <div class="footer-col">
                                <h4>Platform</h4>
                                <a href="/register">Register</a>
                                <a href="/demo">Book Demo</a>
                                <a href="#">Pricing</a>
                            </div>
                            <div class="footer-col">
                                <h4>Legal</h4>
                                <a href="/terms">Terms of Service</a>
                                <a href="#">Privacy Policy</a>
                                <a href="#">PAIA Manual</a>
                            </div>
                            <div class="footer-col">
                                <h4>Contact</h4>
                                <a href="mailto:hello@seabe.co.za">hello@seabe.co.za</a>
                                <a href="https://wa.me/27832182707">+27 83 218 2707</a>
                                <p>Johannesburg, South Africa</p>
                            </div>
                        </div>
                        <div style="border-top: 1px solid #333; padding-top: 40px;">
                            &copy; 2026 Seabe Digital (Pty) Ltd. All rights reserved.
                        </div>
                    </div>
                </footer>

            </body>
            </html>
        `);
    });

    // ==========================================
    // 2. MASTER SERVICE AGREEMENT (Premium Styling)
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
                    :root { --primary: #0a4d3c; --accent: #D4AF37; --text: #333; --light: #f9f9f9; }
                    body { font-family: 'Segoe UI', sans-serif; line-height: 1.8; color: var(--text); background-color: var(--light); margin: 0; }
                    .header { background: var(--primary); padding: 40px 0; text-align: center; color: white; }
                    .container { max-width: 800px; margin: -30px auto 50px; padding: 50px; background: white; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.05); }
                    h1 { margin: 0; font-size: 2rem; }
                    h2 { color: var(--primary); border-bottom: 2px solid var(--accent); padding-bottom: 10px; margin-top: 40px; }
                    a { color: var(--primary); font-weight: bold; text-decoration: none; }
                    .back-link { display: inline-block; margin-bottom: 20px; color: var(--accent); }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>Master Service Agreement</h1>
                    <p>Last Updated: January 31, 2026</p>
                </div>
                <div class="container">
                    <a href="/" class="back-link">← Return to Home</a>
                    
                    <p>Welcome to Seabe Digital. By using our platform, you agree to these terms.</p>

                    <h2>1. Service Description</h2>
                    <p>Seabe provides a digital payment and communication platform for religious organizations. We act as a technical intermediary between your organization and payment processors.</p>

                    <h2>2. Financial Terms</h2>
                    <p>Transactions are processed via Paystack. Standard platform fees apply to all transactions unless a custom enterprise agreement is in place.</p>

                    <h2>3. Data & Privacy (POPIA)</h2>
                    <p>We are committed to protecting your data. We do not sell member data to third parties. All data processing is done in accordance with South African law.</p>

                    <h2>4. Cancellation</h2>
                    <p>You may cancel your service at any time by contacting support. There are no long-term lock-in contracts for standard plans.</p>

                    <br><br>
                    <p><strong>Seabe Digital (Pty) Ltd</strong><br>Johannesburg, South Africa</p>
                </div>
            </body>
            </html>
        `);
    });

    // ==========================================
    // 3. REGISTER CHURCH (Premium Styling)
    // ==========================================
    app.get('/register', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Register | Seabe Digital</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: #f4f7f6; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
                    .card { background: white; padding: 40px; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); width: 100%; max-width: 450px; }
                    h2 { color: #0a4d3c; text-align: center; margin-bottom: 30px; }
                    input[type="text"], input[type="email"], input[type="file"] { width: 100%; padding: 12px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; }
                    button { width: 100%; padding: 15px; background: #0a4d3c; color: white; border: none; border-radius: 6px; font-weight: bold; font-size: 16px; cursor: pointer; transition: 0.2s; }
                    button:hover { background: #07382c; }
                    .tos { font-size: 13px; color: #666; display: flex; gap: 10px; align-items: start; margin-bottom: 20px; }
                    a { color: #D4AF37; text-decoration: none; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>Register Your Ministry</h2>
                    <form action="/register-church" method="POST" enctype="multipart/form-data">
                        <label>Church Name</label>
                        <input type="text" name="churchName" placeholder="e.g. Grace Family Church" required>
                        
                        <label>Official Email</label>
                        <input type="email" name="email" placeholder="admin@church.co.za" required>
                        
                        <div style="background: #eefdf5; padding: 15px; border-radius: 6px; margin-bottom: 20px;">
                            <h4 style="margin: 0 0 10px 0; color: #0a4d3c; font-size: 14px;">KYC Compliance Uploads</h4>
                            <label style="font-size: 12px;">Admin ID Document</label>
                            <input type="file" name="idDoc" accept=".pdf,.jpg,.png" required>
                            <label style="font-size: 12px;">Bank Confirmation Letter</label>
                            <input type="file" name="bankDoc" accept=".pdf,.jpg,.png" required>
                        </div>
                        
                        <div class="tos">
                            <input type="checkbox" name="tos" required> 
                            <span>I accept the <a href="/terms" target="_blank">Master Service Agreement</a> and confirm I am authorized to register this organization.</span>
                        </div>
                        
                        <button type="submit">Complete Registration</button>
                    </form>
                    <p style="text-align: center; font-size: 14px; margin-top: 20px;"><a href="/" style="color: #888;">&larr; Return Home</a></p>
                </div>
            </body>
            </html>
        `);
    });

    // --- LOGIC: REGISTER ---
    app.post('/register-church', upload.fields([{ name: 'idDoc', maxCount: 1 }, { name: 'bankDoc', maxCount: 1 }]), async (req, res) => {
        const { churchName, email, tos } = req.body;
        if (!tos) return res.send("⚠️ You must accept the Terms of Service.");

        try {
            const attachments = [];
            const filePathsToDelete = [];
            const processFile = (fieldName, prefix) => {
                if (req.files[fieldName]) {
                    const f = req.files[fieldName][0];
                    attachments.push({
                        content: fs.readFileSync(f.path).toString('base64'),
                        filename: `${prefix}_${churchName.replace(/[^a-zA-Z0-9]/g,'_')}_${f.originalname}`,
                        type: f.mimetype, disposition: 'attachment'
                    });
                    filePathsToDelete.push(f.path);
                }
            };
            processFile('idDoc', 'ID');
            processFile('bankDoc', 'BANK');

            const doc = await getDoc();
            const sheet = doc.sheetsByTitle['Churches'];
            const prefix = churchName.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
            const newCode = `${prefix}${Math.floor(100 + Math.random() * 900)}`;

            await sheet.addRow({ 'Name': churchName, 'Church Code': newCode, 'Email': email, 'Subaccount Code': 'PENDING_KYC', 'TOS Accepted': new Date().toISOString() });

            refreshCache();

            if (process.env.SENDGRID_KEY) {
                await sgMail.send({
                    to: EMAIL_FROM, from: EMAIL_FROM,
                    subject: `📝 NEW REGISTRATION: ${churchName}`,
                    html: `<h2>New Church Application</h2><p><strong>Church:</strong> ${churchName}</p><p><strong>Code:</strong> ${newCode}</p><p><strong>Email:</strong> ${email}</p><hr><p>KYC Documents attached.</p>`,
                    attachments: attachments
                });
            }

            filePathsToDelete.forEach(p => { try { fs.unlinkSync(p); } catch(e){} });

            res.send(`
                <div style="font-family:sans-serif; text-align:center; padding:50px;">
                    <h1 style="color:#0a4d3c;">Application Received</h1>
                    <p>Thank you for registering <strong>${churchName}</strong>.</p>
                    <p>Our compliance team will review your documents and activate your account shortly.</p>
                    <a href="/">Return Home</a>
                </div>
            `);
        } catch (e) { console.error(e); res.send("Error processing registration."); }
    });

    // ==========================================
    // 4. BOOK A DEMO (Premium Styling)
    // ==========================================
    app.get('/demo', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Book Demo | Seabe Digital</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: #f4f7f6; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
                    .card { background: white; padding: 40px; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); width: 100%; max-width: 450px; }
                    h2 { color: #0a4d3c; text-align: center; }
                    input { width: 100%; padding: 12px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; }
                    button { width: 100%; padding: 15px; background: #D4AF37; color: #0a4d3c; border: none; border-radius: 6px; font-weight: bold; font-size: 16px; cursor: pointer; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>Schedule a Demo</h2>
                    <p style="text-align: center; color: #666; margin-bottom: 30px;">See how Seabe can transform your stewardship.</p>
                    <form action="/request-demo" method="POST">
                        <input name="firstname" placeholder="Full Name" required>
                        <input name="email" placeholder="Email Address" required>
                        <input name="phone" placeholder="WhatsApp Number" required>
                        <button>Request Demo</button>
                    </form>
                    <p style="text-align: center; margin-top: 20px;"><a href="/" style="color: #888; text-decoration: none;">&larr; Return Home</a></p>
                </div>
            </body>
            </html>
        `);
    });

    app.post('/request-demo', upload.none(), async (req, res) => {
        const { firstname, email, phone } = req.body;
        if (process.env.SENDGRID_KEY) {
            await sgMail.send({ to: EMAIL_FROM, from: EMAIL_FROM, subject: `🔥 LEAD: ${firstname}`, html: `<p>New Demo Request: ${firstname} (${email})</p>` });
        }
        await syncToHubSpot({ name: firstname, email, phone });
        res.send(`<h1 style="text-align:center; font-family:sans-serif; color:#0a4d3c; margin-top:50px;">Request Received ✅</h1>`);
    });

    app.post('/payment-success', (req, res) => {
        res.send("<h1>Payment Successful! 🎉</h1>");
    });
};