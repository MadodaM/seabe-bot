// routes/webhooks.js
// VERSION: 4.2 (ITN Validated + Four-Pillar Ledger + FICA Risk Engine + PASA Compliance + Full Routing)
// BANK-GRADE SECURITY COMPLIANT (2026)
const express = require('express');
const router = express.Router();
//const { PrismaClient } = require('@prisma/client');
const prisma = require('./services/db');
//const prisma = new PrismaClient();
const axios = require('axios');

// 🚀 Import Seabe Engines
const { calculateTransaction } = require('../services/pricingEngine');
const { screenUserForRisk } = require('../services/complianceEngine');
const { sendWhatsApp } = require('../services/whatsapp'); 

// Netcash Validation Endpoint
const NETCASH_VALIDATE_URL = "https://paynow.netcash.co.za/site/validate.aspx";

/**
 * 🔗 NETCASH ITN WEBHOOK
 * Handles real-time payment notifications with bank-grade validation.
 */
router.post('/api/core/webhooks/payment', express.urlencoded({ extended: true }), async (req, res) => {
    
    // 1. Immediately acknowledge receipt to Netcash to prevent redundant retries
    // This is required by Netcash to signal that the server is alive.
    res.status(200).send(); 

    try {
        const payload = req.body;
        const reference = payload.p2 || payload.AccountReference || payload.MandateReference || 'UNKNOWN';
        console.log(`🔒 [WEBHOOK] Processing incoming ITN for Ref: ${reference}`);

        // 2. THE COMPLIANCE PING (ITN Validation)
        // We re-post the entire payload back to Netcash to verify authenticity.
        // This prevents "Replay Attacks" or spoofed successful payments.
        const validationParams = new URLSearchParams(payload).toString();
        const validationResponse = await axios.post(NETCASH_VALIDATE_URL, validationParams, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (validationResponse.data.trim() !== 'VALID') {
            console.error(`🚨 [SECURITY ALERT] Spoofed webhook detected for Ref: ${reference}`);
            return; 
        }

        console.log(`✅ [WEBHOOK] ITN confirmed VALID by Netcash for Ref: ${reference}`);

        // 3. 🔍 FIND THE TRANSACTION IN MASTER LEDGER
        const tx = await prisma.transaction.findUnique({
            where: { reference: reference },
            include: { member: true, church: true }
        });

        if (!tx) {
            console.warn(`⚠️ [WEBHOOK] Transaction ${reference} not found in DB Master Ledger.`);
            return;
        }

        // Idempotency: Prevent double-processing if Netcash sends the same ITN twice.
        if (tx.status === 'SUCCESS') {
            console.log(`ℹ️ [WEBHOOK] Ref ${reference} already marked SUCCESS. Skipping logic.`);
            return;
        }

        // 4. EXTRACT TRUSTED STATUS DATA
        const amountPaid = parseFloat(payload.p4 || tx.amount || 0);
        const isSuccessful = payload.TransactionAccepted === 'true' || payload.Status === 'Accepted' || payload.Reason === '000';
        const failureReason = payload.Reason || 'Unknown';
        const reasonCode = payload.ReasonCode || '00';

        // =========================================================
        // 🚀 SCENARIO A: DEBICHECK MANDATE APPROVAL
        // =========================================================
        if (reference.includes('-MANDATE-')) {
            console.log(`📋 [MANDATE] Processing DebiCheck result for ${reference}`);
            
            if (isSuccessful && tx.memberId) {
                await prisma.member.update({
                    where: { id: tx.memberId },
                    data: { 
                        status: 'ACTIVE_DEBIT_ORDER', 
                        consecutiveFailures: 0 
                    }
                });

                // 🛡️ CLAUSE 5.5 COMPLIANCE NOTIFICATION (Full Template Restored)
                const confirmMsg = `✅ *Mandate Confirmation*\n\n` +
                                   `This confirms your electronic mandate setup:\n` +
                                   `👤 Payer: ${tx.member?.firstName} ${tx.member?.lastName}\n` +
                                   `🏢 Beneficiary: ${tx.church?.name || 'Seabe'}\n` +
                                   `📅 Action Date: 1st of the Month\n` +
                                   `💰 Amount: Variable (Based on Premium)\n` +
                                   `📞 Support: 010 000 0000\n\n` +
                                   `Your membership is now secured.`;

                await sendWhatsApp(tx.phone, confirmMsg);
            } else if (tx.memberId) {
                await prisma.member.update({
                    where: { id: tx.memberId },
                    data: { status: 'ACTIVE' }
                });
                await sendWhatsApp(tx.phone, `⚠️ *Mandate Declined*\n\nYour bank declined the DebiCheck request. Please reply *Menu* to try setting it up again.`);
            }
            return; 
        }

        // =========================================================
        // 💰 SCENARIO B: SUCCESSFUL PAYMENT (Ledger + FICA Screening)
        // =========================================================
        if (isSuccessful) {
            console.log(`✅ [LEDGER] Payment cleared for ${reference}. Segregating funds...`);

            // 💰 STEP 1: CALCULATE THE FOUR-PILLAR LEDGER SPLITS
            // This pulls dynamic fees from DB to calculate Platform Profit and Church Settlement.
            const pricing = await calculateTransaction(amountPaid, 'STANDARD', 'PAYMENT_LINK', false);

            // 🛡️ STEP 2: RUN FICA PEP & SANCTIONS SCANNER
            // This satisfies FICA Schedule 3 requirements.
            const riskData = await screenUserForRisk(
                tx.member?.firstName || 'Walk-in', 
                tx.member?.lastName || 'User', 
                tx.member?.idNumber || null
            );

            // 💾 STEP 3: ATOMIC DATABASE TRANSACTION (All or Nothing)
            await prisma.$transaction([
                // Update Master Ledger with actual fee segregation
                prisma.transaction.update({
                    where: { id: tx.id },
                    data: { 
                        status: 'SUCCESS',
                        netcashFee: pricing.netcashFee,
                        platformFee: pricing.platformFee,
                        netSettlement: pricing.netSettlement,
                        method: 'NETCASH_ITN_VALIDATED',
                        date: new Date()
                    }
                }),
                // Generate Compliance Audit Log for the Risk Dashboard
                prisma.complianceLog.create({
                    data: {
                        transactionId: tx.id,
                        riskScore: riskData.riskScore,
                        isPepFound: riskData.isPepFound,
                        isSanctionHit: riskData.isSanctionHit,
                        status: riskData.recommendedAction === 'BLOCK' ? 'BLOCKED' : 
                               (riskData.recommendedAction === 'FLAG_FOR_REVIEW' ? 'FLAGGED' : 'CLEARED'),
                        adminNotes: riskData.flags.length > 0 ? riskData.flags.join(', ') : 'FICA Clean Scan'
                    }
                })
            ]);

            console.log(`📈 Revenue Tracked: R${pricing.platformFee.toFixed(2)} | Settlement: R${pricing.netSettlement.toFixed(2)}`);

            // 📈 STEP 4: BUSINESS LOGIC ROUTING (Update Specific Modules)
            
            // 1. Revenue Recovery (Debtor Collections)
            if (reference.startsWith('AUTO-') || reference.startsWith('BLAST-')) {
                const debtRef = reference.split('-')[1];
                await prisma.collection.updateMany({
                    where: { reference: debtRef },
                    data: { status: 'PAID', paidAt: new Date() }
                });
            }
            
            // 2. Burial Society Premiums (Restored lastPaymentDate)
            else if (reference.includes('-PREM-')) {
                 if (tx.memberId) {
                     await prisma.member.update({
                         where: { id: tx.memberId },
                         data: { 
                             status: 'ACTIVE', 
                             lastPaymentDate: new Date(),
                             consecutiveFailures: 0 
                         }
                     });
                 }
            }

            // 💬 STEP 5: SEND AUTOMATED RECEIPT (Restored Full Text)
            const orgName = tx.church?.name || "Our Organization";
            const msg = `✅ *Payment Successful*\n\n` +
                        `Thank you! We have received your payment of *R${amountPaid.toFixed(2)}* for ${orgName}.\n\n` +
                        `🧾 Ref: ${reference}\n\n` +
                        `_Your digital record has been updated. Reply Menu for dashboard._`;
            
            await sendWhatsApp(tx.phone, msg);

        } else {
            // ====================================================
            // 🛑 SCENARIO C: FAILURE & PASA REGULATORY COMPLIANCE
            // ====================================================
            
            // 🛑 IMMEDIATE STOP CODES (Clause 12.1 - Account Closed/Frozen/Deceased)
            // If the bank says the account is closed, we MUST stop future debits.
            const stopCodes = ['04', '12', '16', '06', '18', '26', '30', '32', '34'];
            
            if (stopCodes.includes(reasonCode) && tx.memberId) {
                await prisma.member.update({
                    where: { id: tx.memberId },
                    data: { 
                        status: 'SUSPENDED_MANDATE', 
                        consecutiveFailures: { increment: 1 } 
                    }
                });
                console.log(`🛑 [COMPLIANCE] Mandate Terminated for Code ${reasonCode} (Hard Stop)`);
            } 
            
            // ⚠️ INSUFFICIENT FUNDS (Clause 8.2 - Two Strike Rule)
            else if (reasonCode === '02' && tx.memberId) {
                const member = await prisma.member.findUnique({ where: { id: tx.memberId } });
                const newFailCount = (member.consecutiveFailures || 0) + 1;
                
                await prisma.member.update({
                    where: { id: tx.memberId },
                    data: { 
                        consecutiveFailures: newFailCount,
                        status: newFailCount >= 2 ? 'SUSPENDED_MANDATE' : member.status
                    }
                });

                if (newFailCount >= 2) {
                    console.log(`🛑 [COMPLIANCE] Suspending mandate for ${tx.phone} due to Strike Two (NSF).`);
                    await sendWhatsApp(tx.phone, `⚠️ *Debit Order Suspended*\n\nDue to repeated insufficient funds, your automatic debit has been paused to prevent further bank penalties.`);
                    return;
                }
            }

            // Update Ledger as Failed for historical reporting
            await prisma.transaction.update({
                where: { id: tx.id },
                data: { status: 'FAILED' }
            });

            // Notify User of Failure
            const failMsg = `⚠️ *Payment Failed*\n\nYour payment of R${amountPaid.toFixed(2)} was not successful.\n` +
                            `Reason: ${failureReason}\n\n` +
                            `_Please check your banking app or contact your branch._`;
            
            await sendWhatsApp(tx.phone, failMsg);
        }

    } catch (error) {
        console.error("❌ [WEBHOOK] Critical System Error:", error.message);
        // Do not return error code to Netcash so they retry later if it's a temp DB crash
    }
});

module.exports = router;