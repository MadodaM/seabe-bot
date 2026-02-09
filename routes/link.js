// routes/link.js - FULLY CORRECTED FILE

const express = require('express');                 // Line 1: Import Express
const router = express.Router();                    // Line 2: Create the Router (Fixes your error!)
const { createPaymentLink } = require('../services/paystack'); // Line 3: Import Payment Logic

module.exports = (app, { prisma }) => {

    // 1. THE PUBLIC LANDING PAGE
    router.get('/link/:code', async (req, res) => {
        try {
            const { code } = req.params;
            
            // Fetch Organization details
            const org = await prisma.church.findUnique({
                where: { code: code.toUpperCase() },
                include: { events: { where: { status: 'Active' } } }
            });

            if (!org) return res.status(404).send("Organization not found.");

            // --- 💡 DYNAMIC PAYMENT OPTIONS LOGIC ---
            let optionsHtml = '';
            let amountPlaceholder = 'e.g. 100';
            let amountLabel = 'Amount (ZAR)';

            if (org.type === 'BURIAL_SOCIETY') {
                // 🛡️ SCENARIO A: BURIAL SOCIETY
                const fee = org.subscriptionFee || 150;
                amountPlaceholder = `e.g. ${fee}`;
                amountLabel = 'Payment Amount';

                optionsHtml = `
                    <option value="PREM">Monthly Premium (R${fee}) 🛡️</option>
                    <option value="JOIN_FEE">Joining Fee 📝</option>
                    <option value="ARREARS">Arrears / Late Payment ⚠️</option>
                    <option value="DONATION">General Donation 🤝</option>
                `;
            } else {
                // ⛪ SCENARIO B: CHURCH
                optionsHtml = `
                    <option value="OFFERING" selected>General Offering 🎁</option>
                    <option value="TITHE">Tithe (10%) 🏛️</option>
                    <option value="THANKSGIVING">Thanksgiving 🙏</option>
                    <option value="BUILDING">Building Fund 🧱</option>
                    <option value="SEED">Seed Faith 🌱</option>
                `;
            }

            // --- COMMON: ADD EVENTS ---
            if (org.events.length > 0) {
                optionsHtml += `<optgroup label="Events">`;
                org.events.forEach(e => {
                    optionsHtml += `<option value="EVENT_${e.id}">${e.name} (R${e.price}) 🎟️</option>`;
                });
                optionsHtml += `</optgroup>`;
            }

            // --- RENDER HTML ---
            res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Pay ${org.name}</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f4f6f8; padding: 20px; display: flex; justify-content: center; min-height: 100vh; margin: 0; }
                    .card { background: white; width: 100%; max-width: 400px; padding: 30px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); height: fit-content; }
                    .input-group { margin-bottom: 15px; text-align: left; }
                    label { display: block; font-weight: 600; margin-bottom: 5px; font-size: 12px; color: #555; text-transform: uppercase; }
                    input, select { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; box-sizing: border-box; font-size: 16px; }
                    .btn { width: 100%; padding: 15px; background: #000; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 16px; margin-top: 10px; }
                    .btn:hover { opacity: 0.9; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div style="text-align: center; font-size: 40px; margin-bottom: 10px;">
                        ${org.type === 'BURIAL_SOCIETY' ? '🛡️' : '⛪'}
                    </div>
                    <h2 style="text-align: center; margin-top: 0; margin-bottom: 5px;">${org.name}</h2>
                    <p style="text-align: center; color: #666; font-size: 14px; margin-bottom: 25px;">Secure Payment Portal</p>

                    <form action="/link/${code}/process" method="POST">
                        <div class="input-group">
                            <label>${amountLabel}</label>
                            <input type="number" name="amount" placeholder="${amountPlaceholder}" required>
                        </div>

                        <div class="input-group">
                            <label>Payment For</label>
                            <select name="type">
                                ${optionsHtml}
                            </select>
                        </div>

                        <div class="input-group">
                            <label>Your Name</label>
                            <input type="text" name="name" placeholder="Full Name" required>
                        </div>
                        
                        <div class="input-group">
                            <label>Contact Info</label>
                            <input type="email" name="email" placeholder="Email Address" required>
                            <input type="tel" name="phone" placeholder="WhatsApp Number" required>
                        </div>

                        <button type="submit" class="btn">Proceed to Pay</button>
                    </form>
                    
                    <div style="text-align: center; margin-top: 20px; font-size: 11px; color: #999;">
                        🔒 Secured by Paystack via Seabe
                    </div>
                </div>
            </body>
            </html>
            `);

        } catch (e) {
            console.error(e);
            res.status(500).send("System Error");
        }
    });

    // 2. PROCESS PAYMENT ROUTE
    router.post('/link/:code/process', async (req, res) => {
        try {
            const { code } = req.params;
            const { amount, type, name, email, phone } = req.body;
            
            const org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
            if (!org) return res.send("Error: Org not found.");

            const cleanPhone = phone.replace(/\D/g, ''); 
            const ref = `WEB-${code}-${type}-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-5)}`;

            // Call Paystack Service
            const link = await createPaymentLink(amount, ref, email, org.subaccountCode, cleanPhone, org.name);

            if (link) {
                // Upsert Member (Create if new, update if exists)
                await prisma.member.upsert({
                    where: { phone: cleanPhone },
                    update: { email: email, firstName: name.split(' ')[0], lastName: name.split(' ')[1] || '' }, 
                    create: { 
                        phone: cleanPhone, 
                        firstName: name.split(' ')[0], 
                        lastName: name.split(' ')[1] || 'Guest',
                        email: email,
                        // Auto-link to the organization
                        ...(org.type === 'CHURCH' ? { churchCode: org.code } : { societyCode: org.code })
                    }
                });

                // Record Transaction
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

                res.redirect(link);
            } else {
                res.send("Error creating payment link.");
            }

        } catch (e) {
            console.error("Web Payment Error:", e);
            res.send("System Error Processing Payment");
        }
    });

    // Mount the router
    app.use('/', router);
};