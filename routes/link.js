// routes/link.js
const express = require('express');
const router = express.Router();

// 📦 IMPORT NEW SERVICES
const netcash = require('../services/netcash');
const { calculateTransaction } = require('../services/pricingEngine'); // 🚀 ADDED PRICING ENGINE

module.exports = (app, { prisma }) => {

    router.get('/link/:code', async (req, res) => {
        try {
            const { code } = req.params;
            const org = await prisma.church.findUnique({
                where: { code: code.toUpperCase() },
                include: { events: { where: { status: 'ACTIVE' } } }
            });

            if (!org) return res.status(404).send("<h3>Error: Organization not found.</h3>");

            // --- 💡 DYNAMIC MENU & BRANDING ---
            let optionsHtml = '';
            let orgIcon = '⛪';
            let orgLabel = 'Church';
            let themeColor = '#8e44ad'; 

            if (org.type === 'BURIAL_SOCIETY') {
                orgIcon = '🛡️';
                orgLabel = 'Burial Society';
                themeColor = '#2c3e50';
                const fee = org.subscriptionFee || 150;
                optionsHtml = `
                    <option value="PREM" data-type="FIXED" data-price="${fee}">Monthly Premium (R${fee}) 🛡️</option>
                    <option value="JOIN_FEE" data-type="VARIABLE">Joining Fee 📝</option>
                    <option value="DONATION" data-type="VARIABLE">General Donation 🤝</option>`;
            } else if (org.type === 'NON_PROFIT') {
                orgIcon = '🤝';
                orgLabel = 'Non-Profit';
                themeColor = '#27ae60';
                optionsHtml = `<option value="DONATION" data-type="VARIABLE" selected>General Donation 💖</option>`;
            } else {
                optionsHtml = `
                    <option value="OFFERING" data-type="VARIABLE" selected>General Offering 🎁</option>
                    <option value="TITHE" data-type="VARIABLE">Tithe (10%) 🏛️</option>`;
            }

            // --- 🎨 FULL UI RESTORATION ---
            res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link rel="icon" type="image/png" href="/favicon.png">
                <title>Pay ${org.name}</title>
                <style>
                    :root { --primary: ${themeColor}; --bg: #f4f6f8; }
                    body { font-family: -apple-system, system-ui, sans-serif; background: var(--bg); display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; }
                    .card { background: white; width: 100%; max-width: 400px; padding: 30px; border-radius: 24px; box-shadow: 0 20px 40px rgba(0,0,0,0.1); border: 1px solid rgba(0,0,0,0.05); }
                    .header { text-align: center; margin-bottom: 30px; }
                    .logo { font-size: 48px; margin-bottom: 8px; }
                    h2 { margin: 0; color: #1a1a1a; font-size: 24px; font-weight: 800; }
                    .badge { background: #f0f0f0; padding: 4px 12px; border-radius: 20px; font-size: 11px; color: #666; font-weight: 700; text-transform: uppercase; margin-top: 8px; display: inline-block; }
                    .input-group { margin-bottom: 20px; }
                    label { display: block; font-size: 11px; font-weight: 800; color: #999; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px; }
                    input, select { width: 100%; padding: 15px; border: 2px solid #f0f0f0; border-radius: 14px; font-size: 16px; transition: 0.2s; -webkit-appearance: none; }
                    input:focus, select:focus { border-color: var(--primary); outline: none; box-shadow: 0 0 0 4px rgba(0,0,0,0.03); }
                    .btn { width: 100%; padding: 18px; background: var(--primary); color: white; border: none; border-radius: 16px; font-weight: 800; font-size: 17px; cursor: pointer; transition: 0.3s; margin-top: 10px; }
                    .btn:hover { transform: translateY(-2px); filter: brightness(1.1); }
                    .secure-footer { text-align: center; margin-top: 25px; font-size: 10px; color: #bbb; text-transform: uppercase; letter-spacing: 0.5px; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="header">
                        <div class="logo">${orgIcon}</div>
                        <h2>${org.name}</h2>
                        <div class="badge">${orgLabel} Portal</div>
                    </div>
                    <form action="/link/${code}/process" method="POST">
                        <div class="input-group">
                            <label>Contribution Type</label>
                            <select name="type" id="pType" onchange="upd()" required>${optionsHtml}</select>
                        </div>
                        <div class="input-group">
                            <label>Amount (ZAR)</label>
                            <input type="number" name="amount" id="amt" placeholder="e.g. 150" min="10" required>
                        </div>
                        <div class="input-group">
                            <label>Payer Details</label>
                            <input type="text" name="name" placeholder="Full Name" required style="margin-bottom:10px">
                            <input type="tel" name="phone" placeholder="WhatsApp Number" required>
                        </div>
                        <button type="submit" class="btn">Proceed to Secure Pay</button>
                    </form>
                    <div class="secure-footer">🔒 Encrypted Payment via Seabe Digital</div>
                </div>
                <script>
                    function upd() {
                        const s = document.getElementById('pType');
                        const i = document.getElementById('amt');
                        const o = s.options[s.selectedIndex];
                        if (o.getAttribute('data-type') === 'FIXED') {
                            i.value = o.getAttribute('data-price');
                            i.readOnly = true;
                            i.style.background = "#f9f9f9";
                        } else {
                            i.value = '';
                            i.readOnly = false;
                            i.style.background = "#fff";
                        }
                    }
                    upd();
                </script>
            </body>
            </html>`);
        } catch (e) { res.status(500).send("System Error."); }
    });

    // ==========================================
    // 2. PROCESS ROUTE (Netcash & Pricing Upgraded)
    // ==========================================
    router.post('/link/:code/process', async (req, res) => {
        try {
            const { code } = req.params;
            const { amount, type, phone } = req.body;
            const org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
            
            if (!org) return res.status(404).send("Organization not found.");

            // 1. Standardize Phone Number
            let cleanPhone = phone.replace(/\D/g, ''); 
            if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '27' + cleanPhone.substring(1);

            // 🚀 2. PRICING ENGINE CALCULATION
            // passFeesToUser = false (Merchant absorbs the gateway fee out of their settlement)
            const pricing = calculateTransaction(amount, 'STANDARD', 'DEFAULT', false);

            // 3. Look up the Member ID so their payment history syncs perfectly
            const member = await prisma.member.findFirst({
                where: { phone: cleanPhone, churchCode: org.code }
            });

            const ref = `WEB-${code}-${type}-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-5)}`;

            // 4. Create Netcash Link using the total amount (which equals the base amount here)
            const link = await netcash.createPaymentLink(pricing.totalChargedToUser, ref, cleanPhone, org.name);

            if (link) {
                // 5. Save to Database with the original amount so the receipt looks correct to the user
                await prisma.transaction.create({
                    data: { 
                        churchCode: org.code, 
                        phone: cleanPhone, 
                        memberId: member ? member.id : null, 
                        type: type, 
                        amount: pricing.baseAmount, // Record exactly what they donated
                        reference: ref, 
                        status: 'PENDING' 
                    }
                });
                res.redirect(link);
            } else {
                res.status(500).send("Gateway Error.");
            }
        } catch (e) { 
            console.error("Link Process Error:", e);
            res.status(500).send("Processing Error."); 
        }
    });

    app.use('/', router); 
};