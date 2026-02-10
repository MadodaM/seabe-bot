// ==========================================
// CLIENT DASHBOARD (Live Mode 🟢)
// Route: /admin/:code
// ==========================================
const express = require('express');
const router = express.Router();
const { sendWhatsApp } = require('../services/whatsapp');

// Helper: Generate 4-digit OTP
const generateOTP = () => Math.floor(1000 + Math.random() * 9000).toString();

// Helper: Standard Header with Favicon (Lock Icon 🔐)
const getHead = (title) => `
    <head>
        <title>${title} | Secure Admin</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🔐</text></svg>">
    </head>
`;

module.exports = (app, { prisma }) => {

    // 1. LOGIN PAGE
    router.get('/admin/:code', async (req, res) => {
        const { code } = req.params;
        
        try {
            // Find Org
            const org = await prisma.church.findUnique({
                where: { code: code.toUpperCase() }
            });

            if (!org) return res.send("<h3>Error: Organization not found.</h3>");

            // Generate OTP
            const otp = generateOTP();
            const expiry = new Date(Date.now() + 5 * 60000); // 5 mins

            // Save to DB
            await prisma.church.update({
                where: { code: code.toUpperCase() },
                data: { otp: otp, otpExpires: expiry }
            });

            // 🚀 SEND REAL WHATSAPP
            if (org.adminPhone) {
                console.log(`📨 Sending OTP to ${org.adminPhone}...`);
                const message = `🔐 *${org.name} Admin*\n\nYour Login OTP is: *${otp}*\n\nValid for 5 minutes.`;
                await sendWhatsApp(org.adminPhone, message);
            } else {
                console.log("⚠️ No Admin Phone Number set for this Org");
            }

            // Mask phone for UI
            const masked = org.adminPhone ? org.adminPhone.slice(-4) : '....';

            // Render Page
            res.send(`
                <!DOCTYPE html>
                <html>
                ${getHead('Login')}
                <body style="font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; background:#f4f4f4; margin:0;">
                    <form action="/admin/${code}/verify" method="POST" style="background:white; padding:40px; border-radius:10px; text-align:center; width:300px; box-shadow:0 10px 25px rgba(0,0,0,0.1);">
                        <h2>🔐 ${org.name}</h2>
                        <p style="color:#666; font-size:14px;">Enter code sent to ...${masked}</p>
                        
                        <input type="text" name="otp" placeholder="0000" maxlength="4" style="font-size:30px; letter-spacing:10px; text-align:center; width:100%; padding:10px; margin:20px 0; border:2px solid #ddd; border-radius:8px;" required autofocus>
                        
                        <button type="submit" style="width:100%; padding:15px; background:#2d3436; color:white; border:none; border-radius:8px; font-weight:bold; cursor:pointer;">Verify Login</button>
                    </form>
                </body>
                </html>
            `);

        } catch (e) {
            console.error("❌ Admin Route Error:", e);
            res.status(500).send("System Error.");
        }
    });

    // 2. VERIFY OTP & SHOW DASHBOARD
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

            // Generate Rows
            const rows = transactions.map(tx => `
                <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:10px;">${new Date(tx.date).toLocaleDateString()}</td>
                    <td style="padding:10px;">${tx.type}</td>
                    <td style="padding:10px;">${tx.phone}</td>
                    <td style="padding:10px; font-weight:bold;">R${tx.amount.toFixed(2)}</td>
                </tr>
            `).join('');

            // Render Dashboard
            res.send(`
                <!DOCTYPE html>
                <html>
                ${getHead('Dashboard')}
                <body style="font-family:sans-serif; padding:30px; background:#f9f9f9; margin:0;">
                    <div style="max-width:800px; margin:0 auto;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:30px;">
                            <h1 style="margin:0; color:#2d3436;">${org.name}</h1>
                            <div style="text-align:right;">
                                <div style="font-size:12px; color:#888;">TOTAL RAISED</div>
                                <div style="font-size:24px; font-weight:bold; color:#00b894;">R${total.toFixed(2)}</div>
                            </div>
                        </div>

                        <div style="background:white; padding:20px; border-radius:10px; box-shadow:0 2px 10px rgba(0,0,0,0.05);">
                            <h3 style="margin-top:0; border-bottom:2px solid #eee; padding-bottom:10px;">Recent Transactions</h3>
                            <table style="width:100%; border-collapse:collapse;">
                                <thead style="background:#f1f2f6;">
                                    <tr>
                                        <th style="padding:10px; text-align:left; color:#636e72; font-size:12px;">DATE</th>
                                        <th style="padding:10px; text-align:left; color:#636e72; font-size:12px;">TYPE</th>
                                        <th style="padding:10px; text-align:left; color:#636e72; font-size:12px;">FROM</th>
                                        <th style="padding:10px; text-align:left; color:#636e72; font-size:12px;">AMOUNT</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${rows || '<tr><td colspan="4" style="text-align:center; padding:20px;">No payments yet.</td></tr>'}
                                </tbody>
                            </table>
                        </div>
                    </div>
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