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

// Webhooks often come in as URL Encoded form data, so we parse it appropriately
router.post('/api/core/webhooks/payment', express.urlencoded({ extended: true }), async (req, res) => {
    
    // 1. Immediately acknowledge receipt to Netcash so they don't timeout and retry
    res.status(200).send(); 

    try {
        const payload = req.body;
        
        // DebiCheck and PayNow sometimes use different reference keys in their payloads
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
            return; // Silently drop the fake request
        }

        console.log(`✅ [WEBHOOK] Netcash confirmed VALID for Ref: ${reference}`);

        // 4. EXTRACT TRUSTED DATA
        const amountPaid = parseFloat(payload.p4 || 0);
        // Map success flags for both Pay Now (TransactionAccepted) and DebiCheck (Status/Reason)
        const isSuccessful = payload.TransactionAccepted === 'true' || payload.Status === 'Accepted' || payload.Reason === '000';
        const failureReason = payload.Reason || 'Unknown';

        // =========================================================
        // 🚀 SCENARIO A: DEBICHECK MANDATE APPROVAL
        // =========================================================
        if (reference.includes('-MANDATE-')) {
            const orgCode = reference.split('-')[0];
            
            // Find the member who is waiting for mandate approval
            const member = await prisma.member.findFirst({
                where: { churchCode: orgCode, status: 'PENDING_MANDATE' },
                orderBy: { id: 'desc' }
            });

            if (!member) {
                console.warn(`⚠️ [WEBHOOK] Mandate member not found for ref ${reference}`);
                return;
            }

            let cleanPhone = member.phone;

            if (isSuccessful) {
                await prisma.member.update({
                    where: { id: member.id },
                    data: { status: 'ACTIVE_DEBIT_ORDER' }
                });
                await sendWhatsApp(cleanPhone, `🎉 *Mandate Authorized!*\n\nYour DebiCheck debit order has been successfully activated by your bank. Your membership is now fully secured on autopilot!`);
            } else {
                await prisma.member.update({
                    where: { id: member.id },
                    data: { status: 'ACTIVE' } // Revert to standard active so they can try again
                });
                await sendWhatsApp(cleanPhone, `⚠️ *Mandate Declined*\n\nYour bank declined or timed out the DebiCheck request. Please reply *Menu* to try setting it up again, or choose a once-off payment.`);
            }
            return; // Exit here so it doesn't try to look for a Transaction record!
        }

        // =========================================================
        // 💰 SCENARIO B: STANDARD TRANSACTION PROCESSING
        // =========================================================
        const transaction = await prisma.transaction.findFirst({
            where: { reference: reference },
            include: { member: { include: { church: true, society: true } } }
        });

        if (!transaction) {
            console.warn(`⚠️ [WEBHOOK] Transaction ${reference} not found in database.`);
            return;
        }

        // Avoid double-processing
        if (transaction.status === 'SUCCESS') return;

        if (isSuccessful) {
            // Update Transaction to SUCCESS
            await prisma.transaction.update({
                where: { id: transaction.id },
                data: { status: 'SUCCESS' }
            });

            // BUSINESS LOGIC ROUTING 
            if (reference.startsWith('AUTO-') || reference.startsWith('BLAST-')) {
                const debtRefPart = reference.split('-')[1]; 
                await prisma.collection.updateMany({
                    where: { reference: debtRefPart },
                    data: { status: 'PAID', paidAt: new Date() }
                });
            }
            else if (reference.includes('-PREM-')) {
                if (transaction.memberId) {
                    await prisma.member.update({
                        where: { id: transaction.memberId },
                        data: { status: 'ACTIVE' }
                    });
                }
            }

            // SEND AUTOMATED WHATSAPP RECEIPT
            if (transaction.phone) {
                let cleanPhone = transaction.phone.replace(/\D/g, '');
                if (cleanPhone.startsWith('0')) cleanPhone = '27' + cleanPhone.substring(1);
                
                const orgName = transaction.member?.church?.name || transaction.member?.society?.name || "Our Organization";
                const receiptMsg = `✅ *Payment Successful*\n\nThank you! We have securely received your payment of *R${amountPaid.toFixed(2)}* to ${orgName}.\n\nReference: ${reference}\n\nReply *Menu* to return to your dashboard.`;
                
                await sendWhatsApp(cleanPhone, receiptMsg);
            }

        } else {
            // Transaction Failed
            await prisma.transaction.update({
                where: { id: transaction.id },
                data: { status: 'FAILED' }
            });

            if (transaction.phone) {
                let cleanPhone = transaction.phone.replace(/\D/g, '');
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