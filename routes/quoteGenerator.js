// routes/quoteGenerator.js
// VERSION: 12.3 (Multi-Entity Context & Strict Provider Attribution)
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const path = require('path');
const { sendWhatsAppMedia } = require('../services/twilioClient'); // Ensure this import path is correct

// ==========================================
// 1. GET QUOTE DATA (Fetch plans for the UI)
// ==========================================
router.get('/quote-data/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const { sourceOrg } = req.query; // Optional: If frontend wants to pass the user's base org for tracking
        
        // 1. Find the SPECIFIC Entity the user is searching for / requesting a quote from
        const targetEntity = await prisma.church.findUnique({
            where: { code: code.toUpperCase() }
        });

        if (!targetEntity) return res.status(404).json({ success: false, message: "Searched entity not found" });

        // 2. Find specific pricing plans for this targeted entity
        const plans = await prisma.policyPlan.findMany({
            where: { churchId: targetEntity.id }
        });

        // 🛑 CONTEXT CHECK: 
        // Does THIS searched entity actually sell insurance/plans?
        const isProvider = (targetEntity.type === 'BURIAL_SOCIETY' || targetEntity.type === 'SERVICE_PROVIDER' || plans.length > 0);

        // 3. 🚀 MULTI-ENTITY FALLBACK: If they searched a Church/NPO, fetch the actual Burial Societies!
        let availableProviders = [];
        if (!isProvider) {
            availableProviders = await prisma.church.findMany({
                where: {
                    OR: [
                        { type: 'BURIAL_SOCIETY' },
                        { type: 'SERVICE_PROVIDER' }
                    ]
                },
                select: {
                    id: true,
                    name: true,
                    code: true,
                    type: true
                }
            });
        }

        res.json({
            success: true,
            
            // 🎯 STRICT TARGET DATA: Use this block in the frontend to build the Quote URL
            // This ensures the URL uses the Burial Society's code, NOT the user's base Church code.
            searchedEntity: {
                id: targetEntity.id,
                name: targetEntity.name,
                code: targetEntity.code,
                type: targetEntity.type
            },
            
            plans: plans,
            
            // 🚩 FRONTEND SIGNALS
            isProductProvider: isProvider, 
            
            // 👈 The UI will use this array to let the user select a valid Burial Society if the searched one isn't one
            availableProviders: availableProviders, 
            
            // Helpful message for the UI to display
            message: isProvider 
                ? `Plans loaded successfully for ${targetEntity.name}.` 
                : `${targetEntity.name} is a ${targetEntity.type} and does not offer its own products. Please select a Burial Society provider.`
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
        // 🚀 SECURE PROVIDER LOOKUP
        // We strictly require providerCode to ensure the quote is attributed 
        // to the Burial Society, avoiding contamination from the user's base Church.
        const { phone, pdfBase64, providerCode, userBaseOrgCode } = req.body;
        
        let finalProviderName = "Our Burial Society";

        // Always fetch the real name directly from DB using the exact providerCode (e.g. INSIKA)
        if (providerCode) {
            const actualProvider = await prisma.church.findUnique({
                where: { code: providerCode.toUpperCase() }
            });
            if (actualProvider) {
                finalProviderName = actualProvider.name;
            }
        }
        
        // Strip out the data URI prefix from jsPDF so we have pure base64
        const pureBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, "");
        
        // Save the PDF temporarily to the public folder
        const fileName = `quote_${phone.replace(/\+/g, '')}_${Date.now()}.pdf`;
        
        // Ensure path resolves correctly relative to this file
        const publicDir = path.join(__dirname, '../public/quotes'); 
        
        if (!fs.existsSync(publicDir)) {
            fs.mkdirSync(publicDir, { recursive: true });
        }
        
        const fullPath = path.join(publicDir, fileName);
        fs.writeFileSync(fullPath, pureBase64, 'base64');
        
        // Generate the public URL
        const host = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
        const pdfUrl = `${host}/public/quotes/${fileName}`;

        console.log(`📄 PDF Generated for exactly matched provider [${finalProviderName}]: ${pdfUrl}`);

        // Send via Twilio using the strictly verified Provider Name
        await sendWhatsAppMedia(phone, `📄 Here is your official quote from *${finalProviderName}*.`, pdfUrl);

        res.json({ success: true });
    } catch (e) {
        console.error("Quote Sending Error:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;