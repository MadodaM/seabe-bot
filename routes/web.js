// routes/web.js
// VERSION: 1.4 (Marketing Website Update)
const sgMail = require('@sendgrid/mail');
const fs = require('fs');
require('dotenv').config();

const EMAIL_FROM = process.env.EMAIL_FROM;
if (process.env.SENDGRID_KEY) sgMail.setApiKey(process.env.SENDGRID_KEY);

module.exports = function(app, upload, { getDoc, refreshCache, syncToHubSpot }) {

    // ==========================================
    // 1. THE NEW MARKETING HOMEPAGE 🎨
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
                    
                    /* HERO SECTION */
                    .hero { background: linear-gradient(135deg, #075E54 0%, #128C7E 100%); color: white; padding: 80px 20px; text-align: center; }
                    .hero h1 { font-size: 3.5rem; margin-bottom: 20px; font-weight: 800; }
                    .hero p { font-size: 1.25rem; margin-bottom: 40px; opacity: 0.9; max-width: 600px; margin-left: auto; margin-right: auto; }
                    
                    /* BUTTONS */
                    .btn { display: inline-block; padding: 15px 30px; border-radius: 50px; text-decoration: none; font-weight: bold; transition: transform 0.2s; margin: 10px; }
                    .btn-primary { background: white; color: var(--dark); }
                    .btn-outline { border: 2px solid white; color: white; }
                    .btn:hover { transform: translateY(-3px); box-shadow: 0 10px 20px rgba(0,0,0,0.2); }
                    
                    /* BENEFITS GRID */
                    .features { padding: 80px 20px; background: white; max-width: 1100px; margin: auto; }
                    .section-title { text-align: center; margin-bottom: 60px; color: var(--dark); font-size: 2.5rem; }
                    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 40px; }
                    .card { background: var(--light); padding: 30px; border-radius: 15px; text-align: center; }
                    .card h3 { color: var(--dark); margin-top: 15px; }
                    .icon { font-size: 3rem; }

                    /* FOOTER */
                    footer { background: #333; color: white; text-align: center; padding: 40px 20px; margin-top: 50px; }
                    footer a { color: #ccc; text-decoration: none; margin: 0 15px; }
                    footer a:hover { color: white; }

                    /* MOBILE TWEAKS */
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

    // --- TERMS OF SERVICE PAGE ---
    app.get('/terms', (req, res) => {
        res.send(`
            <div style="font-family:sans-serif; padding:40px; max-width:800px; margin:auto; line-height:1.6;">
                <h1>Terms of Service</h1>
                <p>Last Updated: January 31, 2026</p>
                <hr>
                <h3>1. Introduction</h3>
                <p>Welcome to Seabe. By using our platform, you agree to comply with and be bound by the following terms...</p>
                <h3>2. Payments & Fees</h3>
                <p>Seabe facilitates payments through third-party providers. Transaction fees apply...</p>
                <h3>3. User Responsibilities</h3>
                <p>Churches must provide accurate KYC documentation including ID and Bank Confirmations...</p>
                <br>
                <a href="/" style="color:#25D366; text-decoration:none;">&larr; Back to Home</a>
            </div>
        `);
    });

    // ==========================================
    // 2. REGISTER CHURCH (FORM + KYC)
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

            // Helper to process file
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

            // Save to Database
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

            // Email Admin
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

            // Cleanup
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
    // 3. BOOK A DEMO (FORM + HUBSPOT)
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