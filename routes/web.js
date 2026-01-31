// routes/web.js
// VERSION: 2.1 (PostgreSQL Integration)
const sgMail = require('@sendgrid/mail');
const fs = require('fs');
require('dotenv').config();

const EMAIL_FROM = process.env.EMAIL_FROM;
if (process.env.SENDGRID_KEY) sgMail.setApiKey(process.env.SENDGRID_KEY);

// ⚠️ Note: We now receive 'prisma' instead of 'getDoc/refreshCache'
module.exports = function(app, upload, { prisma, syncToHubSpot }) {

    // ==========================================
    // 1. MARKETING HOMEPAGE (Same Premium Design)
    // ==========================================
    app.get('/', (req, res) => {
        // ... (Keep your HTML design the same, I am shortening it here for readability, 
        // but assume it contains the full premium HTML we designed earlier)
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Seabe | Kingdom Connectivity</title>
                <style>
                    :root { --primary: #0a4d3c; --accent: #D4AF37; --text: #1a1a1a; --light: #f4f7f6; --white: #ffffff; }
                    body { font-family: 'Inter', system-ui, sans-serif; margin: 0; color: var(--text); background: var(--white); }
                    .hero { background: linear-gradient(rgba(10, 77, 60, 0.95), rgba(5, 40, 30, 0.98)); color: white; padding: 100px 0; text-align: center; }
                    .btn { display: inline-block; padding: 15px 30px; border-radius: 8px; font-weight: bold; text-decoration: none; background: var(--accent); color: var(--primary); margin: 10px; }
                    .container { max-width: 1200px; margin: auto; padding: 20px; }
                </style>
            </head>
            <body>
                <div class="hero">
                    <h1>Digital Stewardship for the African Church</h1>
                    <p>Powered by Seabe Database Engine</p>
                    <a href="/register" class="btn">Get Started</a>
                </div>
            </body>
            </html>
        `);
    });

    // ==========================================
    // 2. REGISTER CHURCH (Write to DB)
    // ==========================================
    app.get('/register', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head><title>Register</title></head>
            <body style="font-family:sans-serif; background:#f4f7f6; padding:40px;">
                <div style="background:white; padding:40px; border-radius:10px; max-width:500px; margin:auto;">
                    <h2 style="color:#0a4d3c; text-align:center;">Register Ministry</h2>
                    <form action="/register-church" method="POST" enctype="multipart/form-data">
                        <input type="text" name="churchName" placeholder="Church Name" required style="width:100%; padding:10px; margin-bottom:15px;">
                        <input type="email" name="email" placeholder="Official Email" required style="width:100%; padding:10px; margin-bottom:15px;">
                        <div style="background:#eefdf5; padding:15px; margin-bottom:15px;">
                            <label>ID Document:</label><input type="file" name="idDoc" accept=".pdf,.jpg" required>
                            <br><br>
                            <label>Bank Letter:</label><input type="file" name="bankDoc" accept=".pdf,.jpg" required>
                        </div>
                        <label><input type="checkbox" name="tos" required> Accept Terms</label>
                        <br><br>
                        <button style="width:100%; padding:15px; background:#0a4d3c; color:white; border:none; font-weight:bold;">Register</button>
                    </form>
                </div>
            </body>
            </html>
        `);
    });

    app.post('/register-church', upload.fields([{ name: 'idDoc', maxCount: 1 }, { name: 'bankDoc', maxCount: 1 }]), async (req, res) => {
        const { churchName, email, tos } = req.body;
        if (!tos) return res.send("⚠️ You must accept the Terms.");

        try {
            // 1. Process Files for Email
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

            // 2. SAVE TO DATABASE (New Prisma Code)
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

            // 3. Email Admin
            if (process.env.SENDGRID_KEY) {
                await sgMail.send({
                    to: EMAIL_FROM, from: EMAIL_FROM,
                    subject: `📝 NEW REGISTRATION: ${churchName}`,
                    html: `<h2>New Church</h2><p>Name: ${churchName}</p><p>Code: ${newCode}</p><p>Saved to PostgreSQL.</p>`,
                    attachments: attachments
                });
            }

            // Cleanup
            filePathsToDelete.forEach(p => { try { fs.unlinkSync(p); } catch(e){} });

            res.send(`<h1>Registered!</h1><p>Church Code: <strong>${newCode}</strong></p><p>Saved to Database.</p><a href="/">Home</a>`);
        } catch (e) {
            console.error(e);
            res.send("<h1>Error</h1><p>Registration failed. Try again.</p>");
        }
    });

    // ==========================================
    // 3. BOOK DEMO (Same logic)
    // ==========================================
    app.get('/demo', (req, res) => res.send(`<form action="/request-demo" method="POST"><h2>Book Demo</h2><input name="firstname"><input name="email"><button>Submit</button></form>`));
    
    app.post('/request-demo', upload.none(), async (req, res) => {
        const { firstname, email, phone } = req.body;
        await syncToHubSpot({ name: firstname, email, phone });
        res.send("<h1>Done</h1>");
    });
};