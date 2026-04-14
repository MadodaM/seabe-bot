	// routes/paymentRoutes.js
	const express = require('express');
	const router = express.Router();
	const { PrismaClient } = require('@prisma/client');
	const prisma = new PrismaClient();
	const { recordSplit } = require('../services/ledgerEngine');

	// 🚀 PRICING ENGINE IMPORT
	const { calculateTransaction } = require('../services/pricingEngine');

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
			const { memberId, code, apptId, amount } = req.query;

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
				// Use the amount passed in the URL (from the bot), or calculate 25% fallback
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
			// SCENARIO B: STOKVEL / SOCIETY CONTRIBUTION
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
        const { memberId, code, amount, apptId } = req.body;
        const payAmount = parseFloat(amount);

        // 🚀 FIX 1: Correctly declared 'reference'
        let org, reference, txType, description, phone, dbMemberId;

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
        // SCENARIO B: STOKVEL / SOCIETY CONTRIBUTION
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
            
            // 🚀 FIX 2: Correctly grabs the member's actual phone number
            phone = member.phone; 
            dbMemberId = parseInt(memberId);
        } else {
            return res.send(renderPage('Error', '⚠️', 'Invalid Request', 'Missing payment parameters.', true));
        }

        // 1. Calculate precise fees
        const fees = await calculateTransaction(payAmount, 'STANDARD', 'PAYMENT_LINK', true);

        // 2. Safely log the PENDING transaction
        await prisma.transaction.create({
            data: {
                reference: reference,
                amount: fees.totalChargedToUser,
                netcashFee: fees.netcashFee,
                platformFee: fees.platformFee,
                // 🚀 FIX 3: Uses the correct schema field name
                netSettlement: fees.netSettlement,
                status: 'PENDING',
                type: txType,
                churchCode: org.code,
                phone: phone,
                memberId: dbMemberId
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

	module.exports = router;