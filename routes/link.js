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
                // We show "Premium" and "Joining Fee"
                // We also pre-fill the placeholder with their subscription fee if it exists
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
                // We show "Tithe" and "Offering"
                optionsHtml = `
                    <option value="OFFERING" selected>General Offering 🎁</option>
                    <option value="TITHE">Tithe (10%) 🏛️</option>
                    <option value="THANKSGIVING">Thanksgiving 🙏</option>
                    <option value="BUILDING">Building Fund 🧱</option>
                    <option value="SEED">Seed Faith 🌱</option>
                `;
            }

            // --- COMMON: ADD EVENTS FOR EVERYONE ---
            // If they have concert tickets, add them to the bottom of the list
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
                    /* Minimal CSS reset for brevity */
                    body { font-family: sans-serif; background: #f4f6f8; padding: 20px; display: flex; justify-content: center; }
                    .card { background: white; width: 100%; max-width: 400px; padding: 30px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
                    .input-group { margin-bottom: 15px; text-align: left; }
                    label { display: block; font-weight: bold; margin-bottom: 5px; font-size: 12px; color: #555; }
                    input, select { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; box-sizing: border-box; }
                    .btn { width: 100%; padding: 15px; background: #000; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div style="text-align: center; font-size: 40px; margin-bottom: 10px;">
                        ${org.type === 'BURIAL_SOCIETY' ? '🛡️' : '⛪'}
                    </div>
                    <h2 style="text-align: center; margin-top: 0;">${org.name}</h2>
                    <p style="text-align: center; color: #666; font-size: 14px;">Secure Payment Portal</p>

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