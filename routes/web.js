// routes/web.js
// v1.3: KYC Uploads via SendGrid
const sgMail = require('@sendgrid/mail');
const fs = require('fs');
require('dotenv').config();

const EMAIL_FROM = process.env.EMAIL_FROM;
if (process.env.SENDGRID_KEY) sgMail.setApiKey(process.env.SENDGRID_KEY);

module.exports = function(app, upload, { getDoc, refreshCache, syncToHubSpot }) {

    // --- 1. HOMEPAGE ---
    app.get('/', (req, res) => {
        res.send(`
            <div style="font-family:sans-serif; text-align:center; padding:50px;">
                <h1 style="color:#25D366;">Seabe Platform Live 🟢</h1>
                <p>Enterprise System Active.</p>
                <a href="/register" style="color:#25D366; text-decoration:none; font-weight:bold;">Register Church</a> | 
                <a href="/demo" style="color:#007bff; text-decoration:none; font-weight:bold;">Request Demo</a>
            </div>
        `);
    });

    // --- 2. REGISTER CHURCH (FORM + KYC) ---
    app.get('/register', (req, res) => {
        res.send(`
            <div style="font-family:sans-serif; max-width:400px; margin:auto; padding:20px;">
                <h2 style="color:#25D366;">Register Your Church ⛪</h2>
                <form action="/register-church" method="POST" enctype="multipart/form-data">
                    <input type="text" name="churchName" placeholder="Church Name" required style="width:100%; padding:10px; margin:5px 0;"><br>
                    <input type="email" name="email" placeholder="Official Email" required style="width:100%; padding:10px; margin:5px 0;"><br>
                    
                    <h4 style="margin-bottom:5px;">Upload KYC Documents:</h4>
                    <label>ID Document (Admin):</label><br>
                    <input type="file" name="idDoc" accept=".pdf,.jpg,.png" required style="margin-bottom:10px;"><br>
                    <label>Bank Confirmation:</label><br>
                    <input type="file" name="bankDoc" accept=".pdf,.jpg,.png" required style="margin-bottom:10px;"><br>
                    
                    <br>
                    <label style="font-size:14px; color:#555;">
                        <input type="checkbox" name="tos" required> 
                        I accept the <a href="#">Terms of Service</a>.
                    </label>
                    <br><br>
                    <button type="submit" style="background:#25D366; color:white; border:none; padding:15px; width:100%; cursor:pointer;">Register Now</button>
                </form>
            </div>
        `);
    });

    // --- 3. REGISTER CHURCH (LOGIC WITH FILE HANDLING) ---
    app.post('/register-church', upload.fields([{ name: 'idDoc', maxCount: 1 }, { name: 'bankDoc', maxCount: 1 }]), async (req, res) => {
        const { churchName, email, tos } = req.body;
        
        if (!tos) return res.send("⚠️ You must accept the Terms of Service.");

        try {
            // 1. Process Files for Email Attachment
            const attachments = [];
            const filePathsToDelete = [];

            if (req.files['idDoc']) {
                const f = req.files['idDoc'][0];
                attachments.push({
                    content: fs.readFileSync(f.path).toString('base64'),
                    filename: `ID_${churchName.replace(/\s/g,'_')}_${f.originalname}`,
                    type: f.mimetype,
                    disposition: 'attachment'
                });
                filePathsToDelete.push(f.path);
            }

            if (req.files['bankDoc']) {
                const f = req.files['bankDoc'][0];
                attachments.push({
                    content: fs.readFileSync(f.path).toString('base64'),
                    filename: `BANK_${churchName.replace(/\s/g,'_')}_${f.originalname}`,
                    type: f.mimetype,
                    disposition: 'attachment'
                });
                filePathsToDelete.push(f.path);
            }

            // 2. Save Data to Sheets
            const doc = await getDoc();
            const sheet = doc.sheetsByTitle['Churches'];
            const prefix = churchName.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
            const newCode = `${prefix}${Math.floor(100 + Math.random() * 900)}`;

            await sheet.addRow({ 
                'Name': churchName, 
                'Church Code': newCode,
                'Email': email, 
                'Subaccount Code': 'PENDING_KYC', // 📝 Mark as Pending Review
                'TOS Accepted': new Date().toISOString()
            });

            refreshCache();

            // 3. Email Admin (You) with KYC Files
            if (process.env.SENDGRID_KEY) {
                await sgMail.send({
                    to: EMAIL_FROM, // Send to Admin
                    from: EMAIL_FROM,
                    subject: `📝 KYC ACTION: New Registration (${churchName})`,
                    html: `
                        <h2>New Church Registration</h2>
                        <p><strong>Name:</strong> ${churchName}</p>
                        <p><strong>Code:</strong> ${newCode}</p>
                        <p><strong>Email:</strong> ${email}</p>
                        <p><strong>Status:</strong> KYC Documents Attached. Please review.</p>
                    `,
                    attachments: attachments
                });
            }

            // 4. Cleanup Temp Files
            filePathsToDelete.forEach(path => {
                try { fs.unlinkSync(path); } catch(e) { console.error("Cleanup error", e); }
            });

            res.send(`
                <div style="font-family:sans-serif; text-align:center; padding:50px;">
                    <h1 style="color:#25D366;">Submission Received! 🎉</h1>
                    <h3>Church Code: ${newCode}</h3>
                    <p>Your documents have been sent for review.</p>
                </div>
            `);
        } catch (e) {
            console.error(e);
            res.send("<h1>Error</h1><p>Registration failed.</p>");
        }
    });

    // --- 4. DEMO REQUEST ---
    app.get('/demo', (req, res) => {
        res.send(`
            <form action="/request-demo" method="POST" style="font-family:sans-serif; padding:20px; max-width:400px; margin:auto;">
                <h2>Request Demo</h2>
                <input name="firstname" placeholder="Name" required style="width:100%; padding:10px; margin:5px 0;"><br>
                <input name="email" placeholder="Email" required style="width:100%; padding:10px; margin:5px 0;"><br>
                <input name="phone" placeholder="Phone" style="width:100%; padding:10px; margin:5px 0;"><br><br>
                <button style="padding:10px 20px;">Request</button>
            </form>
        `);
    });

    app.post('/request-demo', upload.none(), async (req, res) => {
        const { firstname, email, phone } = req.body;
        if (process.env.SENDGRID_KEY) {
            await sgMail.send({
                to: EMAIL_FROM,
                from: EMAIL_FROM,
                subject: `🔥 Lead: ${firstname}`,
                html: `<p>New Demo Request from ${firstname} (${email})</p>`
            });
        }
        await syncToHubSpot({ name: firstname, email, phone });
        res.send("<h1>Request Received! ✅</h1>");
    });

    app.post('/payment-success', (req, res) => {
        res.send("<h1>Payment Successful! 🎉</h1><p>You can return to WhatsApp.</p>");
    });
};