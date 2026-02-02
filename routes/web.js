// routes/web.js
// VERSION: 2.1 (PostgreSQL Integration + Premium UI)
const sgMail = require('@sendgrid/mail');
const fs = require('fs');
require('dotenv').config();

const EMAIL_FROM = process.env.EMAIL_FROM;
if (process.env.SENDGRID_KEY) sgMail.setApiKey(process.env.SENDGRID_KEY);

module.exports = function(app, upload, { prisma, syncToHubSpot }) {

    // 1. PREMIUM HOMEPAGE
    app.get('/', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Seabe | Kingdom Connectivity</title>
                <style>
                    :root { --primary: #0a4d3c; --accent: #D4AF37; --text: #1a1a1a; --white: #ffffff; }
                    body { font-family: 'Segoe UI', system-ui, sans-serif; margin: 0; background: var(--white); color: var(--text); }
                    .hero { background: linear-gradient(rgba(10, 77, 60, 0.95), rgba(5, 40, 30, 0.98)); color: white; padding: 120px 20px; text-align: center; }
                    .btn { display: inline-block; padding: 15px 30px; border-radius: 8px; font-weight: bold; text-decoration: none; font-size: 1.1rem; margin: 10px; transition: 0.3s; }
                    .btn-gold { background: var(--accent); color: var(--primary); }
                    .btn-gold:hover { background: #b5952f; transform: translateY(-2px); }
                    .container { max-width: 1100px; margin: auto; padding: 20px; }
                    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 40px; margin-top: 50px; }
                    .card { padding: 30px; border: 1px solid #eee; border-radius: 15px; text-align: center; }
                </style>
            </head>
            <body>
                <div class="hero">
                    <h1 style="font-size: 3rem;">Digital Stewardship for the<br><span style="color:var(--accent)">African Church</span></h1>
                    <p style="font-size: 1.2rem; opacity: 0.9;">No Apps. No Data Costs. Just WhatsApp.</p>
                    <br>
                    <a href="/register" class="btn btn-gold">Register Ministry</a>
                </div>
                <div class="container">
                    <div class="grid">
                        <div class="card"><h3>📱 WhatsApp First</h3><p>100% member adoption instantly.</p></div>
                        <div class="card"><h3>💳 Instant Receipts</h3><p>Automated PDF generation.</p></div>
                        <div class="card"><h3>📊 Weekly Reports</h3><p>Financials emailed every Monday.</p></div>
                    </div>
                </div>
            </body>
            </html>
        `);
    });

    // 2. REGISTER (Database Logic)
    app.get('/register', (req, res) => {
        res.send(`
            <div style="font-family:sans-serif; max-width:500px; margin:50px auto; padding:40px; border:1px solid #eee; border-radius:10px;">
                <h2 style="color:#0a4d3c; text-align:center;">Register Your Ministry</h2>
                <form action="/register-church" method="POST" enctype="multipart/form-data">
                    <input type="text" name="churchName" placeholder="Church Name" required style="width:100%; padding:10px; margin-bottom:15px;">
                    <input type="email" name="email" placeholder="Email" required style="width:100%; padding:10px; margin-bottom:15px;">
                    <div style="background:#f4f7f6; padding:15px; margin-bottom:15px;">
                        <label>ID Doc:</label><input type="file" name="idDoc" accept=".pdf,.jpg" required><br><br>
                        <label>Bank Letter:</label><input type="file" name="bankDoc" accept=".pdf,.jpg" required>
                    </div>
                    <label><input type="checkbox" name="tos" required> I accept the Terms of Service</label>
                    <button style="width:100%; padding:15px; background:#0a4d3c; color:white; border:none; margin-top:20px; cursor:pointer;">Complete Registration</button>
                </form>
            </div>
        `);
    });

    app.post('/register-church', upload.fields([{ name: 'idDoc', maxCount: 1 }, { name: 'bankDoc', maxCount: 1 }]), async (req, res) => {
        const { churchName, email, tos } = req.body;
        if (!tos) return res.send("⚠️ Terms Required.");

        try {
            // File Handling
            const attachments = []; const filePathsToDelete = [];
            const processFile = (fieldName, prefix) => {
                if (req.files[fieldName]) {
                    const f = req.files[fieldName][0];
                    attachments.push({ content: fs.readFileSync(f.path).toString('base64'), filename: `${prefix}_${churchName.replace(/[^a-zA-Z0-9]/g,'_')}_${f.originalname}`, type: f.mimetype, disposition: 'attachment' });
                    filePathsToDelete.push(f.path);
                }
            };
            processFile('idDoc', 'ID'); processFile('bankDoc', 'BANK');

            // SAVE TO POSTGRESQL (PRISMA)
            const prefix = churchName.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
            const newCode = `${prefix}${Math.floor(100 + Math.random() * 900)}`;

            await prisma.church.create({
                data: {
                    name: churchName,
                    code: newCode,
                    email: email,
                    subaccountCode: 'PENDING_KYC',
                    tosAcceptedAt: new Date()
                }
            });

            if (process.env.SENDGRID_KEY) {
                await sgMail.send({ to: EMAIL_FROM, from: EMAIL_FROM, subject: `📝 NEW REGISTRATION: ${churchName}`, html: `<h2>New Church</h2><p>Name: ${churchName}</p><p>Code: ${newCode}</p>`, attachments: attachments });
            }
            
            filePathsToDelete.forEach(p => { try { fs.unlinkSync(p); } catch(e){} });

            res.send(`<h1 style="color:#0a4d3c; text-align:center; margin-top:50px;">Registration Successful!</h1><p style="text-align:center;">Code: <strong>${newCode}</strong></p>`);

        } catch (e) { console.error(e); res.send("Error"); }
    });

    // 3. DEMO
    app.get('/demo', (req, res) => res.send(`<form action="/request-demo" method="POST"><h2>Book Demo</h2><input name="firstname"><input name="email"><button>Submit</button></form>`));
    app.post('/request-demo', upload.none(), async (req, res) => {
        await syncToHubSpot(req.body);
        res.send("<h1>Done</h1>");
    });
};