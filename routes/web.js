// routes/web.js
// VERSION: 1.5.1 (Syntax Fix)
const sgMail = require('@sendgrid/mail');
const fs = require('fs');
require('dotenv').config();

const EMAIL_FROM = process.env.EMAIL_FROM;
if (process.env.SENDGRID_KEY) sgMail.setApiKey(process.env.SENDGRID_KEY);

module.exports = function(app, upload, { getDoc, refreshCache, syncToHubSpot }) {

    // ==========================================
    // 1. MARKETING HOMEPAGE
    // ==========================================
    app.get('/', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Seabe | Kingdom Connectivity</title>
                <style>
                    :root { --primary: #25D366; --dark: #075E54; --light: #f0f2f5; }
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; color: #333; line-height: 1.6; }
                    .hero { background: linear-gradient(135deg, #075E54 0%, #128C7E 100%); color: white; padding: 80px 20px; text-align: center; }
                    .hero h1 { font-size: 3.5rem; margin-bottom: 20px; font-weight: 800; }
                    .hero p { font-size: 1.25rem; margin-bottom: 40px; opacity: 0.9; max-width: 600px; margin-left: auto; margin-right: auto; }
                    .btn { display: inline-block; padding: 15px 30px; border-radius: 50px; text-decoration: none; font-weight: bold; transition: transform 0.2s; margin: 10px; }
                    .btn-primary { background: white; color: var(--dark); }
                    .btn-outline { border: 2px solid white; color: white; }
                    .btn:hover { transform: translateY(-3px); box-shadow: 0 10px 20px rgba(0,0,0,0.2); }
                    .features { padding: 80px 20px; background: white; max-width: 1100px; margin: auto; }
                    .section-title { text-align: center; margin-bottom: 60px; color: var(--dark); font-size: 2.5rem; }
                    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 40px; }
                    .card { background: var(--light); padding: 30px; border-radius: 15px; text-align: center; }
                    .card h3 { color: var(--dark); margin-top: 15px; }
                    .icon { font-size: 3rem; }
                    footer { background: #333; color: white; text-align: center; padding: 40px 20px; margin-top: 50px; }
                    footer a { color: #ccc; text-decoration: none; margin: 0 15px; }
                    footer a:hover { color: white; }
                    @media(max-width: 768px) { .hero h1 { font-size: 2.5rem; } }
                </style>
            </head>
            <body>
                <div class="hero">
                    <h1>Connecting the Kingdom</h1>
                    <p>The all-in-one WhatsApp platform for church payments, automated receipts, and member management. No apps to download. Just simple, secure connectivity.</p>
                    <br>
                    <a href="/register" class="btn btn-primary">➕ Register Your Church</a>
                    <a href="/demo" class="btn btn-outline">📅 Book a Demo</a>
                </div>
                <div class="features">
                    <h2 class="section-title">Why Pastors Choose Seabe</h2>
                    <div class="grid">
                        <div class="card">
                            <div class="icon">💳</div>
                            <h3>Seamless Payments</h3>
                            <p>Accept Tithes, Offerings, and Building Funds directly via WhatsApp. Secure, fast, and easy for members.</p>
                        </div>
                        <div class="card">
                            <div class="icon">🧾</div>
                            <h3>Automated Receipts</h3>
                            <p>Members receive an instant PDF receipt on WhatsApp immediately after giving. No manual admin required.</p>
                        </div>
                        <div class="card">
                            <div class="icon">📊</div>
                            <h3>Weekly Reporting</h3>
                            <p>Get a fully automated financial spreadsheet emailed to your admin team every Monday morning.</p>
                        </div>
                        <div class="card">
                            <div class="icon">⚖️</div>
                            <h3>KYC & Compliance</h3>
                            <p>We handle the heavy lifting of verification and compliance so you can focus on ministry.</p>
                        </div>
                    </div>
                </div>
                <footer>
                    <p>&copy; 2026 Seabe Digital. All rights reserved.</p>
                    <br>
                    <a href="/terms">Terms of Service</a>
                    <a href="/demo">Contact Sales</a>
                    <a href="/register">Get Started</a>
                </footer>
            </body>
            </html>
        `);
    });

    // ==========================================
    // 2. MASTER SERVICE AGREEMENT
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
                    :root { --primary: #25D366; --dark: #333; --light: #f9f9f9; --accent: #e8f5e9; }
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: var(--dark); margin: 0; padding: 0; background-color: var(--light); }
                    .container { max-width: 900px; margin: 40px auto; padding: 40px; background: white; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
                    h1 { color: var(--primary); border-bottom: 2px solid #eee; padding-bottom: 10px; margin-bottom: 30px; }
                    h2 { margin-top: 35px; font-size: 1.4rem; color: #444; border-left: 4px solid var(--primary); padding-left: 15px; }
                    h3 { font-size: 1.1rem; margin-top: 20px; color: var(--dark); }
                    .refund-box { background: var(--accent); border-left: 5px solid var(--primary); padding: 20px; margin: 30px 0; border-radius: 0 4px 4px 0; }
                    footer { text-align: center; margin-top: 50px; padding: 20px; font-size: 0.9rem; color: #777; }
                    a { color: var(--primary); text-decoration: none; font-weight: 500; }
                    a:hover { text-decoration: underline; }
                    .back-link { display: inline-block; margin-bottom: 20px; font-size: 0.9rem; }
                    .effective-date { font-style: italic; color: #666; margin-bottom: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <a href="/" class="back-link">← Back to Home</a>
                    <h1>Master Service Agreement</h1>
                    <p class="effective-date"><strong>Last Updated:</strong> January 31, 2026</p>

                    <p>Welcome to Seabe Digital ("Seabe," "we," "us," or "our"). By accessing or using our WhatsApp-based payment platform and associated digital services (the "Service"), you agree to be bound by this Master Service Agreement, which incorporates our Terms of Service, Data Protection Policy, and Software Licensing terms.</p>

                    <h2>1. Description of Service & Eligibility</h2>
                    <p>Seabe provides a technology platform that facilitates donations, tithes, and community payments for churches and non-profit organizations via WhatsApp and digital interfaces. 
                    <strong>Seabe is a technical intermediary; we are not a bank, and we do not hold funds.</strong></p>
                    <p>You must be at least 18 years of age and have the legal capacity to enter into binding contracts in the Republic of South Africa to use this Service.</p>

                    <h2>2. Payments & Financial Compliance</h2>
                    <p>All financial transactions are processed by <strong>Paystack Payments South Africa (Pty) Ltd</strong>, a PCI-DSS Level 1 certified Payment Service Provider. By initiating a payment, you agree to be bound by Paystack's terms.</p>
                    <ul>
                        <li><strong>FICA Compliance:</strong> In accordance with the Financial Intelligence Centre Act, we reserve the right to request identity verification for any user or organization.</li>
                        <li><strong>Transaction Fees:</strong> Platform fees are deducted automatically from the gross transaction amount before settlement to the Organization’s account.</li>
                    </ul>

                    <div class="refund-box">
                        <h2>3. Refund & Dispute Policy</h2>
                        <p><strong>Donations & Tithes:</strong> As these are voluntary charitable contributions, they are generally non-refundable. For errors in transaction amounts, please contact your Church Administrator immediately.</p>
                        <p><strong>Event Tickets:</strong> Refunds are subject to the specific policy of the host Organization. Seabe facilitates the payment but does not determine refund eligibility.</p>
                        <p><strong>Fraudulent Activity:</strong> If you suspect unauthorized use of your account, notify us at <a href="mailto:madoda@seabe.co.za">madoda@seabe.co.za</a> immediately.</p>
                    </div>

                    <h2>4. Data Protection (POPIA)</h2>
                    <p>We process your personal information in strict accordance with the <strong>Protection of Personal Information Act (POPIA)</strong>.</p>
                    <h3>4.1 Use of Data</h3>
                    <p>We collect information (Name, Contact Details, Transaction Metadata) to fulfill our contractual obligations and provide support via our CRM provider, <strong>HubSpot</strong>.</p>
                    <h3>4.2 Transborder Flows</h3>
                    <p>You acknowledge that your data may be stored on secure servers located outside of South Africa (including the EU and USA) via our partners HubSpot and Paystack. We ensure these partners adhere to international security standards equivalent to POPIA.</p>
                    <h3>4.3 Data Rights</h3>
                    <p>You have the right to access, correct, or request deletion of your data. For inquiries, contact our Information Officer at <a href="mailto:madoda@seabe.co.za">madoda@seabe.co.za</a>.</p>

                    <h2>5. Software Licensing & Intellectual Property</h2>
                    <p>Seabe grants you a non-exclusive, revocable license to use the WhatsApp bot and dashboard for authorized purposes. You may not reverse-engineer, decompile, or attempt to extract the source code of the Service. All intellectual property remains the sole property of Seabe Digital (Pty) Ltd.</p>

                    <h2>6. Limitation of Liability</h2>
                    <p>To the maximum extent permitted by South African law, Seabe Digital shall not be liable for any indirect or consequential damages, or losses resulting from unauthorized access to your personal WhatsApp account or mobile device.</p>

                    <h2>7. Contact & Support</h2>
                    <p>For support, compliance queries, or legal notices:</p>
                    <p>
                        <strong>Email:</strong> <a href="mailto:madoda@seabe.co.za">madoda@seabe.co.za</a><br>
                        <strong>Official Website:</strong> <a href="https://www.seabe.co.za" target="_blank">www.seabe.co.za</a>
                    </p>

                    <footer>
                        &copy; 2026 Seabe Digital (Pty) Ltd. All rights reserved. <br>
                        Incorporated in the Republic of South Africa.
                    </footer>
                </div>
            </body>
            </html>
        `);
    });

    // ==========================================
    // 3. REGISTER CHURCH (FORM + KYC)
    // ==========================================
    app.get('/register', (req, res) => {
        res.send(`
            <div style="font-family:sans-serif; max-width:400px; margin:auto; padding:20px;">
                <h2 style="color:#25D366; text-align:center;">Register Your Church ⛪</h2>
                <div style="background:#f9f9f9; padding:20px; border-radius:10px; border:1px solid #ddd;">
                    <form action="/register-church" method="POST" enctype="multipart/form-data">
                        <label><strong>Church Name</strong></label>
                        <input type="text" name="churchName" placeholder="e.g. Grace Family Church" required style="width:100%; padding:10px; margin:5px 0 15px 0; border:1px solid #ccc; border-radius:5px;">
                        
                        <label><strong>Official Email</strong></label>
                        <input type="email" name="email" placeholder="admin@church.co.za" required style="width:100%; padding:10px; margin:5px 0 15px 0; border:1px solid #ccc; border-radius:5px;">
                        
                        <hr style="margin:20px 0; border:0; border-top:1px solid #eee;">
                        
                        <h4 style="margin-bottom:10px; color:#555;">KYC Documents (Required)</h4>
                        <label style="font-size:13px; color:#666;">ID Document (PDF/JPG):</label>
                        <input type="file" name="idDoc" accept=".pdf,.jpg,.png" required style="width:100%; margin-bottom:15px;">
                        
                        <label style="font-size:13px; color:#666;">Bank Confirmation Letter:</label>
                        <input type="file" name="bankDoc" accept=".pdf,.jpg,.png" required style="width:100%; margin-bottom:15px;">
                        
                        <br>
                        <label style="font-size:14px; color:#333; display:flex; align-items:start; gap:10px;">
                            <input type="checkbox" name="tos" required style="mt-1"> 
                            <span>I accept the <a href="/terms" target="_blank" style="color:#25D366;">Terms of Service</a> and verify these details are correct.</span>
                        </label>
                        <br><br>
                        <button type="submit" style="background:#25D366; color:white; border:none; padding:15px; width:100%; cursor:pointer; border-radius:5px; font-weight:bold; font-size:16px;">Submit Registration</button>
                    </form>
                </div>
                <p style="text-align:center; margin-top:20px;"><a href="/" style="color:#999; text-decoration:none;">Cancel and return home</a></p>
            </div>
        `);
    });

    // --- REGISTER LOGIC (KYC + EMAIL) ---
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
                        type: f.mimetype,
                        disposition: 'attachment'
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

            await sheet.addRow({ 
                'Name': churchName, 
                'Church Code': newCode,
                'Email': email, 
                'Subaccount Code': 'PENDING_KYC', 
                'TOS Accepted': new Date().toISOString()
            });

            refreshCache();

            if (process.env.SENDGRID_KEY) {
                await sgMail.send({
                    to: EMAIL_FROM,
                    from: EMAIL_FROM,
                    subject: `📝 NEW REGISTRATION: ${churchName}`,
                    html: `
                        <h2>New Church Application</h2>
                        <p><strong>Church:</strong> ${churchName}</p>
                        <p><strong>Code:</strong> ${newCode}</p>
                        <p><strong>Email:</strong> ${email}</p>
                        <hr>
                        <p>KYC Documents are attached for review.</p>
                    `,
                    attachments: attachments
                });
            }

            filePathsToDelete.forEach(p => { try { fs.unlinkSync(p); } catch(e){} });

            res.send(`
                <div style="font-family:sans-serif; text-align:center; padding:50px;">
                    <div style="font-size:50px;">🎉</div>
                    <h1 style="color:#25D366;">Application Received</h1>
                    <p>We have received your registration for <strong>${churchName}</strong>.</p>
                    <p>Your documents are being reviewed by our compliance team.</p>
                    <br>
                    <a href="/" style="color:#25D366; text-decoration:none; font-weight:bold;">Return to Home</a>
                </div>
            `);

        } catch (e) {
            console.error(e);
            res.send("<h1>Error</h1><p>Something went wrong. Please try again.</p>");
        }
    });

    // ==========================================
    // 4. BOOK A DEMO (FORM + HUBSPOT)
    // ==========================================
    app.get('/demo', (req, res) => {
        res.send(`
            <div style="font-family:sans-serif; max-width:400px; margin:auto; padding:20px; text-align:center;">
                <h2 style="color:#007bff;">Book a Free Demo 📅</h2>
                <p>See how Seabe can transform your ministry.</p>
                <form action="/request-demo" method="POST" style="text-align:left; background:#f0f8ff; padding:20px; border-radius:10px;">
                    <label>Name</label>
                    <input name="firstname" placeholder="Your Name" required style="width:100%; padding:10px; margin-bottom:15px; border:1px solid #ccc; border-radius:4px;">
                    
                    <label>Email</label>
                    <input name="email" placeholder="you@church.com" required style="width:100%; padding:10px; margin-bottom:15px; border:1px solid #ccc; border-radius:4px;">
                    
                    <label>Phone (WhatsApp)</label>
                    <input name="phone" placeholder="+27..." style="width:100%; padding:10px; margin-bottom:15px; border:1px solid #ccc; border-radius:4px;">
                    
                    <button style="width:100%; padding:15px; background:#007bff; color:white; border:none; border-radius:4px; font-weight:bold; cursor:pointer;">Request Demo</button>
                </form>
                <br>
                <a href="/" style="color:#999; text-decoration:none;">Back to Home</a>
            </div>
        `);
    });

    app.post('/request-demo', upload.none(), async (req, res) => {
        const { firstname, email, phone } = req.body;
        
        if (process.env.SENDGRID_KEY) {
            await sgMail.send({
                to: EMAIL_FROM,
                from: EMAIL_FROM,
                subject: `🔥 LEAD: ${firstname}`,
                html: `<p>New Demo Request: ${firstname} (${email}) - ${phone}</p>`
            });
        }
        await syncToHubSpot({ name: firstname, email, phone });
        
        res.send(`
            <div style="font-family:sans-serif; text-align:center; padding:50px;">
                <h1 style="color:#007bff;">Request Sent! ✅</h1>
                <p>Our team will contact you shortly on WhatsApp.</p>
                <a href="/" style="text-decoration:none;">Back to Home</a>
            </div>
        `);
    });

    app.post('/payment-success', (req, res) => {
        res.send("<h1>Payment Successful! 🎉</h1><p>You can return to WhatsApp.</p>");
    });
};