// ==========================================
// routes/crmClaims.js - Seabe CRM
// ==========================================
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendWhatsApp } = require('../services/whatsapp');

// 📊 GET ALL CLAIMS FOR A BURIAL SOCIETY
router.get('/api/crm/claims/:churchCode', async (req, res) => {
    const { churchCode } = req.params;

    try {
        console.log(`📊 Fetching Claims Vault for ${churchCode}...`);

        // Fetch all claims for this specific organization, newest first
        const allClaims = await prisma.claim.findMany({
            where: { churchCode: churchCode },
            orderBy: { createdAt: 'desc' } 
        });

        // 🧠 The "Smart Sort": Grouping the claims for the UI
        const flaggedClaims = allClaims.filter(c => c.status.includes('FLAGGED'));
        const pendingClaims = allClaims.filter(c => c.status === 'PENDING_REVIEW' || c.status === 'UNRECOGNIZED_ID');
        const processedClaims = allClaims.filter(c => c.status === 'APPROVED' || c.status === 'PAID' || c.status === 'DECLINED');

        // Combine Flagged and Pending into a single "Needs Attention" array, putting the Fraud at the very top
        const actionRequired = [...flaggedClaims, ...pendingClaims];

        return res.status(200).json({
            success: true,
            summary: {
                total: allClaims.length,
                actionNeededCount: actionRequired.length,
                flaggedCount: flaggedClaims.length
            },
            data: {
                actionRequired: actionRequired,
                history: processedClaims
            }
        });

    } catch (error) {
        console.error("❌ Error fetching claims:", error);
        return res.status(500).json({ success: false, error: "Failed to load the Claims Vault." });
    }
});

// ⚖️ UPDATE CLAIM STATUS (Approve / Decline)
router.put('/api/crm/claims/:id/status', async (req, res) => {
    const claimId = parseInt(req.params.id);
    const { status, reason } = req.body; // Expecting 'APPROVED' or 'DECLINED'

    try {
        console.log(`⚖️ Admin is marking Claim #${claimId} as ${status}...`);

        // 1. Update the database
        const updatedClaim = await prisma.claim.update({
            where: { id: claimId },
            data: { 
                status: status,
                adminNotes: reason ? `Admin Note: ${reason}` : undefined,
                updatedAt: new Date()
            }
        });

        // 2. Notify the Family via WhatsApp
        let message = '';
        if (status === 'APPROVED') {
            message = `✅ *Claim Approved*\n\nYour claim for ID ending in *${updatedClaim.deceasedIdNumber.slice(-4)}* has been fully approved by the society administrators.\n\nThe payout will be processed to the beneficiary bank account on file shortly.`;
        } else if (status === 'DECLINED') {
            message = `⚠️ *Claim Update*\n\nYour claim for ID ending in *${updatedClaim.deceasedIdNumber.slice(-4)}* has been reviewed.\n\nUnfortunately, it has been declined at this time. Reason: ${reason || 'Does not meet policy requirements'}.\n\nPlease reply *1* to speak with an administrator.`;
        }

        if (message && updatedClaim.claimantPhone) {
            await sendWhatsApp(updatedClaim.claimantPhone, message);
        }

        return res.status(200).json({ success: true, claim: updatedClaim });

    } catch (error) {
        console.error("❌ Error updating claim status:", error);
        return res.status(500).json({ success: false, error: "Failed to update claim." });
    }
});

module.exports = router;