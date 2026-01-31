// routes/web.js
const sgMail = require('@sendgrid/mail');
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

    // --- 2. REGISTER CHURCH (FORM) ---
    app.get('/register', (req, res) => {
        res.send(`
            <div style="font-family:sans-serif; max-width:400px; margin:auto; padding:20px;">
                <h2 style="color:#25D366;">Register Your Church ⛪</h2>
                <form action="/register-church" method="POST">
                    <input type="text" name="churchName" placeholder="Church Name" required style="width:100%; padding:10px; margin:5px 0;"><br>
                    <input type="email" name="email" placeholder="Official Email" required style="width:100%; padding:10px; margin:5px 0;"><br>
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

    // --- 3. REGISTER CHURCH (LOGIC) ---
    app.post('/register-church', upload.none(), async (req, res) => {
        const { churchName, email, tos } = req.body;
        if (!tos) return res.send("⚠️ You must accept the Terms of Service.");

        try {
            const doc = await getDoc();
            const sheet = doc.sheetsByTitle['Churches'];
            
            const prefix = churchName.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
            const newCode = `${prefix}${Math.floor(100 + Math.random() * 900)}`;

            await sheet.addRow({ 
                'Name': churchName, 
                'Church Code': newCode,
                'Email': email, 
                'Subaccount Code': 'PENDING',
                'TOS Accepted': new Date().toISOString()
            });

            // 🔥 Call the refresher passed from index.js
            refreshCache();

            res.send(`
                <div style="font-family:sans-serif; text-align:center; padding:50px;">
                    <h1 style="color:#25D366;">Welcome to Seabe! 🎉</h1>
                    <h3>Your Church Code: ${newCode}</h3>
                </div>
            `);
        } catch (e) {
            console.error(e);
            res.send("<h1>Error</h1><p>Could not register. Please contact support.</p>");
        }
    });

    // --- 4. DEMO REQUEST (FORM) ---
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

    // --- 5. DEMO REQUEST (LOGIC) ---
    app.post('/request-demo', upload.none(), async (req, res) => {
        const { firstname, email, phone } = req.body;
        
        // Email Alert
        if (process.env.SENDGRID_KEY) {
            await sgMail.send({
                to: EMAIL_FROM,
                from: EMAIL_FROM,
                subject: `🔥 Lead: ${firstname}`,
                html: `<p>New Demo Request from ${firstname} (${email})</p>`
            });
        }

        // CRM Sync (Function passed from index.js)
        await syncToHubSpot({ name: firstname, email, phone });
        
        res.send("<h1>Request Received! ✅</h1>");
    });

    // --- 6. PAYMENT SUCCESS ---
    app.post('/payment-success', (req, res) => {
        res.send("<h1>Payment Successful! 🎉</h1><p>You can return to WhatsApp.</p>");
    });
};