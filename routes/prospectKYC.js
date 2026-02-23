// ==========================================
// prospectKYC.js - B2B Church/Society Onboarding & FICA
// ==========================================
const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Use your global Prisma instance
const prisma = require('../services/prisma'); 

// Initialize AI and Multer
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const upload = multer({ dest: 'uploads/' });

// ---------------------------------------------------------
// STAGE 1: INITIAL REGISTRATION (Level 1 FICA)
// ---------------------------------------------------------
router.post('/register-church', upload.fields([
    { name: 'pastorId', maxCount: 1 },
    { name: 'proofOfBank', maxCount: 1 }
]), async (req, res) => {
    const { churchName, officialEmail, type } = req.body;

    try {
        if (!req.files['pastorId'] || !req.files['proofOfBank']) {
            return res.status(400).json({ error: "Please upload both Pastor ID and Proof of Bank." });
        }

        const pastorIdPath = req.files['pastorId'][0].path;
        const bankPath = req.files['proofOfBank'][0].path;

        // 1. Vault the Level 1 Documents
        const pastorIdUpload = await cloudinary.uploader.upload(pastorIdPath, { folder: 'fica/level1' });
        const bankUpload = await cloudinary.uploader.upload(bankPath, { folder: 'fica/level1' });

        // 2. Read the file into memory for AI, THEN delete the temp file
        const pastorIdBuffer = fs.readFileSync(pastorIdPath);
        fs.unlinkSync(pastorIdPath);
        fs.unlinkSync(bankPath);

        // 3. AI OCR: Read the Pastor's ID instantly
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash", 
            generationConfig: { responseMimeType: "application/json" } 
        });
        
        const prompt = `Analyze this South African ID. Extract details into strict JSON:
        { "idNumber": "13-digit string", "firstName": "string", "lastName": "string", "confidenceScore": number }`;
        
        const imagePart = {
            inlineData: {
                data: pastorIdBuffer.toString("base64"),
                mimeType: req.files['pastorId'][0].mimetype
            }
        };

        const result = await model.generateContent([prompt, imagePart]);
        const aiData = JSON.parse(result.response.text());

        // 4. Create the Church Record in "LEVEL_1_PENDING" state
        const tempCode = `CH-${Date.now().toString().slice(-4)}`;
        
        const newChurch = await prisma.church.create({
            data: {
                code: tempCode, 
                name: churchName,
                email: officialEmail,         // Required by your original schema
                pastorIdUrl: pastorIdUpload.secure_url,
                proofOfBankUrl: bankUpload.secure_url,
                ficaStatus: 'LEVEL_1_PENDING',
                type: type || 'CHURCH',        // 🚨 THE FIX 🚨
                subaccountCode: 'PENDING_KYC'  // Added to match web.js
            }
        });

        res.status(201).json({ 
            message: "Level 1 Registration complete. Awaiting Admin Review.", 
            churchCode: newChurch.code,
            aiExtractedData: aiData
        });

    } catch (error) {
        console.error("❌ Level 1 FICA Error:", error);
        res.status(500).json({ error: "Failed to process registration." });
    }
});

// ---------------------------------------------------------
// STAGE 2: ADMIN APPROVES LEVEL 1 (Triggers Email)
// ---------------------------------------------------------
router.post('/admin/approve-level-1', async (req, res) => {
    const { churchId } = req.body;

    try {
        const church = await prisma.church.update({
            where: { id: parseInt(churchId) },
            data: { ficaStatus: 'AWAITING_LEVEL_2' }
        });

        // 📧 TRIGGER EMAIL TO CHURCH LEADER
        console.log(`📧 MOCK EMAIL SENT TO: ${church.officialEmail}`);
        console.log(`Subject: Action Required - FICA Level 2 for ${church.name}`);
        console.log(`Body: Please upload your CIPC/NPC docs at https://seabe-bot-test.onrender.com/kyb-upload/${church.code}`);

        res.status(200).json({ message: "Level 1 Approved. Email sent requesting corporate documents." });

    } catch (error) {
        console.error("❌ Level 1 Approval Error:", error);
        res.status(500).json({ error: "Failed to approve Level 1." });
    }
});

// ---------------------------------------------------------
// STAGE 3: CHURCH UPLOADS LEVEL 2 CORPORATE DOCS
// ---------------------------------------------------------
router.post('/upload-level-2/:churchCode', upload.fields([
    { name: 'npcReg', maxCount: 1 },
    { name: 'cipcDoc', maxCount: 1 },
    { name: 'directorIds', maxCount: 1 }
]), async (req, res) => {
    const { churchCode } = req.params;

    try {
        // 1. Vault the Corporate Documents
        let npcRegUrl = null;
        let cipcDocUrl = null;
        let directorIdsUrl = null;

        if (req.files['npcReg']) {
            const uploadRes = await cloudinary.uploader.upload(req.files['npcReg'][0].path, { folder: 'fica/level2' });
            npcRegUrl = uploadRes.secure_url;
            fs.unlinkSync(req.files['npcReg'][0].path);
        }
        
        if (req.files['cipcDoc']) {
            const uploadRes = await cloudinary.uploader.upload(req.files['cipcDoc'][0].path, { folder: 'fica/level2' });
            cipcDocUrl = uploadRes.secure_url;
            fs.unlinkSync(req.files['cipcDoc'][0].path);
        }

        if (req.files['directorIds']) {
            const uploadRes = await cloudinary.uploader.upload(req.files['directorIds'][0].path, { folder: 'fica/level2' });
            directorIdsUrl = uploadRes.secure_url;
            fs.unlinkSync(req.files['directorIds'][0].path);
        }

        // 2. Update Database to LEVEL_2_PENDING
        await prisma.church.update({
            where: { code: churchCode },
            data: {
                npcRegUrl,
                cipcDocUrl,
                directorIdsUrl,
                ficaStatus: 'LEVEL_2_PENDING'
            }
        });

        res.status(200).json({ message: "Level 2 Documents received. Awaiting Final Admin Approval." });

    } catch (error) {
        console.error("❌ Level 2 Upload Error:", error);
        res.status(500).json({ error: "Failed to upload corporate documents." });
    }
});

// ---------------------------------------------------------
// STAGE 4: ADMIN FINAL APPROVAL (NetCash API Trigger)
// ---------------------------------------------------------
router.post('/admin/approve-final', async (req, res) => {
    const { churchId } = req.body;

    try {
        // 1. Fetch the full FICA profile
        const church = await prisma.church.findUnique({ where: { id: parseInt(churchId) } });

        if (!church) return res.status(404).json({ error: "Church not found." });

        // 2. 🚀 TRIGGER NETCASH API HERE
        console.log(`🏦 MOCK NETCASH API CALL: Creating Sub-Account for ${church.name}...`);
        // const netCashResponse = await createNetCashSubAccount(church);
        const mockNetCashAccountId = `NC-${Date.now()}`;

        // 3. Mark Church as ACTIVE and save NetCash reference
        await prisma.church.update({
            where: { id: parseInt(churchId) },
            data: { 
                ficaStatus: 'ACTIVE',
                // netCashAccountId: mockNetCashAccountId // Update your schema if you want to save this!
            }
        });

        res.status(200).json({ 
            message: "FICA Finalized. NetCash Sub-Account created successfully.",
            netCashAccountId: mockNetCashAccountId
        });

    } catch (error) {
        console.error("❌ Final Approval Error:", error);
        res.status(500).json({ error: "Failed to finalize FICA and create NetCash account." });
    }
});

module.exports = router;