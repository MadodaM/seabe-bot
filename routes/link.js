// routes/link.js
const axios = require('axios');

module.exports = (app, { prisma }) => {

    // ==========================================
    // 1. THE LANDING PAGE (GET)
    // URL: https://your-app.onrender.com/link/AFM
    // ==========================================
    app.get('/link/:code', async (req, res) => {
        try {
            const orgCode = req.params.code.toUpperCase();

            // 1. Find the Organization
            const org = await prisma.church.findUnique({
                where: { code: orgCode }
            });

            if (!org) {
                return res.status(404).send("<h1>🚫 Organization Not Found</h1><p>Please check the code and try again.</p>");
            }

            // 2. Determine Labels (Church vs Society)
            const isSociety = org.type === 'BURIAL_SOCIETY';
            const bgColor = isSociety ? '#1e293b' : '#3b82f6'; // Dark Blue for Society, Bright Blue for Church
            const typeLabel = isSociety ? 'Payment Type (e.g., Premium)' : 'Offering Type (e.g., Tithe)';
            
            // 3. Render the HTML Page (Server-Side)
            const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>Pay ${org.name}</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f3f4f6; display: flex; justify-content: center; padding: 20px; }
                    .card { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); width: 100%; max-width: 400px; }
                    .header { text-align: center; margin-bottom: 20px; }
                    .badge { background: ${bgColor}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; text-transform: uppercase; }
                    h2 { margin: 10px 0 5px; color: #111827; }
                    p { color: #6b7280; font-size: 14px; margin: 0; }
                    label { display: block; margin-top: 15px; font-size: 14px; font-weight: 600; color: #374151; }
                    input, select { width: 100%; padding: 10px; margin-top: 5px; border: 1px solid #d1d5db; border-radius: 6px; box-sizing: border-box; font-size: 16px; }
                    button { width: 100%; background: ${bgColor}; color: white; padding: 12px; border: none; border-radius: 6px; font-size: 16px; font-weight: bold; cursor: pointer; margin-top: 25px; transition: opacity 0.2s; }
                    button:hover { opacity: 0.9; }
                    .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #9ca3af; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="header">
                        <span class="badge">${isSociety ? '🛡️ Burial Society' : '⛪ Church'}</span>
                        <h2>${org.name}</h2>
                        <p>Secure Payment Portal</p>
                    </div>

                    <form action="/link/process" method="POST">
                        <input type="hidden" name="orgCode" value="${org.code}">
                        
                        <label>Your Phone Number</label>
                        <input type="tel" name="phone" placeholder="e.g. 0831234567" required>

                        <label>Amount (ZAR)</label>
                        <input type="number" name="amount" placeholder="e.g. 100" min="10" required>

                        <label>${typeLabel}</label>
                        <select name="type">
                            <option value="Offering">Offering</option>
                            <option value="Tithe">Tithe</option>
                            <option value="Donation">Donation</option>
                            <option value="Premium">Premium</option>
                            <option value="Joining Fee">Joining Fee</option>
                        </select>

                        <button type="submit">🔒 Pay Now</button>
                    </form>

                    <div class="footer">
                        Powered by <strong>Seabe Pay</strong>
                    </div>
                </div>
            </body>
            </html>
            `;

            res.send(html);

        } catch (e) {
            console.error(e);
            res.status(500).send("Server Error");
        }
    });

    // ==========================================
    // 2. PROCESS THE PAYMENT (POST)
    // ==========================================
    app.post('/link/process', async (req, res) => {
        try {
            const { orgCode, phone, amount, type } = req.body;
            
            // 1. Fetch Org for Subaccount
            const org = await prisma.church.findUnique({ where: { code: orgCode } });
            if (!org) return res.status(404).send("Organization not found");

            // 2. Format Phone
            let cleanPhone = phone.replace(/\s/g, '');
            if (cleanPhone.startsWith('0')) cleanPhone = '27' + cleanPhone.substring(1);

            // 3. Create Paystack Reference
            const reference = `WEB-${orgCode}-${Date.now()}`; // Unique Web Ref

            // 4. Record 'PENDING' Transaction in DB
            await prisma.transaction.create({
                data: {
                    amount: parseFloat(amount),
                    type: type,
                    reference: reference,
                    status: 'PENDING',
                    churchCode: orgCode,
                    phone: cleanPhone,
                    method: 'WEB_LINK' // Tracks that this came from the website, not WhatsApp
                }
            });

            // 5. Initialize Paystack
            const payload = {
                amount: parseFloat(amount) * 100, // Cents
                email: `${cleanPhone}@seabe.io`, // Dummy email for Paystack requirements
                reference: reference,
                currency: 'ZAR',
                callback_url: `https://${req.get('host')}/payment-success`, // Redirect here after pay
                metadata: {
                    phone: cleanPhone,
                    source: 'web_portal',
                    org: org.name
                }
            };

            // Add Subaccount (Split Payment) if it exists
            if (org.subaccountCode) {
                payload.subaccount = org.subaccountCode;
                payload.transaction_charge = 250; // Seabe Fee (R2.50)
                payload.bearer = 'subaccount'; // Org pays the fee
            }

            const response = await axios.post('https://api.paystack.co/transaction/initialize', payload, {
                headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
            });

            // 6. Redirect User to Paystack Checkout
            res.redirect(response.data.data.authorization_url);

        } catch (e) {
            console.error("Link Payment Error:", e.response?.data || e.message);
            res.status(500).send("Could not initialize payment. Please try again.");
        }
    });
};