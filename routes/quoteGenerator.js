// routes/quoteGenerator.js
// VERSION: 12.2 (Context-Aware Quote Engine & Secure Provider Lookup)
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
        
        // 1. Find the Organization the user belongs to (e.g., their Church)
        const church = await prisma.church.findUnique({
            where: { code: code.toUpperCase() }
        });

        if (!church) return res.status(404).json({ success: false, message: "Organization not found" });

        // 2. Find specific pricing plans for this code
        const plans = await prisma.policyPlan.findMany({
            where: { churchId: church.id }
        });

        // 🛑 CONTEXT CHECK: 
        // Does this organization actually sell insurance?
        const isProvider = (church.type === 'BURIAL_SOCIETY' || church.type === 'SERVICE_PROVIDER' || plans.length > 0);

        // 3. 🚀 NEW FALLBACK: If it's just a Church/NPO, fetch the actual Burial Societies!
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
                    code: true
                }
            });
        }

        res.json({
            success: true,
            orgId: church.id, // The ID of the currently requested org
            orgName: church.name,
            orgType: church.type,
            plans: plans,
            
            // 🚩 FRONTEND SIGNALS
            isProductProvider: isProvider, 
            
            // 👈 The UI will use this array to let the user select a valid Burial Society
            availableProviders: availableProviders, 
            
            // Helpful message for the UI to display
            message: isProvider 
                ? "Plans loaded successfully." 
                : "This organization is a Church/NPO and does not offer its own products. Please select a Burial Society provider."
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
        // We now accept providerCode to ensure the quote is strictly attributed 
        // to the Burial Society, not the user's Church.
        const { phone, pdfBase64, orgName, providerCode } = req.body;
        
        let finalProviderName = orgName || "Our Burial Society";

        // If the frontend passed the providerCode (e.g. INSIKA), fetch the real name
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

        console.log(`📄 PDF Generated for ${finalProviderName}: ${pdfUrl}`);

        // Send via Twilio using the strictly verified Provider Name
        await sendWhatsAppMedia(phone, `📄 Here is your official quote from *${finalProviderName}*.`, pdfUrl);

        res.json({ success: true });
    } catch (e) {
        console.error("Quote Sending Error:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;