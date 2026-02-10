// ==========================================
// SEABE LINK (The Public Web Portal)
// Supports: Churches ⛪, Societies 🛡️, NPOs 🤝
// ==========================================
const express = require('express');
const router = express.Router(); // 👈 This was missing!
const { createPaymentLink } = require('../services/paystack'); 

module.exports = (app, { prisma }) => {

    // ==========================================
    // 1. THE PUBLIC LANDING PAGE (GET)
    // Example: seabe.io/link/AFM001
    // ==========================================
    router.get('/link/:code', async (req, res) => {
        try {
            const { code } = req.params;
            
            // Fetch Organization details & Active Events/Projects
            const org = await prisma.church.findUnique({
                where: { code: code.toUpperCase() },
                include: { 
                    events: { 
                        where: { status: 'ACTIVE' } 
                    } 
                }
            });

            if (!org) return res.status(404).send("<h3>Error: Organization not found.</h3>");

            // --- 💡 DYNAMIC MENU BUILDER ---
            let optionsHtml = '';
            let orgIcon = '⛪';
            let orgLabel = 'Church';
            let themeColor = '#000'; // Default Black

            // 🛡️ SCENARIO A: BURIAL SOCIETY
            if (org.type === 'BURIAL_SOCIETY') {
                orgIcon = '🛡️';
                orgLabel = 'Burial Society';
                themeColor = '#2c3e50'; // Navy Blue
                const fee = org.subscriptionFee || 150;
                
                optionsHtml = `
                    <option value="PREM" data-type="FIXED" data-price="${fee}">Monthly Premium (R${fee}) 🛡️</option>
                    <option value="JOIN_FEE" data-type="VARIABLE">Joining Fee 📝</option>
                    <option value="ARREARS" data-type="VARIABLE">Arrears / Late Payment ⚠️</option>
                    <option value="DONATION" data-type="VARIABLE">General Donation 🤝</option>
                `;
            } 
            // 🤝 SCENARIO B: NON-PROFIT (NPO)
            else if (org.type === 'NON_PROFIT') {
                orgIcon = '🤝';
                orgLabel = 'Non-Profit';
                themeColor = '#27ae60'; // Green
                
                optionsHtml = `
                    <option value="DONATION" data-type="VARIABLE" selected>General Donation 💖</option>
                    <option value="PLEDGE" data-type="VARIABLE">Monthly Pledge 🔁</option>
                    <option value="SPONSORSHIP" data-type="VARIABLE">Sponsor a Child/Beneficiary 🧑‍🤝‍🧑</option>
                `;
            } 
            // ⛪ SCENARIO C: CHURCH (Default)
            else {
                orgIcon = '⛪';
                themeColor = '#8e44ad'; // Purple
                
                optionsHtml = `
                    <option value="OFFERING" data-type="VARIABLE" selected>General Offering 🎁</option>
                    <option value="TITHE" data-type="VARIABLE">Tithe (10%) 🏛️</option>
                    <option value="THANKSGIVING" data-type="VARIABLE">Thanksgiving 🙏</option>
                    <option value="SEED" data-type="VARIABLE">Seed Faith 🌱</option>
                    <option value="BUILDING" data-type="VARIABLE">Building Fund 🧱</option>
                `;
            }

            // --- ADD EVENTS & PROJECTS ---
            if (org.events && org.events.length > 0) {
                optionsHtml += `<optgroup label="Campaigns & Events">`;
                
                org.events.forEach(e => {
                    if (e.isDonation) {
                        optionsHtml += `<option value="PROJECT_${e.id}" data-type="VARIABLE">${e.name} (Any Amount) 🏗️</option>`;
                    } else {
                        optionsHtml += `<option value="EVENT_${e.id}" data-type="FIXED" data-price="${e.price}">${e.name} (R${e.price}) 🎟️</option>`;
                    }
                });
                
                optionsHtml += `</optgroup>`;
            }

            // --- RENDER HTML TEMPLATE ---
            res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Pay ${org.name}</title>
                <style>
                    :root { --primary: ${themeColor}; --bg: #f4f6f8; }
                    body { font-family: -apple-system, system-ui, sans-serif; background: var(--bg); padding: 20px; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
                    .card { background: white; width: 100%; max-width: 400px; padding: 30px; border-radius: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); }
                    .header { text-align: center; margin-bottom: 30px; }
                    .logo { font-size: 50px; margin-bottom: 10px; display: inline-block; }
                    h2 { margin: 0; color: #333; font-size: 22px; }
                    .badge { background: #eee; padding: 4px 8px; border-radius: 4px; font-size: 12px; color: #666; display: inline-block; margin-top: 5px; }
                    
                    .input-group { margin-bottom: 20px; }
                    label { display: block; font-size: 12px; font-weight: 700; color: #777; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
                    input, select { width: 100%; padding: 14px; border: 2px solid #eee; border-radius: 12px; font-size: 16px; box-sizing: border-box; transition: 0.3s; background: #fff; }
                    input:focus, select:focus { border-color: var(--primary); outline: none; }
                    
                    /* CHECKBOX STYLES */
                    .checkbox-wrapper { display: flex; align-items: flex-start; gap: 10px; background: #f9f9f9; padding: 15px; border-radius: 12px; border: 1px solid #eee; }
                    .checkbox-wrapper input { width: 20px; height: 20px; margin: 0; cursor: pointer; }
                    .checkbox-wrapper label { margin: 0; font-size: 13px; color: #555; text-transform: none; font-weight: 400; line-height: 1.4; cursor: pointer; }
                    .checkbox-wrapper a { color: var(--primary); text-decoration: none; font-weight: 600; }

                    .btn { width: 100%; padding: 16px; background: var(--primary); color: white; border: none; border-radius: 12px; font-weight: 700; font-size: 16px; cursor: not-allowed; margin-top: 10px; transition: 0.3s; opacity: 0.5; }
                    .btn:not([disabled]):hover { opacity: 0.9; transform: translateY(-2px); }
                    
                    .secure-footer { text-align: center; margin-top: 25px; font-size: 11px; color: #aaa; line-height: 1.5; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="header">
                        <div class="logo">${orgIcon}</div>
                        <h2>${org.name}</h2>
                        <span class="badge">${orgLabel}</span>
                    </div>

                    <form action="/link/${code}/process" method="POST">
                        
                        <div class="input-group">
                            <label>I want to give to...</label>
                            <select name="type" id="paymentType" onchange="updateAmountLogic()" required>
                                ${optionsHtml}
                            </select>
                        </div>

                        <div class="input-group">
                            <label>Amount (ZAR)</label>
                            <input type="number" name="amount" id="amountInput" placeholder="e.g. 100" min="10" step="any" required>
                        </div>

                        <div class="input-group">
                            <label>Your Details</label>
                            <input type="text" name="name" placeholder="Full Name" required style="margin-bottom: 10px;">
                            <input type="email" name="email" placeholder="Email Address" required style="margin-bottom: 10px;">
                            <input type="tel" name="phone" placeholder="WhatsApp Number" required>
                        </div>

                        <div class="input-group checkbox-wrapper">
                            <input type="checkbox" id="termsCheckbox" onchange="togglePayButton()">
                            <label for="termsCheckbox">
                                I agree to the <a href="/terms" target="_blank">Terms</a> & <a href="/privacy" target="_blank">Privacy Policy</a>. 
                                <br><span style="font-size:11px; color:#888;">(Refunds subject to Org policy)</span>
                            </label>
                        </div>

                        <button type="submit" class="btn" id="payButton" disabled>Proceed to Pay</button>
                    </form>
                    
                    <div class="secure-footer">
                        🔒 Secured by Paystack & Seabe<br>
                        Seabe Digital is a technology platform. We are not a bank or insurer.
                    </div>
                </div>

                <script>
                    function updateAmountLogic() {
                        const select = document.getElementById('paymentType');
                        const input = document.getElementById('amountInput');
                        const option = select.options[select.selectedIndex];
                        
                        const type = option.getAttribute('data-type');
                        const price = option.getAttribute('data-price');

                        if (type === 'FIXED') {
                            input.value = price;
                            input.readOnly = true;
                            input.style.backgroundColor = "#f9f9f9";
                            input.style.color = "#555";
                        } else {
                            input.value = '';
                            input.readOnly = false;
                            input.style.backgroundColor = "white";
                            input.style.color = "#000";
                            input.placeholder = "Enter Amount (Min R10)";
                            input.focus();
                        }
                    }
                    
                    function togglePayButton() {
                        const checkbox = document.getElementById('termsCheckbox');
                        const btn = document.getElementById('payButton');
                        
                        if (checkbox.checked) {
                            btn.disabled = false;
                            btn.style.opacity = '1';
                            btn.style.cursor = 'pointer';
                        } else {
                            btn.disabled = true;
                            btn.style.opacity = '0.5';
                            btn.style.cursor = 'not-allowed';
                        }
                    }
                    
                    updateAmountLogic();
                    togglePayButton();
                </script>
            </body>
            </html>
            `);

        } catch (e) {
            console.error("Link Page Error:", e);
            res.status(500).send("System Error loading page.");
        }
    });

    // ==========================================
    // 2. PROCESS THE PAYMENT (POST)
    // ==========================================
    router.post('/link/:code/process', async (req, res) => {
        try {
            const { code } = req.params;
            const { amount, type, name, email, phone } = req.body;
            
            // Validate Org
            const org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
            if (!org) return res.send("Error: Organization not found.");

            // Clean Phone (Remove spaces, ensure format)
            const cleanPhone = phone.replace(/\D/g, ''); 
            
            // Construct Reference
            const ref = `WEB-${code}-${type}-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-5)}`;

            // Call Paystack Service
            const link = await createPaymentLink(
                amount, // Note: sanitization happens inside the service now!
                ref, 
                email, 
                org.subaccountCode, 
                cleanPhone, 
                org.name
            );

            if (link) {
                // UPSERT MEMBER
                const updateData = {};
                if (org.type === 'CHURCH') {
                    updateData.churchCode = org.code;
                } else if (org.type === 'BURIAL_SOCIETY') {
                    updateData.societyCode = org.code;
                }

                await prisma.member.upsert({
                    where: { phone: cleanPhone },
                    update: { ...updateData, email: email }, 
                    create: { 
                        phone: cleanPhone, 
                        firstName: name.split(' ')[0], 
                        lastName: name.split(' ')[1] || 'Guest',
                        email: email,
                        joinedAt: new Date(),
                        ...updateData
                    }
                });

                // LOG TRANSACTION
                await prisma.transaction.create({
                    data: {
                        churchCode: org.code, 
                        phone: cleanPhone,
                        type: type, 
                        amount: parseFloat(amount),
                        reference: ref,
                        status: 'PENDING',
                        date: new Date()
                    }
                });

                // REDIRECT TO PAYSTACK
                res.redirect(link);
            } else {
                res.status(500).send("Error communicating with Payment Gateway.");
            }

        } catch (e) {
            console.error("Web Payment Processing Error:", e);
            res.status(500).send("System Error Processing Payment.");
        }
    });

    // 🔌 CONNECT THE ROUTER
    app.use('/', router); 
};