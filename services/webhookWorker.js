// services/webhookWorker.js
const prisma = require('./db'); // Adjust path to your Prisma client
const axios = require('axios');
const { calculateTransaction } = require('./pricingEngine');
const { screenUserForRisk } = require('./complianceEngine');
const { sendWhatsApp } = require('./whatsapp'); 
const { generateReceiptPDF } = require('./receiptGenerator');
const { recordSplit } = require('./ledgerEngine');

const NETCASH_VALIDATE_URL = "https://paynow.netcash.co.za/site/validate.aspx";

async function processNetcashITN(webhookLogId) {
    try {
        // 1. Fetch the pending webhook log
        const log = await prisma.webhookLog.findUnique({ where: { id: webhookLogId } });
        if (!log || log.status === 'SUCCESS') return;

        const payload = log.payload;
        const reference = payload.Reference || payload.p2 || payload.AccountReference || payload.MandateReference || 'UNKNOWN';
        console.log(`🔄 [WORKER] Processing ITN for Ref: ${reference}`);

        // 💳 SEABE ID: Extract Token Variables
        const token = payload.Token || payload.NIWSToken || payload.token;
        const cardType = payload.CardType || payload.cardType;
        const maskedCard = payload.MaskedCard || payload.maskedCard;

        // 2. Smart Validation (Accepts both old and new Netcash formats)
        let isValid = false;
        if (payload.p2) {
            const validationParams = new URLSearchParams(payload).toString();
            const validationResponse = await axios.post(NETCASH_VALIDATE_URL, validationParams, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            isValid = (validationResponse.data.trim() === 'VALID');
        } else if (payload.Reference) {
            isValid = true;
        }

        if (!isValid) {
            throw new Error(`Spoofed webhook detected for Ref: ${reference}`);
        }

        // 3. 🔍 FIND THE TRANSACTION IN MASTER LEDGER
        const tx = await prisma.transaction.findFirst({
            where: { reference: reference },
            include: { member: true, church: true }
        });

        if (!tx) {
            throw new Error(`Transaction ${reference} not found in DB Master Ledger.`);
        }

        // Idempotency: Prevent double-processing
        if (tx.status === 'SUCCESS') {
            console.log(`ℹ️ [WORKER] Ref ${reference} already SUCCESS. Skipping logic.`);
            await prisma.webhookLog.update({
                where: { id: webhookLogId },
                data: { status: 'SUCCESS', processedAt: new Date(), errorReason: 'Already processed previously' }
            });
            return;
        }

        const amountPaid = parseFloat(payload.Amount || payload.p4 || tx.amount || 0);
        const isSuccessful = payload.TransactionAccepted === 'true' || payload.Status === 'Accepted' || payload.Reason === '000' || payload.TransactionStatus === '1';
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
                    data: { status: 'ACTIVE_DEBIT_ORDER', consecutiveFailures: 0 }
                });

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
            
            // Mark Webhook as Successful
            await prisma.webhookLog.update({ where: { id: webhookLogId }, data: { status: 'SUCCESS', processedAt: new Date() }});
            return; 
        }

        // =========================================================
        // 💰 SCENARIO B: SUCCESSFUL PAYMENT (Ledger + FICA Screening)
        // =========================================================
        if (isSuccessful) {
            console.log(`✅ [LEDGER] Payment cleared for ${reference}. Segregating funds...`);

            let correctType = tx.type;
            const refParts = reference.split('-');
            if ((correctType === 'DEPOSIT' || !correctType) && refParts.length > 1) {
                correctType = refParts[1]; 
            }

            const pricing = await calculateTransaction(amountPaid, 'STANDARD', correctType || 'SEABE_RELAY', false);

            const riskData = await screenUserForRisk(
                tx.member?.firstName || 'Walk-in', 
                tx.member?.lastName || 'User', 
                tx.member?.idNumber || null
            );

            await prisma.$transaction([
                prisma.transaction.update({
                    where: { id: tx.id },
                    data: { 
                        status: 'SUCCESS',
                        type: correctType, 
                        netcashFee: pricing.netcashFee,
                        platformFee: pricing.platformFee,
                        netSettlementAmount: pricing.netSettlement, 
                        method: 'NETCASH_ITN_VALIDATED',
                        date: new Date(),
                        amount: amountPaid 
                    }
                }),
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
			
			// 💰 🚀 NEW: FIRE THE LEDGER SPLITTER HERE!
            try {
                console.log(`💸 [LEDGER] Triggering split for TX ${tx.id}`);
                await recordSplit(tx.id);
            } catch (ledgerErr) {
                console.error(`❌ [LEDGER] Split failed for TX ${tx.id}:`, ledgerErr);
                // We don't throw here so the user still gets their receipt below even if the ledger math hiccups
            }

            // 💳 STEP 3.5: SEABE ID VAULTING
            if (token && tx.memberId) {
                const existingToken = await prisma.paymentMethod.findUnique({ where: { token: token } });
                if (!existingToken) {
                    await prisma.paymentMethod.create({
                        data: {
                            memberId: tx.memberId,
                            token: token,
                            cardBrand: cardType || 'Card',
                            last4: maskedCard ? maskedCard.slice(-4) : '****',
                            isDefault: true
                        }
                    });
                }
            }

            // 📈 STEP 4: BUSINESS LOGIC ROUTING
            if (reference.startsWith('AUTO-') || reference.startsWith('BLAST-')) {
                const debtRef = reference.split('-')[1];
                await prisma.collection.updateMany({
                    where: { reference: debtRef },
                    data: { status: 'PAID', paidAt: new Date() }
                });
            } else if (reference.includes('-PREM-') || reference.includes('-ONCEOFF-')) {
                 if (tx.memberId) {
                     await prisma.member.update({
                         where: { id: tx.memberId },
                         data: { status: 'ACTIVE', lastPaymentDate: new Date(), consecutiveFailures: 0 }
                     });
                 }
            } else if (reference.startsWith('APPT-') || reference.includes('-GROOMING-')) {
                const apptId = parseInt(reference.split('-')[1]);
                if (!isNaN(apptId)) {
                    try {
                        const appointment = await prisma.appointment.update({
                            where: { id: apptId },
                            data: { depositPaid: true, status: 'CONFIRMED' },
                            include: { member: true, church: true, product: true }
                        });

                        if (appointment.member && appointment.member.phone) {
                            const dateObj = new Date(appointment.bookingDate);
                            const prettyDate = dateObj.toLocaleDateString('en-ZA', { weekday: 'short', month: 'short', day: 'numeric' });
                            const prettyTime = dateObj.toLocaleTimeString('en-ZA', { hour: '2-digit', minute:'2-digit' });
                            const confirmMsg = `🎉 *Booking Confirmed!*\n\nHi ${appointment.member.firstName}, your payment has been successfully received.\n\n*${appointment.church.name}* has locked in your slot for a *${appointment.product.name}* on *${prettyDate} at ${prettyTime}*.\n\nSee you then! ✂️`;
                            await sendWhatsApp(appointment.member.phone, confirmMsg);
                        }
                    } catch (e) { console.error("❌ Failed to process appointment webhook:", e); }
                }
            }

            // 📄 STEP 5: GENERATE PDF RECEIPT
            let pdfUrl = null;
            try {
                pdfUrl = await generateReceiptPDF(tx, tx.church);
            } catch (pdfErr) {
                console.error("⚠️ [WEBHOOK] Failed to generate PDF receipt:", pdfErr.message);
            }

            // 💬 STEP 6: SEND AUTOMATED RECEIPT
            const orgName = tx.church?.name || "Our Organization";
            let msg = `✅ *Payment Successful*\n\nThank you! We have received your payment of *R${amountPaid.toFixed(2)}* for ${orgName}.\n\n🧾 Ref: ${reference}\n\n`;
            if (token && !reference.includes('-MANDATE-')) {
                msg += `🔒 _Your ${cardType || 'Card'} ending in ${maskedCard ? maskedCard.slice(-4) : '****'} has been securely saved for faster checkout next time._\n\n`;
            }
            msg += `_Your official receipt is attached below. Reply Menu for dashboard._`;
            await sendWhatsApp(tx.phone, msg, pdfUrl);

        } else {
            // ====================================================
            // 🛑 SCENARIO C: FAILURE & PASA REGULATORY COMPLIANCE
            // ====================================================
            const stopCodes = ['04', '12', '16', '06', '18', '26', '30', '32', '34'];
            
            if (stopCodes.includes(reasonCode) && tx.memberId) {
                await prisma.member.update({
                    where: { id: tx.memberId },
                    data: { status: 'SUSPENDED_MANDATE', consecutiveFailures: { increment: 1 } }
                });
                console.log(`🛑 [COMPLIANCE] Mandate Terminated for Code ${reasonCode} (Hard Stop)`);
            } 
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
                    
                    await prisma.webhookLog.update({ where: { id: webhookLogId }, data: { status: 'SUCCESS', processedAt: new Date() }});
                    return;
                }
            }

            await prisma.transaction.update({
                where: { id: tx.id },
                data: { status: 'FAILED' }
            });

            const failMsg = `⚠️ *Payment Failed*\n\nYour payment of R${amountPaid.toFixed(2)} was not successful.\nReason: ${failureReason}\n\n_Please check your banking app or contact your branch._`;
            await sendWhatsApp(tx.phone, failMsg);
        }

        // Mark Webhook as Successfully Handled
        await prisma.webhookLog.update({
            where: { id: webhookLogId },
            data: { status: 'SUCCESS', processedAt: new Date() }
        });

    } catch (error) {
        console.error(`🚨 [WORKER] Critical failure processing log ID ${webhookLogId}:`, error.message);
        // Mark as FAILED so it enters the Dead Letter Queue
        await prisma.webhookLog.update({
            where: { id: webhookLogId },
            data: { status: 'FAILED', errorReason: error.message, processedAt: new Date() }
        });
    }
}

module.exports = { processNetcashITN };