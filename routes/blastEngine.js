// ==========================================
// routes/blastEngine.js - Seabe Core
// ==========================================
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendWhatsApp } = require('../services/whatsapp'); // Adjust path if needed

// Helper function to prevent Twilio Rate-Limiting
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

router.post('/api/core/collections/blast/:churchCode', async (req, res) => {
    const { churchCode } = req.params;

    try {
        console.log(`🚀 CORE ENGINE: Initiating Revenue Blast for ${churchCode}...`);

        const overdueAccounts = await prisma.collection.findMany({
            where: {
                churchCode: churchCode,
                status: { in: ['PENDING', 'OVERDUE', 'SENT'] } 
            }
        });

        if (overdueAccounts.length === 0) {
            return res.status(200).json({ message: "No overdue accounts found. Everyone is paid up! 🎉" });
        }

        let successCount = 0;
        let failCount = 0;

        for (const account of overdueAccounts) {
            try {
                const paymentLink = `https://seabe.tech/pay/${account.id}`; 
                const message = `🔔 *Premium Reminder*\n\nHi ${account.firstName},\nYour Seabe Burial Society premium of *R${account.amount.toFixed(2)}* is currently due.\n\nTap the secure link below to settle your account via Ozow or NetCash:\n👉 ${paymentLink}\n\nReply *1* if you need assistance.`;

                await sendWhatsApp(account.phone, message);

                await prisma.collection.update({
                    where: { id: account.id },
                    data: { status: 'BLAST_SENT' } // Prisma handles updatedAt automatically
                });

                successCount++;
                await delay(500); 

            } catch (msgError) {
                console.error(`❌ Failed to send to ${account.phone}:`, msgError.message);
                failCount++;
            }
        }

        console.log(`✅ BLAST COMPLETE: ${successCount} sent, ${failCount} failed.`);
        
        return res.status(200).json({ 
            success: true, 
            message: `Campaign complete! Sent ${successCount} payment links.`,
            stats: { sent: successCount, failed: failCount }
        });

    } catch (error) {
        console.error("❌ Blast Engine Error:", error);
        return res.status(500).json({ error: "Internal Server Error during Blast Campaign." });
    }
});

module.exports = router;