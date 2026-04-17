	// routes/paymentRoutes.js
	const express = require('express');
	const router = express.Router();
	const { PrismaClient } = require('@prisma/client');
	const prisma = new PrismaClient();
	const { recordSplit } = require('../services/ledgerEngine');
	const { calculateTransaction } = require('../services/pricingEngine');
		const crypto = require('crypto');
	const SECRET_KEY = crypto.scryptSync(process.env.TWILIO_AUTH || 'seabe-fallback-key', 'seabe-salt', 32);

	// Decryption Helper
	function decryptToken(token) {
		try {
			const [iv64, enc64] = token.split('.');
			const iv = Buffer.from(iv64, 'base64url');
			const decipher = crypto.createDecipheriv('aes-256-cbc', SECRET_KEY, iv);
			let decrypted = decipher.update(enc64, 'base64url', 'utf8');
			decrypted += decipher.final('utf8');
			return JSON.parse(decrypted);
		} catch (e) { return null; }
	}
	
	// Twilio Setup
	let client;
	if (process.env.TWILIO_SID && process.env.TWILIO_AUTH) {
		client = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
	}

	// 🚀 GATEWAY: Exclusively Netcash
	const netcash = require('../services/netcash');

	// Utility: Phone Formatter
	const formatPhone = (phone) => {
		if (!phone) return "";
		let clean = phone.replace(/\D/g, '');
		if (clean.startsWith('0')) clean = '27' + clean.slice(1);
		return '+' + clean;
	};

	// 🎨 Reusable CSS & Template for a premium Seabe Pay feel
	const seabeStyles = `
		:root { --primary: #14b8a6; --danger: #e74c3c; --bg: #f4f7f6; --text: #2c3e50; }
		body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 100vh; margin: 0; text-align: center; padding: 20px; }
		.card { background: white; padding: 40px 30px; border-radius: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.08); max-width: 400px; width: 100%; }
		.icon { font-size: 64px; margin-bottom: 20px; }
		h1 { margin: 0 0 10px 0; font-size: 24px; font-weight: 800; }
		p { color: #7f8c8d; line-height: 1.5; margin-bottom: 30px; font-size: 15px; }
		.btn { background: var(--primary); color: white; border: none; padding: 16px 24px; border-radius: 12px; font-size: 16px; font-weight: bold; width: 100%; cursor: pointer; text-decoration: none; display: inline-block; box-sizing: border-box; }
		.btn-outline { background: transparent; color: var(--text); border: 2px solid #e0e6ed; margin-top: 10px; }
		.seabe-brand { font-size: 14px; font-weight: 800; color: #b2bec3; margin-top: 30px; text-transform: uppercase; letter-spacing: 1px; }
		.seabe-brand span { color: var(--primary); }
		/* Dynamic Inputs */
		.input-group { text-align: left; margin-bottom: 20px; }
		.input-group label { font-size: 12px; font-weight: bold; color: #95a5a6; text-transform: uppercase; }
		.currency-wrapper { display: flex; align-items: center; margin-top: 5px; }
		.currency-wrapper span { background: #eee; padding: 15px; border-radius: 8px 0 0 8px; font-weight: bold; color: #333; border: 1px solid #ccc; border-right: none; }
		.currency-wrapper input { flex: 1; padding: 15px; border: 1px solid #ccc; border-radius: 0 8px 8px 0; font-size: 18px; font-weight: bold; outline: none; }
		.tag { background: #fce4ec; color: #e91e63; padding: 5px 10px; border-radius: 20px; font-size: 12px; font-weight: bold; text-transform: uppercase; display: inline-block; margin-bottom: 15px; }
	`;

	const renderPage = (title, icon, heading, message, isError = false) => `
		<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>${title}</title>
			<style>
				${seabeStyles}
				${isError ? '.icon { filter: grayscale(100%); } .btn { background: var(--danger); }' : ''}
			</style>
		</head>
		<body>
			<div class="card">
				<div class="icon">${icon}</div>
				<h1>${heading}</h1>
				<p>${message}</p>
				<a href="https://wa.me/27832182707" class="btn">Return to WhatsApp</a>
				<button onclick="window.close()" class="btn btn-outline">Close Window</button>
			</div>
			<div class="seabe-brand">Secured by Seabe <span>Pay</span></div>
		</body>
		</html>
	`;

	// ============================================================
	// 💰 PUBLIC PAYMENT PORTAL (Smart Context-Aware Checkout)
	// ============================================================

	// 1. Render the Payment Input Screen
	router.get('/pay', async (req, res) => {
		try {
			// 🚀 UPDATED: Grab targetIds and type
			const { memberId, code, apptId, amount, targetIds, type } = req.query;

			// ----------------------------------------------------
			// SCENARIO A: SALON / APPOINTMENT DEPOSIT
			// ----------------------------------------------------
			if (apptId) {
				const appointment = await prisma.appointment.findUnique({
					where: { id: parseInt(apptId) },
					include: { church: true, product: true, member: true }
				});

				if (!appointment) return res.send(renderPage('Error', '⚠️', 'Not Found', 'Appointment not found.', true));

				const org = appointment.church;
				const depositAmount = amount || (appointment.product.price * 0.25).toFixed(2);

				return res.send(`
					<!DOCTYPE html>
					<html>
					<head>
						<meta name="viewport" content="width=device-width, initial-scale=1">
						<title>Deposit - ${org.name}</title>
						<style>${seabeStyles}</style>
					</head>
					<body>
						<div class="card">
							<div class="tag">SECURE DEPOSIT</div>
							<h2>${org.name}</h2>
							<p style="margin-bottom: 20px;">Lock in your appointment for: <br><b>${appointment.product.name}</b></p>
							
							<form action="/pay/process" method="POST">
								<input type="hidden" name="apptId" value="${appointment.id}">
								
								<div class="input-group">
									<label>Deposit Amount</label>
									<div class="currency-wrapper">
										<span>ZAR</span>
										<input type="number" name="amount" step="0.01" value="${depositAmount}" readonly style="background:#f8f9fa; color:#7f8c8d;">
									</div>
								</div>
								
								<button type="submit" class="btn">Pay Deposit via Netcash</button>
							</form>
							<div style="margin-top: 15px; font-size: 11px; color: #95a5a6;">🔒 Secured by Netcash & Capitec Pay</div>
						</div>
						<div class="seabe-brand">Secured by Seabe <span>Pay</span></div>
					</body>
					</html>
				`);
			}

			// ----------------------------------------------------
            // 🚀 NEW SCENARIO B: LWAZI MULTI-SUBSCRIPTION (ENCRYPTED)
            // ----------------------------------------------------
            if (req.query.token) {
                const data = decryptToken(req.query.token);
                if (!data) return res.send(renderPage('Error', '⚠️', 'Invalid Link', 'This secure payment link is corrupted or invalid.', true));

                const payer = await prisma.member.findUnique({ where: { id: data.p } });
                if (!payer) return res.send(renderPage('Error', '⚠️', 'Not Found', 'Payer profile not found.', true));

                return res.send(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta name="viewport" content="width=device-width, initial-scale=1">
                        <title>Lwazi Premium Setup</title>
                        <style>${seabeStyles}</style>
                    </head>
                    <body>
                        <div class="card">
                            <div class="tag">EDUCATION</div>
                            <h2>Lwazi Premium</h2>
                            <p style="margin-bottom: 20px;">Secure Auto-Renewing Subscription</p>
                            
                            <form action="/pay/process" method="POST">
                                <input type="hidden" name="token" value="${req.query.token}">
                                
                                <div class="input-group">
                                    <label>Total Monthly Amount</label>
                                    <div class="currency-wrapper">
                                        <span>ZAR</span>
                                        <input type="number" value="${data.a}" readonly style="background:#f8f9fa; color:#7f8c8d;">
                                    </div>
                                </div>
                                
                                <button type="submit" class="btn">Start Subscription</button>
                            </form>
                            <div style="margin-top: 15px; font-size: 11px; color: #95a5a6;">🔒 Secured by Netcash & AES-256 Encryption</div>
                        </div>
                        <div class="seabe-brand">Secured by Seabe <span>Pay</span></div>
                    </body>
                    </html>
                `);
            }

			// ----------------------------------------------------
			// SCENARIO C: STOKVEL / SOCIETY CONTRIBUTION
			// ----------------------------------------------------
			if (memberId && code) {
				const member = await prisma.member.findUnique({
					where: { id: parseInt(memberId) },
					include: { church: true }
				});

				if (!member || !member.church) return res.send(renderPage('Error', '⚠️', 'Not Found', 'Organization or member not found.', true));

				const org = member.church;
				const defaultAmount = org.type === 'STOKVEL_SAVINGS' ? '' : (member.monthlyPremium || '');

				return res.send(`
					<!DOCTYPE html>
					<html>
					<head>
						<meta name="viewport" content="width=device-width, initial-scale=1">
						<title>Pay ${org.name}</title>
						<style>${seabeStyles}</style>
					</head>
					<body>
						<div class="card">
							<div class="tag">${org.type.replace('_', ' ')}</div>
							<h2>${org.name}</h2>
							<p style="margin-bottom: 20px;">Secure Contribution Portal</p>
							
							<form action="/pay/process" method="POST">
								<input type="hidden" name="memberId" value="${member.id}">
								<input type="hidden" name="code" value="${org.code}">
								
								<div class="input-group">
									<label>Amount to Contribute</label>
									<div class="currency-wrapper">
										<span>ZAR</span>
										<input type="number" name="amount" step="0.01" min="10" placeholder="e.g. 250.00" value="${defaultAmount}" required>
									</div>
								</div>
								
								<button type="submit" class="btn">Continue to Secure Payment</button>
							</form>
							<div style="margin-top: 15px; font-size: 11px; color: #95a5a6;">🔒 Secured by Netcash & Capitec Pay</div>
						</div>
						<div class="seabe-brand">Secured by Seabe <span>Pay</span></div>
					</body>
					</html>
				`);
			}

			return res.send(renderPage('Error', '⚠️', 'Invalid Link', 'This payment link is invalid or has expired.', true));

		} catch (error) {
			res.send(renderPage('Error', '⚠️', 'Server Error', error.message, true));
		}
	});

	// 2. Process the Payment and Auto-Redirect via netcash.js
	router.post('/pay/process', express.urlencoded({ extended: true }), async (req, res) => {
		try {
			// 🚀 UPDATED: Extract targetIds and type
			const { memberId, code, amount, apptId, targetIds, type } = req.body;
			let payAmount = parseFloat(amount); // ✅ Changed to 'let' so Lwazi can safely override it

			let org, reference, txType, description, phone, dbMemberId, notes;

			// ----------------------------------------------------
			// SCENARIO A: SALON / APPOINTMENT DEPOSIT
			// ----------------------------------------------------
			if (apptId) {
				const appointment = await prisma.appointment.findUnique({
					where: { id: parseInt(apptId) },
					include: { church: true, member: true, product: true }
				});
				if (!appointment) return res.send(renderPage('Error', '⚠️', 'Not Found', 'Appointment not found.', true));

				org = appointment.church;
				reference = `APPT-${appointment.id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`; 
				txType = 'Personal Grooming';
				description = `Deposit: ${appointment.product.name}`;
				phone = appointment.member.phone;
				dbMemberId = appointment.memberId;
			} 
			// ----------------------------------------------------
            // 🚀 NEW SCENARIO B: LWAZI MULTI-SUBSCRIPTION (ENCRYPTED)
            // ----------------------------------------------------
            else if (req.body.token) {
                const data = decryptToken(req.body.token);
                if (!data) return res.send(renderPage('Error', '⚠️', 'Invalid Request', 'Corrupted secure token.', true));

                const member = await prisma.member.findUnique({ 
                    where: { id: data.p },
                    include: { church: true }
                });
                if (!member) return res.send(renderPage('Error', '⚠️', 'Not Found', 'Member not found.', true));

                org = member.church || { code: 'LWAZI_HQ', name: 'Lwazi Caps Tutor' };
                reference = `LWAZI-${member.id}-${Date.now().toString().slice(-6)}`;
                txType = data.y; // 'LWAZI_MULTI'
                description = `Lwazi Premium Subscription`;
                phone = member.phone; 
                dbMemberId = member.id;
                notes = data.t; // The target IDs
                
                // 🔒 The server forcefully uses the encrypted amount. Tamper-proof!
                payAmount = parseFloat(data.a); 
            }
			// ----------------------------------------------------
			// SCENARIO C: STOKVEL / SOCIETY CONTRIBUTION
			// ----------------------------------------------------
			else if (memberId && code) {
				const member = await prisma.member.findUnique({ 
					where: { id: parseInt(memberId) },
					include: { church: true }
				});
				if (!member || !member.church) return res.send(renderPage('Error', '⚠️', 'Not Found', 'Organization or member not found.', true));

				org = member.church;
				reference = `STK-${member.id}-${Date.now().toString().slice(-6)}`;
				txType = 'CONTRIBUTION';
				description = `Contribution to ${org.name}`;
				phone = member.phone; 
				dbMemberId = parseInt(memberId);
			} else {
				return res.send(renderPage('Error', '⚠️', 'Invalid Request', 'Missing payment parameters.', true));
			}
			
			// 1. Calculate precise fees
            // Lwazi bot passes the base amount. We MUST add gateway fees here.
            const fees = await calculateTransaction(
                payAmount, 
                txType || 'STANDARD', 
                'PAYMENT_LINK', 
                true // ALWAYS add fees to the checkout total
            );

			// 2. Safely log the PENDING transaction
			await prisma.transaction.create({
				data: {
					reference: reference,
					amount: fees.totalChargedToUser,
					netcashFee: fees.netcashFee,
					platformFee: fees.platformFee,
					netSettlement: fees.netSettlement,
					status: 'PENDING',
					type: txType,
					churchCode: org.code,
					phone: phone,
					memberId: dbMemberId,
					notes: notes // 📦 Pushed safely to DB!
				}
			});

			// 3. Tell netcash.js to generate the exact compliant form
			const txData = {
				reference: reference,
				amount: fees.totalChargedToUser,
				description: description,
				email: org.email || '', 
				phone: phone
			};

			const htmlForm = netcash.generateAutoPostForm(txData);

			// 4. Send the auto-submitting Netcash loader to the user's phone
			res.send(htmlForm);

		} catch (error) {
			console.error("Payment Process Error:", error);
			res.send(renderPage('Error', '⚠️', 'Gateway Error', 'An error occurred connecting to Netcash.', true));
		}
	});

	// ==========================================
    // 💳 BROWSER SUCCESS REDIRECT (Netcash Return URL)
    // ==========================================
    router.get('/payment-success', async (req, res) => {
        const reference = req.query.Reference || req.query.ref || req.query.p2;
        
        if (!reference) {
            return res.send(renderPage('Processing', '⏳', 'Processing...', 'Payment received but waiting on bank confirmation. You will receive a WhatsApp receipt shortly.'));
        }

        try {
            const verifyData = await netcash.verifyPayment(reference);

            // If Netcash says it's good, show the success screen!
            if (verifyData && (verifyData.status === 'Complete' || verifyData.status === 'success' || verifyData.TransactionAccepted)) {
                
                // We ONLY read from the database here. We DO NOT update it. 
                // We leave the update to the advanced Webhook so it generates the PDF!
                const transaction = await prisma.transaction.findUnique({
                    where: { reference: reference },
                    include: { church: true } 
                });

                const orgName = transaction?.church?.name || "Seabe Platform";
                const amountText = transaction?.amount ? `<b>R${transaction.amount.toFixed(2)}</b>` : "your payment";

                return res.send(renderPage(
                    'Payment Successful', 
                    '✅', 
                    'Payment Successful!', 
                    `Your payment of ${amountText} to <b>${orgName}</b> has been securely received.<br><br><span style="color:#0984e3;"><i>Your official PDF receipt is being generated and will arrive on WhatsApp momentarily.</i></span>`
                ));
            }
            
            res.send(renderPage('Processing', '⏳', 'Processing...', 'We are waiting for final confirmation from Netcash. Your receipt will be sent to WhatsApp shortly.'));
        } catch (error) {
            console.error("Browser Redirect Verification Error:", error.message);
            res.status(500).send(renderPage('Bank Sync Delay', '⚠️', 'Bank Sync Delay', 'An error occurred verifying with the bank, but your transaction is safe. Please check your WhatsApp for the receipt.', true));
        }
    });

	// ==========================================
	// ❌ BROWSER CANCEL REDIRECT (Netcash Cancel URL)
	// ==========================================
	router.get('/payment-failed', (req, res) => {
		res.send(renderPage(
			'Payment Cancelled', 
			'⚠️', 
			'Payment Incomplete', 
			'Your transaction was cancelled or declined. No funds were deducted from your account.', 
			true
		));
	});

	// ==========================================
	// 🔄 PAYMENT SYNC ENGINES (Cron & Manual)
	// ==========================================
	router.get('/admin/sync-payments', async (req, res) => {
		try {
			const pendingTransactions = await prisma.transaction.findMany({ where: { status: 'PENDING' } });
			let updatedCount = 0;

			for (const tx of pendingTransactions) {
				try {
					const verifyData = await netcash.verifyPayment(tx.reference);
					if (verifyData && (verifyData.status === 'Complete' || verifyData.status === 'success' || verifyData.TransactionAccepted)) {
						await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'SUCCESS' } });
						updatedCount++;
					}
				} catch (err) {} 
			}
			res.send({ message: `Sync Complete via Netcash`, checked: pendingTransactions.length, updated: updatedCount });
		} catch (error) { res.status(500).send({ error: error.message }); }
	});

	router.get('/cron/sync-payments', async (req, res) => {
		const cronKey = req.headers['x-cron-key'] || req.query.key;
		if (cronKey !== process.env.SECRET_CRON_KEY) return res.status(401).send("Unauthorized");

		try {
			const pendingTxs = await prisma.transaction.findMany({
				where: { status: 'PENDING', createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }
			});

			let fixes = 0;
			for (const tx of pendingTxs) {
				try {
					const verifyData = await netcash.verifyPayment(tx.reference);
					if (verifyData && (verifyData.status === 'Complete' || verifyData.status === 'success' || verifyData.TransactionAccepted)) {
						await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'SUCCESS' } });
						fixes++;
					}
				} catch (err) {}
			}
			res.status(200).send({ status: "success", updated: fixes });
		} catch (e) { res.status(500).send("Internal Error"); }
	});
	
	// 🚀 NEW: Auto-Billing Engine for Subscriptions
router.get('/cron/auto-bill', async (req, res) => {
    // 1. Security check to prevent hackers from triggering mass billing
    const cronKey = req.headers['x-cron-key'] || req.query.key;
    if (cronKey !== process.env.SECRET_CRON_KEY) return res.status(401).send("Unauthorized");

    console.log("🕒 [CRON] Starting Daily Auto-Billing Sweep...");

    try {
        // Calculate the date exactly 30 days ago
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // 2. Find all ACTIVE members with a vaulted card who are due for billing
        const dueMembers = await prisma.member.findMany({
            where: {
                status: 'ACTIVE',
                lastPaymentDate: { lte: thirtyDaysAgo }, // Paid 30+ days ago
                paymentMethods: { some: { isDefault: true } } // Has a saved card
            },
            include: {
                paymentMethods: { where: { isDefault: true } },
                church: true
            }
        });

        let successfulCharges = 0;
        let failedCharges = 0;

        for (const member of dueMembers) {
            const vault = member.paymentMethods[0];
            const amountToCharge = 69.00; // Base Lwazi rate
            const reference = `AUTO-${member.id}-${Date.now().toString().slice(-6)}`;

            console.log(`💸 [BILLING] Attempting to charge ${member.phone} R${amountToCharge} via Token...`);

            // 3. Create the PENDING transaction in your ledger
            const tx = await prisma.transaction.create({
                data: {
                    reference: reference,
                    amount: amountToCharge,
                    status: 'PENDING',
                    type: 'LWAZI_RENEWAL',
                    method: 'TOKEN_CHARGE',
                    memberId: member.id,
                    churchCode: member.church.code || 'LWAZI_HQ',
                    phone: member.phone
                }
            });

            // 4. Hit the Netcash API with the Token
            const chargeResult = await netcash.chargeVaultedToken(vault.token, amountToCharge, reference);

            if (chargeResult.success) {
                // ✅ SUCCESS: Update Transaction, Ledger, and Member Date
                await prisma.transaction.update({
                    where: { id: tx.id },
                    data: { status: 'SUCCESS' }
                });

                // Fire your awesome ledger splitter to divide the R69
                await recordSplit(tx.id).catch(console.error);

                // Reset their clock for another 30 days
                await prisma.member.update({
                    where: { id: member.id },
                    data: { lastPaymentDate: new Date(), consecutiveFailures: 0 }
                });

                // Send WhatsApp Receipt
                const msg = `✅ *Subscription Renewed!*\n\nYour Lwazi Premium subscription has been successfully renewed for R69.00 using your saved card ending in ${vault.last4}.\n\nKeep learning! 🦉`;
                await client.messages.create({ from: 'whatsapp:+27875511057', to: `whatsapp:+${member.phone.replace('+', '')}`, body: msg }).catch(() => {});
                successfulCharges++;

            } else {
                // ❌ FAILED: Log failure, increment strikes
                await prisma.transaction.update({
                    where: { id: tx.id },
                    data: { status: 'FAILED' }
                });

                const newFailCount = (member.consecutiveFailures || 0) + 1;
                
                // If the card fails 2 months in a row, suspend the account
                const newStatus = newFailCount >= 2 ? 'SUSPENDED_PAYMENT' : 'ACTIVE';

                await prisma.member.update({
                    where: { id: member.id },
                    data: { consecutiveFailures: newFailCount, status: newStatus }
                });

                const failMsg = newFailCount >= 2 
                    ? `⚠️ *Subscription Suspended*\n\nWe could not process your automatic renewal (Reason: ${chargeResult.reason}). Your Lwazi access is currently paused.\n\nPlease reply *Subscribe* to update your payment method.`
                    : `⚠️ *Renewal Failed*\n\nWe couldn't process your Lwazi renewal using your saved card (Reason: ${chargeResult.reason}). We will try again tomorrow.`;
                
                await client.messages.create({ from: 'whatsapp:+27875511057', to: `whatsapp:+${member.phone.replace('+', '')}`, body: failMsg }).catch(() => {});
                failedCharges++;
            }
        }

        res.status(200).json({ 
            status: "success", 
            message: "Auto-billing sweep complete",
            processed: dueMembers.length,
            success: successfulCharges,
            failed: failedCharges
        });

    } catch (error) {
        console.error("❌ CRON Auto-Billing Error:", error);
        res.status(500).send("Internal Server Error");
    }
});

router.get('/cron/weekly-reports', async (req, res) => {
    // 1. Security Check
    const cronKey = req.headers['x-cron-key'] || req.query.key;
    if (cronKey !== process.env.SECRET_CRON_KEY) return res.status(401).send("Unauthorized");

    console.log("📊 [CRON] Generating Weekly Parent Report Cards...");

    try {
        // Calculate the date exactly 7 days ago
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        // 2. Find all Parents who have active children
        const parents = await prisma.member.findMany({
            where: {
                children: { some: { status: 'ACTIVE' } }
            },
            include: {
                children: {
                    where: { status: 'ACTIVE' },
                    include: {
                        // Fetch only the logs from the last 7 days
                        studyLogs: { where: { createdAt: { gte: sevenDaysAgo } } }
                    }
                }
            }
        });

        let reportsSent = 0;

        // 3. Generate and Send Reports
        for (const parent of parents) {
            let reportMsg = `📊 *Lwazi Weekly Report Card*\n\nHere is how your family performed this week:\n\n`;
            let hasActivity = false;

            for (const child of parent.children) {
                const logs = child.studyLogs;
                if (logs.length === 0) continue; // Skip if they didn't use it this week
                
                hasActivity = true;
                
                // Tally up the stats
                const quizzes = logs.filter(l => l.actionType === 'QUIZ_TAKEN');
                const questions = logs.filter(l => l.actionType === 'QUESTION_ASKED');
                
                let avgScore = 0;
                if (quizzes.length > 0) {
                    const totalScore = quizzes.reduce((sum, q) => sum + (q.score || 0), 0);
                    avgScore = Math.round(totalScore / quizzes.length);
                }

                // Format the child's section
                reportMsg += `👤 *Student (+${child.phone.slice(-4)})*\n`;
                reportMsg += `📝 Quizzes Completed: ${quizzes.length}\n`;
                if (quizzes.length > 0) reportMsg += `🎯 Average Score: ${avgScore}%\n`;
                reportMsg += `🧠 Questions Asked: ${questions.length}\n\n`;
            }

            // 4. Send via Twilio (ONLY if they actually used it)
            if (hasActivity) {
                reportMsg += `_Keep encouraging them! To manage your subscription, reply Menu._`;
                
                // ⚠️ CRITICAL: Because this is outside the 24-hour window, you MUST use a pre-approved Twilio Template in production.
                // Ensure 'reportMsg' matches your Meta-approved template structure exactly.
                // ✅ NEW WAY (Meta-compliant Template via Content API)
				await client.messages.create({ 
					from: 'whatsapp:+27875511057', 
					to: `whatsapp:+${parent.phone.replace('+', '')}`, 
					contentSid: 'HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', // 👈 Replace with your actual Twilio Content SID
					contentVariables: JSON.stringify({
						"1": reportMsg // 👈 Maps your generated report to the {{1}} variable in your template
					})
				}).catch(e => console.error(`Failed to send report to ${parent.phone}:`, e));
                
                reportsSent++;
            }
        }

        res.status(200).json({ status: "success", parentsProcessed: parents.length, reportsSent: reportsSent });

    } catch (error) {
        console.error("❌ CRON Report Error:", error);
        res.status(500).send("Internal Server Error");
    }
});

module.exports = router;