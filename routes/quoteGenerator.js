// routes/quoteGenerator.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const path = require('path');
const { sendWhatsAppMedia } = require('../services/twilioClient');

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

        // (Optional: If you add an Addons table later, you can query it here)
        const addons = []; 

        res.json({
            success: true,
            orgName: church.name,
            plans: plans,
            addons: addons
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
        
        // Save the PDF temporarily to the public folder so Twilio can grab it
        const fileName = `quote_${phone}_${Date.now()}.pdf`;
        const filePath = path.join(__dirname, '..', 'public', 'quotes'); // '..' goes up one folder from routes/
        
        if (!fs.existsSync(filePath)) {
            fs.mkdirSync(filePath, { recursive: true });
        }
        
        fs.writeFileSync(path.join(filePath, fileName), pureBase64, 'base64');
        
        // Generate the public URL
        const host = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
        const pdfUrl = `${host}/public/quotes/${fileName}`;

        // Send via Twilio using the media sender we built for Certificates!
        await sendWhatsAppMedia(phone, `📄 Here is your official quote from *${orgName}*.`, pdfUrl);

        res.json({ success: true });
    } catch (e) {
        console.error("Quote Sending Error:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;