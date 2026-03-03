// routes/mandates.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendWhatsApp } = require('../services/whatsapp'); 
const axios = require('axios'); // 🚀 NEW: Required for Netcash API calls

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

                    <label>ID Number</label>
                    <input type="number" name="idNumber" placeholder="13-Digit SA ID" required>

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

                    <button type="submit">🔒 Authenticate Mandate</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

// ==========================================
// 2. PROCESS THE MANDATE SUBMISSION (DEBICHECK TT1)
// ==========================================
router.post('/submit', express.urlencoded({ extended: true }), async (req, res) => {
    const { phone, amount, org, accountName, idNumber, bankName, accountNumber, accountType } = req.body;

    try {
        console.log(`💳 Initiating DebiCheck TT1 Push for ${phone}...`);
        
        // 1. Clean data for Netcash
        let cleanPhone = phone.replace(/\D/g, '');
        let cleanPhoneForDB = cleanPhone;
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) {
            cleanPhoneForDB = '27' + cleanPhone.substring(1);
        } else if (cleanPhone.startsWith('27')) {
            cleanPhone = '0' + cleanPhone.substring(2); // Netcash XML prefers local 082... format for mobile
        }
        
        const cleanAmount = parseFloat(amount).toFixed(2);
        
        // Map Banks to Universal Branch Codes (South African Standard)
        const branchCodes = {
            'Capitec': '470010', 'FNB': '250655', 'Standard Bank': '051001', 
            'Absa': '632005', 'Nedbank': '198765', 'TymeBank': '678910', 'African Bank': '430000'
        };
        const branchCode = branchCodes[bankName] || '000000';
        
        // Map Account Type (1 = Current/Cheque, 2 = Savings)
        const accTypeCode = accountType === 'Cheque' ? '1' : '2';

        // 2. Build the Netcash TT1 XML Payload
        const xmlPayload = `
            <DebiCheckAuthenticate>
                <MethodParameters>
                    <ServiceKey>${process.env.NETCASH_DEBIT_ORDER_KEY || 'TEST_KEY'}</ServiceKey>
                    <AccountReference>${cleanPhone}</AccountReference>
                    <DebiCheckMandateTemplateId>${process.env.NETCASH_DEBICHECK_TEMPLATE_ID || 'TEST_TEMPLATE'}</DebiCheckMandateTemplateId>
                    <IsIdNumber>1</IsIdNumber>
                    <DebtorIdentification>${idNumber || '0000000000000'}</DebtorIdentification>
                    <AccountName>${accountName}</AccountName>
                    <BankAccountName>${accountName}</BankAccountName>
                    <BranchCode>${branchCode}</BranchCode>
                    <BankAccountNumber>${accountNumber}</BankAccountNumber>
                    <BankAccountType>${accTypeCode}</BankAccountType>
                    <MobileNumber>${cleanPhone}</MobileNumber>
                    <CollectionAmount>${cleanAmount}</CollectionAmount>
                    <FirstCollectionDiffers>0</FirstCollectionDiffers>
                    <FirstCollectionAmount>${cleanAmount}</FirstCollectionAmount>
                    <FirstCollectionDate>20260401</FirstCollectionDate>
                    <collectionDayCode>01</collectionDayCode>
                </MethodParameters>
            </DebiCheckAuthenticate>
        `;

        // 3. Fire to Netcash API (NIWS_NIF endpoint)
        const netcashResponse = await axios.post('https://ws.netcash.co.za/NIWS/NIWS_NIF.svc', xmlPayload, {
            headers: { 'Content-Type': 'text/xml' }
        });

        // 4. Handle Response
        if (netcashResponse.data.includes('<ErrorCode>000</ErrorCode>')) {
            
            // Mark user as PENDING_MANDATE while they approve the USSD
            await prisma.member.updateMany({
                where: { phone: cleanPhoneForDB }, 
                data: { status: 'PENDING_MANDATE' }
            });

            // Send a WhatsApp prompt so they know what to look for
            const promptMsg = `📱 *DebiCheck Request Sent*\n\nWe have requested authorization for your R${cleanAmount} monthly mandate.\n\n*Action Required:*\nPlease open your ${bankName} app now or check for a pop-up on your phone to approve the mandate!`;
            await sendWhatsApp(cleanPhoneForDB, promptMsg);

            // Render UI Success
            res.send(`
                <div style="font-family: sans-serif; text-align: center; padding: 50px; background: #f8fafc; height: 100vh;">
                    <div style="font-size: 60px; margin-bottom: 10px;">📱</div>
                    <h1 style="color: #3b82f6; margin-top: 0;">Check your Banking App!</h1>
                    <p style="color: #64748b; font-size: 18px;">We have sent a secure DebiCheck request to your phone.</p>
                    <p><strong>Please open your ${bankName} app or check your USSD pop-up to authorize the mandate.</strong></p>
                    <p style="font-size: 12px; margin-top: 40px; color: #94a3b8;">You may close this window.</p>
                </div>
            `);
        } else {
            // Netcash returned a failure code (e.g., invalid account length)
            throw new Error(`Netcash rejected the payload: ${netcashResponse.data}`);
        }

    } catch (error) {
        console.error("❌ DebiCheck Processing Error:", error.message);
        res.send("<h3>❌ Verification Failed</h3><p>We could not verify these details with your bank. Please check your account number and try again.</p>");
    }
});

module.exports = router;