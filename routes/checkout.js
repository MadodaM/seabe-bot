// routes/checkout.js
// The Smart Routing Checkout Portal (TPPP Model)
const express = require('express');
const router = express.Router();
const prisma = require('../services/db');

// Threshold for High-Value Collections (ZAR)
const HIGH_VALUE_THRESHOLD = 3000;

// YOUR MASTER TPPP CREDENTIALS (Loaded from .env)
const MASTER_PAYFAST_MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID || '10000100';
const MASTER_PAYFAST_MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY || '46f0cd694581a';
const MASTER_NETCASH_PAYNOW_KEY = process.env.NETCASH_MASTER_KEY || '1234-5678-9012';

router.get('/pay/:code', async (req, res) => {
    try {
        const org = await prisma.church.findUnique({ 
            where: { code: req.params.code.toUpperCase() } 
        });

        if (!org) return res.send("<h1>Organization Not Found</h1>");

        // The Smart UI Interface
        const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Secure Payment | ${org.name}</title>
            <style>
                body { font-family: -apple-system, sans-serif; background: #f4f7f6; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
                .checkout-card { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 10px 40px rgba(0,0,0,0.08); width: 100%; max-width: 400px; }
                .org-header { text-align: center; margin-bottom: 30px; }
                .org-header h2 { margin: 0; color: #2c3e50; font-size: 24px; }
                .org-header p { margin: 5px 0 0 0; color: #7f8c8d; font-size: 14px; }
                
                .input-group { margin-bottom: 25px; }
                .input-group label { display: block; font-size: 12px; font-weight: bold; color: #7f8c8d; text-transform: uppercase; margin-bottom: 8px; }
                .amount-wrapper { position: relative; display: flex; align-items: center; }
                .amount-wrapper span { position: absolute; left: 15px; font-size: 24px; font-weight: bold; color: #2c3e50; }
                .amount-wrapper input { width: 100%; padding: 15px 15px 15px 45px; font-size: 24px; font-weight: bold; border: 2px solid #ddd; border-radius: 8px; outline: none; box-sizing: border-box; transition: 0.3s; }
                .amount-wrapper input:focus { border-color: #00d2d3; }
                
                .gateway-options { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; }
                .gw-btn { border: 2px solid #eee; background: white; padding: 15px 10px; border-radius: 8px; cursor: pointer; text-align: center; transition: 0.2s; }
                .gw-btn.active { border-color: #00d2d3; background: #f0fdfa; }
                .gw-btn.disabled { opacity: 0.4; cursor: not-allowed; filter: grayscale(100%); }
                .gw-btn strong { display: block; font-size: 14px; color: #2c3e50; margin-bottom: 4px; }
                .gw-btn small { font-size: 11px; color: #7f8c8d; }
                
                .smart-routing-badge { background: #fffbe6; border-left: 4px solid #f39c12; padding: 12px; font-size: 12px; color: #d35400; border-radius: 4px; margin-bottom: 20px; display: none; line-height: 1.5; }
                
                .submit-btn { width: 100%; padding: 18px; background: #1e272e; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; transition: 0.3s; }
                .submit-btn:hover { background: #00d2d3; color: #1e272e; }
                
                .tppp-footer { text-align: center; margin-top: 20px; font-size: 10px; color: #aaa; }
            </style>
        </head>
        <body>
            <div class="checkout-card">
                <div class="org-header">
                    <h2>${org.name}</h2>
                    <p>Secure Payment Portal</p>
                </div>
                
                <form action="/api/checkout/process" method="POST">
                    <input type="hidden" name="orgCode" value="${org.code}">
                    <input type="hidden" id="selectedGateway" name="gateway" value="PAYFAST">

                    <div class="input-group">
                        <label>Payment Amount</label>
                        <div class="amount-wrapper">
                            <span>R</span>
                            <input type="number" id="amountInput" name="amount" placeholder="0.00" required autofocus>
                        </div>
                    </div>

                    <div class="input-group">
                        <label>Your Details</label>
                        <input type="text" name="name" placeholder="Full Name" required style="width:100%; padding:12px; border:2px solid #ddd; border-radius:8px; margin-bottom:10px; box-sizing: border-box;">
                        <input type="text" name="phone" placeholder="WhatsApp Number" required style="width:100%; padding:12px; border:2px solid #ddd; border-radius:8px; box-sizing: border-box;">
                    </div>

                    <label style="display: block; font-size: 12px; font-weight: bold; color: #7f8c8d; text-transform: uppercase; margin-bottom: 8px;">Payment Method</label>
                    <div class="gateway-options">
                        <div id="opt-payfast" class="gw-btn active" onclick="selectGateway('PAYFAST')">
                            <strong>💳 Card / Apple Pay</strong>
                            <small>Instant Clearance</small>
                        </div>
                        <div id="opt-netcash" class="gw-btn" onclick="selectGateway('NETCASH')">
                            <strong>🏦 Secure EFT</strong>
                            <small>Direct Bank Transfer</small>
                        </div>
                    </div>

                    <div id="highValueBadge" class="smart-routing-badge">
                        <strong>🛡️ Smart Routing Activated:</strong><br>
                        To protect ${org.name} from excessive credit card processing fees on large amounts, this transaction has been securely routed via Bank EFT.
                    </div>

                    <button type="submit" id="payBtn" class="submit-btn">Proceed to Payment</button>
                </form>
                
                <div class="tppp-footer">
                    Payments securely processed by Seabe Digital on behalf of ${org.name}.
                </div>
            </div>

            <script>
                const amountInput = document.getElementById('amountInput');
                const optPayfast = document.getElementById('opt-payfast');
                const optNetcash = document.getElementById('opt-netcash');
                const selectedGateway = document.getElementById('selectedGateway');
                const highValueBadge = document.getElementById('highValueBadge');
                const payBtn = document.getElementById('payBtn');
                
                const THRESHOLD = ${HIGH_VALUE_THRESHOLD};

                // The Smart Routing Logic
                amountInput.addEventListener('input', (e) => {
                    const val = parseFloat(e.target.value) || 0;
                    payBtn.innerText = val > 0 ? \`Pay R \${val.toFixed(2)}\` : 'Proceed to Payment';

                    if (val >= THRESHOLD) {
                        // High Value: Disable Payfast, Force Netcash
                        optPayfast.classList.add('disabled');
                        optPayfast.classList.remove('active');
                        optNetcash.classList.add('active');
                        selectedGateway.value = 'NETCASH';
                        highValueBadge.style.display = 'block';
                    } else {
                        // Normal Value: Allow both, default to Payfast
                        optPayfast.classList.remove('disabled');
                        if(selectedGateway.value === 'PAYFAST') {
                            optPayfast.classList.add('active');
                            optNetcash.classList.remove('active');
                        }
                        highValueBadge.style.display = 'none';
                    }
                });

                function selectGateway(gw) {
                    const val = parseFloat(amountInput.value) || 0;
                    if (gw === 'PAYFAST' && val >= THRESHOLD) return;

                    selectedGateway.value = gw;
                    if (gw === 'PAYFAST') {
                        optPayfast.classList.add('active');
                        optNetcash.classList.remove('active');
                    } else {
                        optNetcash.classList.add('active');
                        optPayfast.classList.remove('active');
                    }
                }
            </script>
        </body>
        </html>
        `;
        res.send(html);
    } catch (e) {
        res.status(500).send("Error loading checkout: " + e.message);
    }
});

// The Payment Processor Switch (Master Routing)
router.post('/api/checkout/process', async (req, res) => {
    try {
        const { orgCode, amount, name, phone, gateway } = req.body;
        
        // 1. Generate an internal tracking ID
        const internalTxRef = `TX-${Date.now().toString().slice(-6)}`;

        // 2. Log the pending transaction in the ledger, tagged to this specific organization
        const tx = await prisma.transaction.create({
            data: {
                churchCode: orgCode,
                amount: parseFloat(amount),
                gateway: gateway,
                status: 'PENDING',
                reference: internalTxRef,
                phone: phone
            }
        });

        // 3. The Dynamic Master Switch
        if (gateway === 'PAYFAST') {
            console.log(`Routing ${internalTxRef} to Master Payfast Engine...`);
            
            // In production, we construct the Payfast HTML form here using the Master Keys.
            // Crucially, we pass `internalTxRef` as the `m_payment_id` and `orgCode` as `custom_str1`
            // so the Payfast ITN Webhook knows exactly which church to credit the money to.
            
            res.send(`
                <h3 style="font-family:sans-serif; text-align:center; margin-top:50px;">Redirecting to Payfast Checkout...</h3>
                <p style="font-family:sans-serif; text-align:center; color:#666;">(Production will Auto-Post to Payfast with Tracking ID: ${internalTxRef})</p>
            `);
        } else {
            console.log(`Routing ${internalTxRef} to Master Netcash Engine...`);
            
            // In production, we construct the Netcash PayNow link using our Master PayNow Key.
            // We pass `internalTxRef` as the `Reference` and `orgCode` as `Extra1`.
            
            res.send(`
                <h3 style="font-family:sans-serif; text-align:center; margin-top:50px;">Redirecting to Netcash Secure EFT...</h3>
                <p style="font-family:sans-serif; text-align:center; color:#666;">(Production will Auto-Post to Netcash with Tracking ID: ${internalTxRef})</p>
            `);
        }

    } catch (e) {
        res.status(500).send("Error processing request.");
    }
});

module.exports = router;