// ==========================================
// routes/ficaPortal.js - Secure Document Vault
// ==========================================
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const cloudinary = require('cloudinary').v2;

// Increase payload limit for PDF/Image uploads
router.use(express.json({ limit: '10mb' })); 
router.use(express.urlencoded({ limit: '10mb', extended: true }));

// 1. Fetch Organization Details for the Portal
router.get('/info/:code', async (req, res) => {
    try {
        const org = await prisma.church.findUnique({ 
            where: { code: req.params.code },
            select: { name: true, code: true, ficaStatus: true, npcRegUrl: true, cipcDocUrl: true, directorIdsUrl: true }
        });
        if (!org) return res.status(404).json({ success: false, error: 'Organization not found' });
        res.json({ success: true, org });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2. Handle Base64 Document Uploads
router.post('/upload/:code', async (req, res) => {
    try {
        const { docType, fileBase64 } = req.body;
        
        // Ensure docType is one of our 3 allowed database fields
        const allowedTypes = ['npcRegUrl', 'cipcDocUrl', 'directorIdsUrl'];
        if (!allowedTypes.includes(docType)) return res.status(400).json({ error: 'Invalid document type' });

        // Upload directly to Cloudinary (handles both PDFs and Images)
        const uploadRes = await cloudinary.uploader.upload(fileBase64, {
            folder: `seabe_fica/${req.params.code}`,
            resource_type: 'auto' 
        });

        // Update the database and escalate the status to Super Admin!
        await prisma.church.update({
            where: { code: req.params.code },
            data: {
                [docType]: uploadRes.secure_url,
                ficaStatus: 'LEVEL_2_PENDING' // Pushes it back to your FICA dashboard for final approval
            }
        });

        res.json({ success: true, url: uploadRes.secure_url });
    } catch (error) {
        console.error("FICA Upload Error:", error);
        res.status(500).json({ success: false, error: 'Failed to upload document' });
    }
});

module.exports = router;