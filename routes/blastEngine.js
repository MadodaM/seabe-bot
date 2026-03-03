// ==========================================
// routes/blastEngine.js - Seabe Core
// ==========================================
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendWhatsApp } = require('../services/whatsapp'); 
const netcash = require('../services/netcash'); // 🚀 ADDED NETCASH ENGINE

// Helper function to prevent Twilio Rate-Limiting (10 msgs / sec limit)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

router.post('/api/crm/collections/blast/:churchCode', async (req, res) => {
    const { churchCode } = req.params;

    try {
        console.log(`🚀 CORE ENGINE: Initiating Revenue Blast for ${churchCode}...`);

        // 1. Fetch the Organization to personalize the message
        const org = await prisma.church.findUnique({ 
            where: { code: churchCode } 
        });
        
        if (!org) return res.status(404).json({ error: "Organization not found." });

        // 2. Fetch Overdue Accounts
        const overdueAccounts = await prisma.collection.findMany({
            where: {
                churchCode: churchCode,
                status: { in: ['PENDING', 'OVERDUE', 'REMINDER_1'] } // Adjusted to match UI statuses
            }
        });

        if (overdueAccounts.length === 0) {
            return res.status(200).json({ success: true, message: "No overdue accounts found. Everyone is paid up! 🎉" });
        }

        let successCount = 0;
        let failCount = 0;

        // 3. Fire the Blast
        for (const account of overdueAccounts) {
            try {
                // 🚀 FIX: Generate a unique Netcash link for 1-click payments!
                const ref = `BLAST-${account.reference}-${Date.now().toString().slice(-4)}`;
                let paymentLink = await netcash.createPaymentLink(account.amount, ref, account.phone, org.name);

                // Fallback to the secure portal if the Netcash API happens to be down
                if (!paymentLink) {
                    const host = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
                    paymentLink = `${host}/link/${churchCode}`; 
                }
                
                const message = `🔔 *Premium Reminder*\n\nHi ${account.firstName},\nYour ${org.name} premium of *R${account.amount.toFixed(2)}* is currently due.\n\nTap the secure link below to settle your account via Netcash:\n👉 ${paymentLink}\n\nReply *1* if you need assistance.`;

                // 🛡️ Ensure phone is clean for Twilio
                let cleanPhone = account.phone.replace(/\D/g, '');
                if (cleanPhone.startsWith('0')) cleanPhone = '27' + cleanPhone.substring(1);

                await sendWhatsApp(cleanPhone, message);

                // Update status so the CRM Dashboard updates the badge color!
                await prisma.collection.update({
                    where: { id: account.id },
                    data: { status: 'REMINDER_1' } 
                });

                successCount++;
                await delay(500); // 500ms delay ensures Twilio doesn't flag us for spam

            } catch (msgError) {
                console.error(`❌ Failed to send to ${account.phone}:`, msgError.message);
                failCount++;
            }
        }

        console.log(`✅ BLAST COMPLETE: ${successCount} sent, ${failCount} failed.`);
        
        // Return a response that the CRM frontend can parse and display to the Admin
        return res.status(200).json({ 
            success: true, 
            message: `Campaign complete! Sent ${successCount} payment links.`,
            stats: { sent: successCount, failed: failCount }
        });

    } catch (error) {
        console.error("❌ Blast Engine Error:", error);
        return res.status(500).json({ success: false, error: "Internal Server Error during Blast Campaign." });
    }
});

module.exports = router;