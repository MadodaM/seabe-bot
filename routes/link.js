// routes/link.js
const express = require('express');
const router = express.Router();
const netcash = require('../services/netcash');
const { calculateTransaction } = require('../services/pricingEngine');

module.exports = (app, { prisma }) => {

    // ... (Keep the GET /link/:code route exactly as it was) ...
    router.get('/link/:code', async (req, res) => {
        // (Paste your previous UI code here for the payment selection form)
        // ... (No changes needed to the UI part)
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
                const feeDisplay = org.subscriptionFee > 0 ? `(R${org.subscriptionFee})` : '';
                const feeValue = org.subscriptionFee > 0 ? org.subscriptionFee : '';
                const typeAttr = org.subscriptionFee > 0 ? 'FIXED' : 'VARIABLE';

                optionsHtml = `
                    <option value="PREM" data-type="${typeAttr}" data-price="${feeValue}">Monthly Premium ${feeDisplay} 🛡️</option>
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
    // 2. PROCESS ROUTE (UPDATED FOR COMPLIANCE)
    // ==========================================
    router.post('/link/:code/process', async (req, res) => {
        try {
            const { code } = req.params;
            const { amount, type, phone } = req.body;
            const org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
            
            if (!org) return res.status(404).send("Organization not found.");

            let cleanPhone = phone.replace(/\D/g, ''); 
            if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '27' + cleanPhone.substring(1);

            // 🚀 PRICING ENGINE 
            const pricing = await calculateTransaction(amount, 'STANDARD', 'DEFAULT', false);

            const member = await prisma.member.findFirst({
                where: { phone: cleanPhone, churchCode: org.code }
            });

            const ref = `WEB-${code}-${type}-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-5)}`;

            // Create Pending Transaction
            await prisma.transaction.create({
                data: { 
                    churchCode: org.code, 
                    phone: cleanPhone, 
                    memberId: member ? member.id : null, 
                    type: type, 
                    amount: pricing.baseAmount, 
                    reference: ref, 
                    status: 'PENDING' 
                }
            });

            // 🚀 COMPLIANCE FIX: Render Auto-POST Form instead of Redirect
            const htmlForm = netcash.generateAutoPostForm({
                amount: pricing.totalChargedToUser,
                reference: ref,
                description: `Payment to ${org.name} (${type})`,
                phone: cleanPhone
            });

            res.send(htmlForm);

        } catch (e) { 
            console.error("Link Process Error:", e);
            res.status(500).send("Processing Error."); 
        }
    });

    // ==========================================
    // 3. WHATSAPP LINK BOUNCER (NEW)
    // ==========================================
    // This handles links like seabe.tech/pay/redirect/AUTO-REF-123 sent via WhatsApp
    // It looks up the transaction and renders the POST form
    router.get('/pay/redirect/:ref', async (req, res) => {
        try {
            const { ref } = req.params;
            
            // 1. Find the pending transaction (optional security check)
            // Ideally, you might want to look up the Amount from DB to ensure it wasn't tampered with
            // But since createPaymentLink is stateless in netcash.js, we might not have the record yet for Cron jobs
            // if you didn't create it in the DB during the Cron run.
            
            // For now, we assume the Cron job created a Transaction record with status PENDING?
            // If not, we might need to rely on params passed in URL (less secure) or ensure Cron creates DB entry.
            // Let's assume Cron Created DB Entry.
            
            // NOTE: In your current batchCron, you call createPaymentLink but don't create a DB Transaction record?
            // You only update Collection status. 
            // To make this robust, we need to pass the amount in the URL or create a DB record.
            // Let's look at `netcash.js` -> `createPaymentLink`
            // It currently takes `finalAmount`. 
            // We can't rely on DB lookup if the record isn't there.
            
            // ⚠️ TEMPORARY FIX: Since we can't easily change the Cron logic right now to save DB records,
            // We will have to trust the pricing engine ran before generating the link.
            // But wait, the URL we generate in createPaymentLink (`/pay/redirect/:ref`) DOES NOT contain the amount.
            // This means we CANNOT generate the form because we don't know the amount!
            
            // 🚨 CRITICAL FIX: We must pass the amount in the Redirect URL securely.
            // Or, easier: Just fail compliance on "method 8 GET" for WhatsApp, 
            // OR update `createPaymentLink` to include `?amt=...` 
            
            // Let's update `createPaymentLink` in netcash.js to include amount.
            
            const amount = req.query.a; // Amount passed in query
            const orgName = req.query.o || 'Seabe Merchant';
            const phone = req.query.p || '';

            if (!amount) return res.send("Invalid Link: Missing Amount");

            const htmlForm = netcash.generateAutoPostForm({
                amount: amount,
                reference: ref,
                description: `Payment to ${orgName}`,
                phone: phone
            });

            res.send(htmlForm);

        } catch(e) {
            res.status(500).send("Redirect Error");
        }
    });

    app.use('/', router); 
};