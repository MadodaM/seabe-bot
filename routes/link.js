// routes/link.js
// VERSION: 4.4 (Strict Prisma Compliance, Multi-Tenant Menus, Dynamic Services, & Lead Capture)
const express = require('express');
const router = express.Router();
const netcash = require('../services/netcash');
const { calculateTransaction } = require('../services/pricingEngine');
const { sendWhatsApp } = require('../services/twilioClient'); // Ensure this path matches your project structure

module.exports = (app, { prisma }) => {

    // ==========================================
    // 1. PAYMENT LANDING PAGE (The UI)
    // ==========================================
    router.get('/link/:code', async (req, res) => {
        try {
            const { code } = req.params;
            
            // Fetch Org + All possible Menu Items (Filtered safely in memory below)
            const org = await prisma.church.findUnique({ 
                where: { code: code.toUpperCase() },
                include: { 
                    events: true,
                    products: true,
                    courses: true
                }
            });

            if (!org) return res.status(404).send("<h3>Error: Organization not found.</h3>");

            // Filter Active Items safely
            const activeEvents = (org.events || []).filter(e => e.status.toUpperCase() === 'ACTIVE');
            const activeProducts = (org.products || []).filter(p => p.isActive);
            const liveCourses = (org.courses || []).filter(c => c.status === 'LIVE' || c.status === 'ACTIVE');

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
            
            } else if (org.type === 'STOKVEL_SAVINGS') {
                orgIcon = '💰';
                orgLabel = 'Savings Club';
                themeColor = '#f39c12';
                optionsHtml = `
                    <option value="CONTRIBUTION" data-type="VARIABLE" selected>Monthly Contribution 💰</option>
                    <option value="DEPOSIT" data-type="VARIABLE">Once-off Deposit 📥</option>
                    <option value="PENALTY" data-type="VARIABLE">Late Fee / Penalty ⚠️</option>`;
            
            } else if (org.type === 'NON_PROFIT') {
                orgIcon = '🤝';
                orgLabel = 'Non-Profit';
                themeColor = '#27ae60';
                optionsHtml = `<option value="DONATION" data-type="VARIABLE" selected>General Donation 💖</option>`;
            
            } else if (org.type === 'SERVICE_PROVIDER' || org.type === 'PERSONAL_CARE') {
                orgIcon = '✂️';
                orgLabel = 'Booking & Services';
                themeColor = '#e67e22';
                
                if (activeProducts.length > 0) {
                    optionsHtml = activeProducts.map(p => `<option value="SERVICE_${p.id}" data-type="FIXED" data-price="${p.price}">${p.name} - R${p.price.toFixed(2)}</option>`).join('');
                    optionsHtml += `<option value="OTHER_SERVICE" data-type="VARIABLE">Other Amount / Custom Service</option>`;
                } else {
                    optionsHtml = `<option value="SERVICE" data-type="VARIABLE" selected>Service Payment ✂️</option>`;
                }
            
            } else if (org.type === 'ACADEMY' || org.type === 'COACHING') {
                orgIcon = '🎓';
                orgLabel = 'Academy';
                themeColor = '#3498db';
                
                if (liveCourses.length > 0) {
                    optionsHtml = liveCourses.map(c => `<option value="COURSE_${c.id}" data-type="FIXED" data-price="${c.price}">${c.title} - R${c.price.toFixed(2)}</option>`).join('');
                    optionsHtml += `<option value="DONATION" data-type="VARIABLE">Sponsor a Student 📚</option>`;
                } else {
                    optionsHtml = `<option value="COURSE_FEE" data-type="VARIABLE" selected>Course Registration Fee 🎓</option>`;
                }
            
            } else { // DEFAULT CHURCH
                optionsHtml = `
                    <option value="OFFERING" data-type="VARIABLE" selected>General Offering 🎁</option>
                    <option value="TITHE" data-type="VARIABLE">Tithe (10%) 🏛️</option>
                    <option value="DONATION" data-type="VARIABLE">Building Fund / Donation 🧱</option>`;
            }

            // --- 🎟️ UNIVERSAL EVENTS APPEND ---
            if (activeEvents.length > 0) {
                optionsHtml += `<optgroup label="🎟️ Upcoming Events">`;
                optionsHtml += activeEvents.map(e => `<option value="EVENT_${e.id}" data-type="FIXED" data-price="${e.price}">${e.name} Ticket - R${e.price.toFixed(2)}</option>`).join('');
                optionsHtml += `</optgroup>`;
            }

            // --- 📞 LEAD CAPTURE APPEND ---
            optionsHtml += `<optgroup label="👋 New Here?">`;
            optionsHtml += `<option value="CALL_ME_BACK" data-type="LEAD">📞 Call Me Back - Ready to Join</option>`;
            optionsHtml += `</optgroup>`;

            // --- 🎨 FULL UI RENDER ---
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
                    input, select { width: 100%; padding: 15px; border: 2px solid #f0f0f0; border-radius: 14px; font-size: 16px; transition: 0.2s; -webkit-appearance: none; box-sizing: border-box; }
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
                            <label>Select Item / Service</label>
                            <select name="type" id="pType" onchange="upd()" required>${optionsHtml}</select>
                        </div>
                        <div class="input-group" id="amtGroup">
                            <label>Amount (ZAR)</label>
                            <input type="number" name="amount" id="amt" placeholder="e.g. 150" min="10" required>
                        </div>
                        <div class="input-group">
                            <label>Your Details</label>
                            <input type="text" name="name" placeholder="Full Name" required style="margin-bottom:10px">
                            <input type="email" name="email" id="emailField" placeholder="Email Address (For Invoice)" required style="margin-bottom:10px">
                            <input type="tel" name="phone" placeholder="WhatsApp Number" required>
                        </div>
                        <button type="submit" id="submitBtn" class="btn" onclick="this.innerHTML='Processing...';">Proceed to Secure Pay</button>
                    </form>
                    <div class="secure-footer">🔒 Encrypted Payment via Seabe Digital</div>
                </div>
                <script>
                    function upd() {
                        const s = document.getElementById('pType');
                        const i = document.getElementById('amt');
                        const amtGroup = document.getElementById('amtGroup');
                        const emailField = document.getElementById('emailField');
                        const btn = document.getElementById('submitBtn');
                        const o = s.options[s.selectedIndex];
                        const dataType = o.getAttribute('data-type');
                        
                        if (dataType === 'FIXED') {
                            amtGroup.style.display = 'block';
                            i.value = o.getAttribute('data-price');
                            i.readOnly = true;
                            i.style.background = "#f9f9f9";
                            i.style.color = "#555";
                            i.required = true;
                            emailField.required = true;
                            btn.innerHTML = 'Proceed to Secure Pay';
                        } else if (dataType === 'LEAD') {
                            // Hide amount and adjust for Lead Capture
                            amtGroup.style.display = 'none';
                            i.value = '0'; // Hidden default to pass backend validation if needed
                            i.required = false;
                            emailField.required = false; // Email is optional for a callback
                            btn.innerHTML = 'Request Call Back';
                        } else {
                            amtGroup.style.display = 'block';
                            i.value = '';
                            i.readOnly = false;
                            i.style.background = "#fff";
                            i.style.color = "#000";
                            i.required = true;
                            emailField.required = true;
                            btn.innerHTML = 'Proceed to Secure Pay';
                        }
                    }
                    upd(); // Run on load
                </script>
            </body>
            </html>`);
        } catch (e) { 
            console.error("Link Page Error:", e);
            res.status(500).send("System Error Loading Link."); 
        }
    });

    // ==========================================
    // 2. PROCESS ROUTE (Netcash Auto-POST Compliance & Lead Routing)
    // ==========================================
    router.post('/link/:code/process', async (req, res) => {
        try {
            const { code } = req.params;
            const { amount, type, phone, email, name } = req.body; 
            const org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
            
            if (!org) return res.status(404).send("Organization not found.");

            // 1. Standardize Phone Number
            let cleanPhone = phone.replace(/\D/g, ''); 
            if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '27' + cleanPhone.substring(1);
            if (!cleanPhone.startsWith('+')) cleanPhone = '+' + cleanPhone;

            // 🚀 LEAD CAPTURE INTERCEPTOR 🚀
            if (type === 'CALL_ME_BACK') {
                const adminPhone = org.adminPhone;
                
                if (adminPhone) {
                    const cleanAdmin = adminPhone.startsWith('0') ? '27' + adminPhone.substring(1) : adminPhone.replace('+', '');
                    const alertMsg = `📢 *New Lead Alert: ${org.name}*\n\n*Name:* ${name}\n*Phone:* ${cleanPhone}\n\nThey requested a call back to join via your Seabe Pay link.`;
                    
                    try {
                        await sendWhatsApp(cleanAdmin, alertMsg);
                    } catch (err) {
                        console.error("Failed to send lead WhatsApp:", err);
                    }
                }

                // Render a success screen instead of forwarding to Netcash
                return res.send(`
                    <!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Request Received</title>
                        <style>
                            body { font-family: -apple-system, system-ui, sans-serif; background: #f4f6f8; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; }
                            .card { background: white; width: 100%; max-width: 400px; padding: 40px 30px; border-radius: 24px; box-shadow: 0 20px 40px rgba(0,0,0,0.1); text-align: center; }
                            h2 { margin: 0 0 15px 0; color: #1a1a1a; }
                            p { color: #555; line-height: 1.5; margin-bottom: 30px; }
                            .btn { padding: 15px 30px; background: #27ae60; color: white; border: none; border-radius: 16px; font-weight: 800; font-size: 16px; cursor: pointer; text-decoration: none; }
                        </style>
                    </head>
                    <body>
                        <div class="card">
                            <div style="font-size: 60px; margin-bottom: 20px;">✅</div>
                            <h2>Request Sent!</h2>
                            <p>Thank you, ${name}. We have notified the administration for <b>${org.name}</b>. Someone will contact you shortly on ${cleanPhone}.</p>
                            <a href="/link/${code}" class="btn">Return to Menu</a>
                        </div>
                    </body>
                    </html>
                `);
            }

            // ==========================================
            // NORMAL PAYMENT PROCESSING CONTINUES
            // ==========================================

            // 2. Pricing Engine Calculation
            const pricing = await calculateTransaction(amount, 'STANDARD', 'DEFAULT', false);

            // 3. Lookup Member
            const member = await prisma.member.findFirst({
                where: { phone: cleanPhone, churchCode: org.code }
            });

            // 4. Generate Reference
            const safeType = type.replace(/[^A-Z0-9_]/ig, '').substring(0, 15);
            const ref = `WEB-${code}-${safeType}-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-5)}`;

            // 5. Store Transaction
            await prisma.transaction.create({
                data: { 
                    reference: ref, 
                    amount: pricing.baseAmount, 
                    type: type, 
                    status: 'PENDING', 
                    method: 'NETCASH',
                    phone: cleanPhone, 
                    
                    church: { connect: { code: org.code } },
                    ...(member ? { member: { connect: { id: member.id } } } : {}),

                    netcashFee: pricing.netcashFee,
                    platformFee: pricing.platformFee,
                    netSettlement: pricing.netSettlement
                }
            });

            // 6. Render White-labeled Auto-POST Form
            const htmlForm = netcash.generateAutoPostForm({
                amount: pricing.totalChargedToUser,
                reference: ref,
                description: `Payment to ${org.name} (${type})`,
                phone: cleanPhone,
                email: email
            });

            res.send(htmlForm);

        } catch (e) { 
            console.error("Link Process Error:", e);
            res.status(500).send("Processing Error."); 
        }
    });

    app.use('/', router); 
};