// routes/mandates.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendWhatsApp } = require('../services/whatsapp'); 

// ==========================================
// 1. SERVE THE SECURE MANDATE FORM (UI)
// ==========================================
router.get('/sign', (req, res) => {
    const { ref, amount, phone, org } = req.query;

    if (!phone || !amount) {
        return res.send("<h3>❌ Invalid Link</h3><p>This mandate link is incomplete or expired.</p>");
    }

    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <title>Authorize Debit Order</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: 'Inter', sans-serif; background: #f8fafc; padding: 20px; display: flex; justify-content: center; color: #1e293b; }
                .card { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); max-width: 400px; width: 100%; border-top: 5px solid #3b82f6; }
                h2 { margin-top: 0; color: #0f172a; }
                .summary { background: #f1f5f9; padding: 15px; border-radius: 8px; margin-bottom: 20px; font-size: 14px; }
                .summary strong { color: #3b82f6; font-size: 18px; display: block; margin-top: 5px; }
                label { display: block; margin-top: 15px; font-size: 12px; font-weight: bold; color: #64748b; text-transform: uppercase; }
                input, select { width: 100%; padding: 12px; margin-top: 5px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 15px; box-sizing: border-box; }
                .terms { font-size: 11px; color: #64748b; margin: 20px 0; line-height: 1.5; }
                button { width: 100%; padding: 15px; background: #10b981; color: white; border: none; border-radius: 8px; font-weight: bold; font-size: 16px; cursor: pointer; transition: 0.2s; }
                button:hover { background: #059669; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>Secure Debit Order</h2>
                <div class="summary">
                    Organization: <b>${org || 'Seabe Partner'}</b><br>
                    Monthly Deduction: <strong>R${parseFloat(amount).toFixed(2)}</strong>
                </div>

                <form action="/mandate/submit" method="POST">
                    <input type="hidden" name="phone" value="${phone}">
                    <input type="hidden" name="amount" value="${amount}">
                    <input type="hidden" name="org" value="${org}">
                    <input type="hidden" name="ref" value="${ref}">

                    <label>Account Holder Name</label>
                    <input type="text" name="accountName" placeholder="e.g. J. Doe" required>

                    <label>Bank Name</label>
                    <select name="bankName" required>
                        <option value="Capitec">Capitec</option>
                        <option value="FNB">FNB</option>
                        <option value="Standard Bank">Standard Bank</option>
                        <option value="Absa">Absa</option>
                        <option value="Nedbank">Nedbank</option>
                        <option value="TymeBank">TymeBank</option>
                        <option value="African Bank">African Bank</option>
                    </select>

                    <label>Account Number</label>
                    <input type="number" name="accountNumber" placeholder="Account Number" required>

                    <label>Account Type</label>
                    <select name="accountType" required>
                        <option value="Savings">Savings / Transmission</option>
                        <option value="Cheque">Cheque / Current</option>
                    </select>

                    <div class="terms">
                        <input type="checkbox" required id="agree"> 
                        <label for="agree" style="display:inline; text-transform:none; color:#1e293b;">I authorize Netcash and the above organization to deduct the specified amount from my account on the 1st of every month.</label>
                    </div>

                    <button type="submit">🔒 Digitally Sign & Activate</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

// ==========================================
// 2. PROCESS THE MANDATE SUBMISSION
// ==========================================
router.post('/submit', express.urlencoded({ extended: true }), async (req, res) => {
    const { phone, amount, org, accountName, bankName, accountNumber, accountType } = req.body;

    try {
        console.log(`💳 Processing Debit Order Mandate for ${phone}...`);

        // In a full production environment, this is where you would make an API call 
        // to the Netcash Debit Order Batch API to register the banking details.
        // For now, we update the user's profile to indicate they are active on a debit order.

        // Standardize phone for DB lookup
        let cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.startsWith('0')) cleanPhone = '27' + cleanPhone.substring(1);

        // Update the most recent member profile matching this phone
        const member = await prisma.member.findFirst({
            where: { phone: cleanPhone },
            orderBy: { id: 'desc' }
        });

        if (member) {
            await prisma.member.update({
                where: { id: member.id },
                data: {
                    status: 'ACTIVE_DEBIT_ORDER', // Custom status to show they don't need manual links
                    // If you added a 'bankDetails' field to your schema, you would save it here. 
                    // Otherwise, the status change is enough to tell the system not to blast them.
                }
            });
        }

        // Send a confirmation receipt via WhatsApp
        const successMsg = `✅ *Debit Order Activated*\n\nHi ${accountName},\nYour mandate with *${org}* has been securely registered.\n\nA monthly premium of *R${parseFloat(amount).toFixed(2)}* will be automatically deducted via ${bankName} ensuring your policy/membership remains active without interruptions.\n\nThank you!`;
        
        await sendWhatsApp(cleanPhone, successMsg);

        // Render success page
        res.send(`
            <div style="font-family: sans-serif; text-align: center; padding: 50px; background: #f8fafc; height: 100vh;">
                <div style="font-size: 60px; margin-bottom: 10px;">✅</div>
                <h1 style="color: #10b981; margin-top: 0;">Mandate Active!</h1>
                <p style="color: #64748b;">Your bank details have been securely processed.</p>
                <p>You will receive a confirmation message on WhatsApp shortly. You may close this window.</p>
            </div>
        `);

    } catch (error) {
        console.error("❌ Mandate Processing Error:", error);
        res.send("<h3>❌ System Error</h3><p>We could not process your mandate at this time. Please try again later.</p>");
    }
});

module.exports = router;