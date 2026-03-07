// routes/quoteGenerator.js
// VERSION: 12.0 (Context-Aware Quote Engine)
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const path = require('path');
const { sendWhatsAppMedia } = require('../services/twilioClient'); // Ensure this import path is correct for your project structure

// ==========================================
// 1. GET QUOTE DATA (Fetch plans for the UI)
// ==========================================
router.get('/quote-data/:code', async (req, res) => {
    try {
        const { code } = req.params;
        
        // 1. Find the Organization
        const church = await prisma.church.findUnique({
            where: { code: code.toUpperCase() }
        });

        if (!church) return res.status(404).json({ success: false, message: "Organization not found" });

        // 2. Find their specific pricing plans
        const plans = await prisma.policyPlan.findMany({
            where: { churchId: church.id }
        });

        // 🛑 CONTEXT CHECK: 
        // Does this organization actually sell insurance?
        // If it's a CHURCH with NO plans, we must flag it so the UI doesn't crash.
        const isProvider = (church.type === 'BURIAL_SOCIETY' || church.type === 'INSURANCE_PROVIDER' || plans.length > 0);

        res.json({
            success: true,
            orgName: church.name,
            orgType: church.type,
            plans: plans,
            
            // 🚩 FRONTEND SIGNALS
            // If false, the UI should show a "Search for Provider" box instead of the plan list
            isProductProvider: isProvider, 
            
            // Helpful message for the UI
            message: isProvider 
                ? "Plans loaded successfully." 
                : "This organization is a Church and does not offer its own products. Please search for your Burial Society."
        });

    } catch (e) {
        console.error("Quote Data Error:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// 2. SEND QUOTE PDF (Receive from UI, Send to WhatsApp)
// ==========================================
router.post('/send-quote', async (req, res) => {
    try {
        const { phone, pdfBase64, orgName } = req.body;
        
        // Strip out the data URI prefix from jsPDF so we have pure base64
        const pureBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, "");
        
        // Save the PDF temporarily to the public folder
        const fileName = `quote_${phone.replace(/\+/g, '')}_${Date.now()}.pdf`;
        
        // Ensure path resolves correctly relative to this file
        // assuming routes/ is one level deep, so ../public targets the root public folder
        const publicDir = path.join(__dirname, '../public/quotes'); 
        
        if (!fs.existsSync(publicDir)) {
            fs.mkdirSync(publicDir, { recursive: true });
        }
        
        const fullPath = path.join(publicDir, fileName);
        fs.writeFileSync(fullPath, pureBase64, 'base64');
        
        // Generate the public URL
        const host = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
        const pdfUrl = `${host}/public/quotes/${fileName}`;

        console.log(`📄 PDF Generated: ${pdfUrl}`);

        // Send via Twilio
        await sendWhatsAppMedia(phone, `📄 Here is your official quote from *${orgName}*.`, pdfUrl);

        res.json({ success: true });
    } catch (e) {
        console.error("Quote Sending Error:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;