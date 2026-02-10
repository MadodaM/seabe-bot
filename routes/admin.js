// ==========================================
// CLIENT DASHBOARD (Safe Mode)
// Route: /admin/:code
// ==========================================
const express = require('express');
const router = express.Router();

// 1. DUMMY WHATSAPP FUNCTION (To prevent crashes if file is missing)
async function sendWhatsApp(to, text) {
    console.log("========================================");
    console.log(`📱 MOCK WHATSAPP to ${to}:`);
    console.log(text);
    console.log("========================================");
    return true;
}

// 2. GENERATE OTP
const generateOTP = () => Math.floor(1000 + Math.random() * 9000).toString();

module.exports = (app, { prisma }) => {

    // LOGIN PAGE
    router.get('/admin/:code', async (req, res) => {
        try {
            const { code } = req.params;
            
            // Debug Log: Check if this code runs
            console.log(`🔍 Attempting to access Admin for: ${code}`);

            const org = await prisma.church.findUnique({
                where: { code: code.toUpperCase() }
            });

            if (!org) return res.send("<h3>Error: Organization not found.</h3>");

            // Generate OTP
            const otp = generateOTP();
            const expiry = new Date(Date.now() + 5 * 60000); 

            // Save to DB
            await prisma.church.update({
                where: { code: code.toUpperCase() },
                data: { otp: otp, otpExpires: expiry }
            });

            // Send OTP (Mock)
            if (org.adminPhone) {
                const message = `🔐 *${org.name} Admin*\n\nOTP: *${otp}*`;
                await sendWhatsApp(org.adminPhone, message);
            } else {
                console.log("⚠️ No Admin Phone Number set for this Org");
            }

            // Render Page
            res.send(`
                <html>
                <body style="font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; background:#f4f4f4;">
                    <form action="/admin/${code}/verify" method="POST" style="background:white; padding:40px; border-radius:10px; text-align:center; width:300px; box-shadow:0 10px 25px rgba(0,0,0,0.1);">
                        <h2>🔐 ${org.name}</h2>
                        <p style="color:#666; font-size:14px;">Enter the OTP from your Logs</p>
                        
                        <input type="text" name="otp" placeholder="Check Logs" maxlength="4" style="font-size:30px; letter-spacing:10px; text-align:center; width:100%; padding:10px; margin:20px 0; border:2px solid #ddd; border-radius:8px;" required autofocus>
                        
                        <button type="submit" style="width:100%; padding:15px; background:#000; color:white; border:none; border-radius:8px; font-weight:bold; cursor:pointer;">Verify Login</button>
                    </form>
                </body>
                </html>
            `);

        } catch (e) {
            console.error("Admin Page Error:", e);
            res.status(500).send("System Error");
        }
    });

    // VERIFY OTP ROUTE
    router.post('/admin/:code/verify', async (req, res) => {
        const { code } = req.params;
        const { otp } = req.body;

        try {
            const org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });

            if (!org || org.otp !== otp) return res.send("<h3>🚫 Wrong Code</h3>");

            // Fetch Transactions
            const transactions = await prisma.transaction.findMany({
                where: { churchCode: code.toUpperCase(), status: 'success' },
                orderBy: { date: 'desc' },
                take: 50
            });
            
            const total = transactions.reduce((sum, tx) => sum + tx.amount, 0);

            // Render Dashboard
            res.send(`
                <html>
                <body style="font-family:sans-serif; padding:40px;">
                   <h1>${org.name} Dashboard</h1>
                   <h2>Balance: R${total.toFixed(2)}</h2>
                   <p>Success! You are logged in.</p>
                </body>
                </html>
            `);

        } catch (e) {
            console.error(e);
            res.send("System Error.");
        }
    });

    app.use('/', router);
};