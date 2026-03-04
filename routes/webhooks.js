// ==========================================
// routes/webhooks.js - Netcash ITN Webhook
// BANK-GRADE SECURITY COMPLIANT (2026)
// ==========================================
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const axios = require('axios');
const { sendWhatsApp } = require('../services/twilioClient'); 

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
                    data: { status: 'ACTIVE_DEBIT_ORDER' }
                });
                await sendWhatsApp(cleanPhone, `🎉 *Mandate Authorized!*\n\nYour DebiCheck debit order has been successfully activated. Your membership is now fully secured on autopilot!`);
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
        
        // Find the record in the NEW TransactionLedger
        const ledgerEntry = await prisma.transactionLedger.findUnique({
            where: { netcashRef: reference },
            include: { church: true } // Assuming you linked phone numbers to the ledger or church
        });

        if (!ledgerEntry) {
            console.warn(`⚠️ [WEBHOOK] Transaction ${reference} not found in Master Ledger.`);
            return;
        }

        // Avoid double-processing
        if (ledgerEntry.status === 'SUCCESS') return;

        if (isSuccessful) {
            
            // 💡 THE SEABE MARGIN CALCULATOR: 2.5% + R1.50
            const calculatedSeabeFee = (amountPaid * 0.025) + 1.50;

            // 1. Update the Master Ledger with Profit Tracking
            await prisma.transactionLedger.update({
                where: { id: ledgerEntry.id },
                data: { 
                    status: 'SUCCESS',
                    seabeFee: calculatedSeabeFee,
                    settledAt: new Date()
                }
            });

            console.log(`📈 Profit Logged: R${calculatedSeabeFee.toFixed(2)} on Ref: ${reference}`);

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
                // If you linked the memberId to the Ledger, update their status here
                // e.g., await prisma.member.update(...)
            }

            // 3. SEND AUTOMATED WHATSAPP RECEIPT
            // Note: Ensure you are passing the user's phone number into the ledger or fetching it via a relation!
            const userPhone = req.body.phone || 'UNKNOWN'; // Adjust based on your schema relation
            
            if (userPhone !== 'UNKNOWN') {
                let cleanPhone = userPhone.replace(/\D/g, '');
                if (cleanPhone.startsWith('0')) cleanPhone = '27' + cleanPhone.substring(1);
                
                const orgName = ledgerEntry.church?.name || "Our Organization";
                const receiptMsg = `✅ *Payment Successful*\n\nThank you! We have securely received your payment of *R${amountPaid.toFixed(2)}* to ${orgName}.\n\nReference: ${reference}\n\nReply *Menu* to return to your dashboard.`;
                
                await sendWhatsApp(cleanPhone, receiptMsg);
            }

        } else {
            // Transaction Failed
            await prisma.transactionLedger.update({
                where: { id: ledgerEntry.id },
                data: { status: 'FAILED' }
            });

            const userPhone = req.body.phone || 'UNKNOWN'; 
            if (userPhone !== 'UNKNOWN') {
                let cleanPhone = userPhone.replace(/\D/g, '');
                if (cleanPhone.startsWith('0')) cleanPhone = '27' + cleanPhone.substring(1);
                
                const failMsg = `⚠️ *Payment Failed*\n\nYour attempted payment of R${amountPaid.toFixed(2)} could not be processed.\nReason: ${failureReason}\n\nReply *Menu* to try again.`;
                await sendWhatsApp(cleanPhone, failMsg);
            }
        }

    } catch (error) {
        console.error("❌ [WEBHOOK] Critical Processing Error:", error.message);
    }
});

module.exports = router;