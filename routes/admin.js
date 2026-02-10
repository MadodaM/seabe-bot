// ==========================================
// CLIENT DASHBOARD (Debug Mode)
// Route: /admin/:code
// ==========================================
const express = require('express');
const router = express.Router();

// 1. MOCK WHATSAPP (Prevents import errors)
async function sendWhatsApp(to, text) {
    console.log("========================================");
    console.log(`📱 MOCK WHATSAPP to ${to}:`);
    console.log(text);
    console.log("========================================");
    return true;
}

// 2. GENERATE OTP
const generateOTP = () => Math.floor(1000 + Math.random() * 9000).toString();

// 3. BULLETPROOF EXPORT
// Accepts (app, prisma) OR (app, { prisma })
module.exports = (app, arg2) => {
    
    // 🛡️ Safe Extraction: Handle both styles of passing arguments
    const prisma = arg2.prisma || arg2;

    if (!prisma) {
        console.error("❌ FATAL: Prisma Client is undefined in admin.js");
    }

    // LOGIN PAGE ROUTE
    router.get('/admin/:code', async (req, res) => {
        const { code } = req.params;
        
        try {
            // Check Database Connection
            if (!prisma) throw new Error("Database (Prisma) not connected to route.");

            console.log(`🔍 Accessing Admin for: ${code}`);

            // 1. Find the Organization
            const org = await prisma.church.findUnique({
                where: { code: code.toUpperCase() }
            });

            if (!org) return res.send("<h3>Error: Organization not found. Check the code.</h3>");

            // 2. Generate OTP
            const otp = generateOTP();
            const expiry = new Date(Date.now() + 5 * 60000); 

            // 3. Save to Database
            await prisma.church.update({
                where: { code: code.toUpperCase() },
                data: { otp: otp, otpExpires: expiry }
            });

            // 4. Send Notification (Mock)
            // Note: If adminPhone is missing, we log it but don't crash
            if (org.adminPhone) {
                const message = `🔐 *${org.name} Admin*\n\nOTP: *${otp}*`;
                await sendWhatsApp(org.adminPhone, message);
            } else {
                console.log("⚠️ No Admin Phone Number set for this Org");
            }

            // 5. Render Login Page
            res.send(`
                <html>
                <body style="font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; background:#f4f4f4;">
                    <form action="/admin/${code}/verify" method="POST" style="background:white; padding:40px; border-radius:10px; text-align:center; width:300px; box-shadow:0 10px 25px rgba(0,0,0,0.1);">
                        <h2>🔐 ${org.name}</h2>
                        <p style="color:#666; font-size:14px;">CHECK SERVER LOGS FOR OTP</p>
                        
                        <input type="text" name="otp" placeholder="Enter OTP" maxlength="4" style="font-size:30px; letter-spacing:10px; text-align:center; width:100%; padding:10px; margin:20px 0; border:2px solid #ddd; border-radius:8px;" required autofocus>
                        
                        <button type="submit" style="width:100%; padding:15px; background:#000; color:white; border:none; border-radius:8px; font-weight:bold; cursor:pointer;">Verify Login</button>
                    </form>
                </body>
                </html>
            `);

        } catch (e) {
            console.error("❌ Admin Page Crash:", e);
            // SHOW THE ACTUAL ERROR ON SCREEN
            res.status(500).send(`
                <h3>System Error</h3>
                <p>The server crashed with the following message:</p>
                <pre style="background:#eee; padding:10px; border-radius:5px;">${e.message}</pre>
                <p>Check your server logs for more details.</p>
            `);
        }
    });

    // VERIFY OTP ROUTE
    router.post('/admin/:code/verify', async (req, res) => {
        const { code } = req.params;
        const { otp } = req.body;

        try {
            const org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });

            if (!org || org.otp !== otp) return res.send("<h3>🚫 Wrong Code</h3><a href='javascript:history.back()'>Try Again</a>");

            // Fetch Transactions
            const transactions = await prisma.transaction.findMany({
                where: { churchCode: code.toUpperCase(), status: 'success' },
                orderBy: { date: 'desc' },
                take: 50
            });
            
            const total = transactions.reduce((sum, tx) => sum + tx.amount, 0);

            res.send(`
                <html>
                <body style="font-family:sans-serif; padding:40px;">
                   <h1>${org.name} Dashboard</h1>
                   <h2 style="color:green;">Balance: R${total.toFixed(2)}</h2>
                   <p>Success! You are logged in.</p>
                </body>
                </html>
            `);

        } catch (e) {
            console.error(e);
            res.send(`<h3>Verify Error</h3><pre>${e.message}</pre>`);
        }
    });

    app.use('/', router);
};