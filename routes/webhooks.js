// ==========================================
// routes/webhooks.js - Netcash ITN Webhook
// BANK-GRADE SECURITY COMPLIANT (2026)
// ==========================================
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const axios = require('axios');
const { sendWhatsApp } = require('../services/twilioClient'); // Ensure correct path to your Twilio sender

// Netcash Validation Endpoint
const NETCASH_VALIDATE_URL = "https://paynow.netcash.co.za/site/validate.aspx";

// Webhooks often come in as URL Encoded form data, so we parse it appropriately
router.post('/api/core/webhooks/payment', express.urlencoded({ extended: true }), async (req, res) => {
    
    // 1. Immediately acknowledge receipt to Netcash so they don't timeout and retry
    res.status(200).send(); 

    try {
        const payload = req.body;
        console.log(`🔒 [WEBHOOK] Incoming payload for Ref: ${payload.p2}`);

        // 2. THE COMPLIANCE PING (ITN Validation)
        // We bounce the exact payload back to Netcash to ensure it wasn't spoofed by a hacker
        const validationParams = new URLSearchParams(payload).toString();
        const validationResponse = await axios.post(NETCASH_VALIDATE_URL, validationParams, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        // 3. CHECK THE VALIDATION RESULT
        if (validationResponse.data.trim() !== 'VALID') {
            console.error(`🚨 [SECURITY ALERT] Spoofed webhook detected for Ref: ${payload.p2}`);
            return; // Silently drop the fake request
        }

        console.log(`✅ [WEBHOOK] Netcash confirmed VALID for Ref: ${payload.p2}`);

        // 4. EXTRACT TRUSTED DATA
        const reference = payload.p2; // e.g., WEB-AFM-TITHE-1234
        const amountPaid = parseFloat(payload.p4);
        const isSuccessful = payload.TransactionAccepted === 'true';
        const failureReason = payload.Reason || 'Unknown';

        // 5. UPDATE TRANSACTION RECORD
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

            // 6. BUSINESS LOGIC ROUTING (Based on Reference Prefix)
            
            // Scenario A: Automated Debt Collection (from blastEngine / billingCron)
            if (reference.startsWith('AUTO-') || reference.startsWith('BLAST-')) {
                // Find the original collection debt using the middle part of the reference
                const debtRefPart = reference.split('-')[1]; 
                await prisma.collection.updateMany({
                    where: { reference: debtRefPart },
                    data: { status: 'PAID', paidAt: new Date() }
                });
            }

            // Scenario B: Burial Society Premium Paid
            else if (reference.includes('-PREM-')) {
                if (transaction.memberId) {
                    await prisma.member.update({
                        where: { id: transaction.memberId },
                        data: { status: 'ACTIVE' } // Reactivate policy if they were lapsed!
                    });
                }
            }

            // 7. SEND AUTOMATED WHATSAPP RECEIPT
            if (transaction.phone) {
                let cleanPhone = transaction.phone.replace(/\D/g, '');
                if (cleanPhone.startsWith('0')) cleanPhone = '27' + cleanPhone.substring(1);
                
                const orgName = transaction.member?.church?.name || transaction.member?.society?.name || "Our Organization";
                const receiptMsg = `✅ *Payment Successful*\n\nThank you! We have securely received your payment of *R${amountPaid.toFixed(2)}* to ${orgName}.\n\nReference: ${reference}\n\nReply *Menu* to return to your dashboard.`;
                
                await sendWhatsApp(cleanPhone, receiptMsg);
            }

        } else {
            // Transaction Failed (Insufficient funds, card declined, etc.)
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