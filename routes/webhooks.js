// routes/webhooks.js - Netcash ITN Webhook
// BANK-GRADE SECURITY COMPLIANT (2026)
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const axios = require('axios');
const { sendWhatsApp } = require('../services/twilioClient'); 
const { getPrice } = require('../services/pricing'); // 🚀 IMPORT PRICING SERVICE

// Netcash Validation Endpoint
const NETCASH_VALIDATE_URL = "https://paynow.netcash.co.za/site/validate.aspx";

router.post('/api/core/webhooks/payment', express.urlencoded({ extended: true }), async (req, res) => {
    
    // 1. Immediately acknowledge receipt to Netcash
    res.status(200).send(); 

    try {
        const payload = req.body;
        const reference = payload.p2 || payload.AccountReference || payload.MandateReference || 'UNKNOWN';
        console.log(`🔒 [WEBHOOK] Incoming payload for Ref: ${reference}`);

        // 2. THE COMPLIANCE PING (ITN Validation)
        const validationParams = new URLSearchParams(payload).toString();
        const validationResponse = await axios.post(NETCASH_VALIDATE_URL, validationParams, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        // 3. CHECK THE VALIDATION RESULT
        if (validationResponse.data.trim() !== 'VALID') {
            console.error(`🚨 [SECURITY ALERT] Spoofed webhook detected for Ref: ${reference}`);
            return; 
        }

        console.log(`✅ [WEBHOOK] Netcash confirmed VALID for Ref: ${reference}`);

        // 4. EXTRACT TRUSTED DATA
        const amountPaid = parseFloat(payload.p4 || 0);
        const isSuccessful = payload.TransactionAccepted === 'true' || payload.Status === 'Accepted' || payload.Reason === '000';
        const failureReason = payload.Reason || 'Unknown';

        // =========================================================
        // 🚀 SCENARIO A: DEBICHECK MANDATE APPROVAL (Unchanged)
        // =========================================================
        if (reference.includes('-MANDATE-')) {
            const orgCode = reference.split('-')[0];
            const member = await prisma.member.findFirst({
                where: { churchCode: orgCode, status: 'PENDING_MANDATE' },
                orderBy: { id: 'desc' }
            });

            if (!member) return console.warn(`⚠️ [WEBHOOK] Mandate member not found for ref ${reference}`);

            let cleanPhone = member.phone;

            if (isSuccessful) {
                await prisma.member.update({
                    where: { id: member.id },
                    data: { 
                        status: 'ACTIVE_DEBIT_ORDER',
                        consecutiveFailures: 0 // Reset strikes on new mandate
                    }
                });
                
                // 🛡️ CLAUSE 5.5 COMPLIANCE NOTIFICATION
                const date = new Date();
                const confirmMsg = `✅ *Mandate Confirmation*\n\n` +
                                   `This confirms your electronic mandate setup:\n` +
                                   `👤 Payer: ${member.firstName} ${member.lastName}\n` +
                                   `🏢 Beneficiary: ${orgCode} (Seabe)\n` + // Use specific Abbreviated Name
                                   `📅 Action Date: 1st of the Month\n` +
                                   `💰 Amount: Variable (Based on Premium)\n` +
                                   `📞 Contact: 010 000 0000\n\n` + 
                                   `Your membership is now secured.`;
                                   
                await sendWhatsApp(cleanPhone, confirmMsg);
            } else {
                await prisma.member.update({
                    where: { id: member.id },
                    data: { status: 'ACTIVE' } 
                });
                await sendWhatsApp(cleanPhone, `⚠️ *Mandate Declined*\n\nYour bank declined or timed out the DebiCheck request. Please reply *Menu* to try setting it up again.`);
            }
            return; 
        }

        // =========================================================
        // 💰 SCENARIO B: MASTER LEDGER PROCESSING (Upgraded)
        // =========================================================
        
        // Find the record in the NEW Transaction Table
        const ledgerEntry = await prisma.transaction.findFirst({
            where: { reference: reference },
            include: { church: true, member: true } 
        });

        if (!ledgerEntry) {
            console.warn(`⚠️ [WEBHOOK] Transaction ${reference} not found in Master Ledger.`);
            return;
        }

        // Avoid double-processing
        if (ledgerEntry.status === 'SUCCESS') return;

        if (isSuccessful) {
            
            // 🚀 DYNAMIC PROFIT CALCULATION (No Hardcoding)
            const pct = await getPrice('TX_CAPITEC_RT_PCT');
            const flat = await getPrice('TX_CAPITEC_RT_FLAT');
            
            const calculatedSeabeFee = (amountPaid * pct) + flat;

            // 1. Update the Master Ledger with Profit Tracking
            await prisma.transaction.update({
                where: { id: ledgerEntry.id },
                data: { 
                    status: 'SUCCESS',
                    platformFee: calculatedSeabeFee, // 💰 SAVING THE PROFIT HERE
                    date: new Date() 
                }
            });

            console.log(`📈 Revenue Tracked & Saved: R${calculatedSeabeFee.toFixed(2)} on Ref: ${reference}`);

            // 2. BUSINESS LOGIC ROUTING 
            if (reference.startsWith('AUTO-') || reference.startsWith('BLAST-')) {
                const debtRefPart = reference.split('-')[1]; 
                await prisma.collection.updateMany({
                    where: { reference: debtRefPart },
                    data: { status: 'PAID', paidAt: new Date() }
                });
            }
            // Update Burial Premium status
            else if (reference.includes('-PREM-')) {
                 if (ledgerEntry.memberId) {
                     await prisma.member.update({
                         where: { id: ledgerEntry.memberId },
                         data: { status: 'ACTIVE' }
                     });
                 }
            }

            // 3. SEND AUTOMATED WHATSAPP RECEIPT
            const userPhone = ledgerEntry.phone || 'UNKNOWN';
            
            if (userPhone !== 'UNKNOWN') {
                let cleanPhone = userPhone.replace(/\D/g, '');
                if (cleanPhone.startsWith('0')) cleanPhone = '27' + cleanPhone.substring(1);
                
                const orgName = ledgerEntry.church?.name || "Our Organization";
                const receiptMsg = `✅ *Payment Successful*\n\nThank you! We have securely received your payment of *R${amountPaid.toFixed(2)}* to ${orgName}.\n\nReference: ${reference}\n\nReply *Menu* to return to your dashboard.`;
                
                await sendWhatsApp(cleanPhone, receiptMsg);
            }

        } else {
            // ====================================================
            // 🛑 COMPLIANCE HANDLER (Clauses 8, 11, 12)
            // ====================================================
            
            // 1. Identify the specific Netcash Failure Code
            // Payload often has 'ReasonCode' or we parse 'Reason' text
            const code = payload.ReasonCode || '00'; 
            
            // 🛑 IMMEDIATE STOP CODES (Clause 12.1 / 11.3)
            // 04: Stop Payment, 12: Account Closed, 16: Transferred, 06: Frozen, 18: Deceased
            const stopCodes = ['04', '12', '16', '06', '18', '26', '30', '32', '34'];
            
            if (stopCodes.includes(code)) {
                if (ledgerEntry.memberId) {
                    await prisma.member.update({
                        where: { id: ledgerEntry.memberId },
                        data: { 
                            status: 'SUSPENDED_MANDATE', // Stop future debits immediately
                            consecutiveFailures: { increment: 1 } 
                        }
                    });
                    console.log(`🛑 MANDATE CANCELLED (Compliance): Reason Code ${code}`);
                }
            } 
            // ⚠️ INSUFFICIENT FUNDS (Clause 8.2 - Two Strike Rule)
            else if (code === '02' || code === 'Not provided for') {
                if (ledgerEntry.memberId) {
                    const member = await prisma.member.findUnique({ where: { id: ledgerEntry.memberId } });
                    
                    // Increment Failure Count
                    const newCount = (member.consecutiveFailures || 0) + 1;
                    
                    let newStatus = 'ACTIVE_DEBIT_ORDER';
                    if (newCount >= 2) {
                        newStatus = 'SUSPENDED_MANDATE'; // 🛑 STRIKE TWO: YOU'RE OUT
                    }

                    await prisma.member.update({
                        where: { id: ledgerEntry.memberId },
                        data: { 
                            consecutiveFailures: newCount,
                            status: newStatus
                        }
                    });
                    
                    if (newStatus === 'SUSPENDED_MANDATE') {
                        console.log(`🛑 MANDATE SUSPENDED: 2 Consecutive "Not Provided For"`);
                        // Send warning to user
                        await sendWhatsApp(ledgerEntry.phone, `⚠️ *Debit Order Suspended*\n\nWe have received a second "Insufficient Funds" response. To prevent bank penalties, your debit order has been paused.\n\nPlease reply *Menu* > *Pay* to make a manual arrangement.`);
                        return; // Exit, don't send standard fail message
                    }
                }
            }

            // Standard Failure Log
            await prisma.transaction.update({
                where: { id: ledgerEntry.id },
                data: { status: 'FAILED' }
            });

            // Standard User Notification
            const userPhone = ledgerEntry.phone || 'UNKNOWN'; 
            if (userPhone !== 'UNKNOWN') {
                let cleanPhone = userPhone.replace(/\D/g, '');
                if (cleanPhone.startsWith('0')) cleanPhone = '27' + cleanPhone.substring(1);
                
                const failMsg = `⚠️ *Payment Failed*\n\nYour attempted payment of R${amountPaid.toFixed(2)} was returned.\nReason: ${failureReason}\n\nReply *Menu* to rectify this.`;
                await sendWhatsApp(cleanPhone, failMsg);
            }
        }

    } catch (error) {
        console.error("❌ [WEBHOOK] Critical Processing Error:", error.message);
    }
});

module.exports = router;