// ==========================================
// routes/crmClaims.js - Seabe CRM
// ==========================================
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

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

module.exports = router;