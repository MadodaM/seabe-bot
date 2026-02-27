// ==========================================
// services/aiClaimWorker.js - Background OCR
// ==========================================
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cloudinary = require('cloudinary').v2;
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient(); 
const axios = require('axios');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_KEY,
    api_secret: process.env.CLOUDINARY_SECRET
});

// Initialize Twilio
let twilioClient;
if (process.env.TWILIO_SID && process.env.TWILIO_AUTH) {
    twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
}

const sendWhatsApp = async (to, body) => {
    if (!twilioClient) return;
    try {
        await twilioClient.messages.create({
            from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '')}`,
            to: `whatsapp:${to}`,
            body: body
        });
    } catch (e) { console.error("Worker Notify Error:", e.message); }
};

// ==========================================
// UPGRADED processTwilioClaim (Fraud Engine)
// ==========================================
async function processTwilioClaim(userPhone, twilioImageUrl, orgCode) {
    try {
        console.log(`🚀 AI FRAUD ENGINE: Initializing Forensic Scan for ${userPhone}...`);

        // 1️⃣ SECURE DOWNLOAD
        const twilioAuth = Buffer.from(`${process.env.TWILIO_SID}:${process.env.TWILIO_AUTH}`).toString('base64');
        const mediaResponse = await axios.get(twilioImageUrl, {
            headers: { 'Authorization': `Basic ${twilioAuth}` },
            responseType: 'arraybuffer'
        });
        const mimeType = mediaResponse.headers['content-type'] || 'image/jpeg';
        const buffer = Buffer.from(mediaResponse.data, 'binary');

        // 2️⃣ CLOUDINARY VAULT
        const uploadResult = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { 
                    folder: `seabe_claims/${orgCode}`, 
                    resource_type: 'auto',
                    cloud_name: process.env.CLOUDINARY_NAME || process.env.CLOUDINARY_CLOUD_NAME,
                    api_key: process.env.CLOUDINARY_KEY || process.env.CLOUDINARY_API_KEY,
                    api_secret: process.env.CLOUDINARY_SECRET || process.env.CLOUDINARY_API_SECRET
                },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            );
            stream.end(buffer);
        });

        // 3️⃣ FORENSIC GEMINI 2.5 EXTRACTION & TAMPER CHECK
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash", 
            generationConfig: { responseMimeType: "application/json" } 
        });

        const prompt = `Act as an expert forensic document analyst for a South African insurance provider. 
        Analyze this South African Death Certificate (DHA-1663) and extract the data. 
        CRITICAL: Perform a deep visual inspection for fraud. Look for mismatched fonts, misaligned text blocks, digital artifacts, pixel blurring around names/dates, or signs of Photoshop/tampering.
        
        Respond ONLY with this JSON structure:
        {
            "deceasedIdNumber": "13-digit string",
            "dateOfDeath": "YYYY-MM-DD",
            "causeOfDeath": "NATURAL" or "UNNATURAL",
            "fraudScore": number (0 = authentic, 100 = obviously tampered/fake),
            "fraudIndicators": ["List of specific visual anomalies found", "e.g., mismatched font on ID number", "digital blur around date". Leave empty if none.]
        }`;

        const imagePart = {
            inlineData: { data: buffer.toString("base64"), mimeType: mimeType }
        };

        const result = await model.generateContent([prompt, imagePart]);
        const aiData = JSON.parse(result.response.text());

        let status = 'PENDING_REVIEW';
        let adminNotes = `✅ AI Scan Complete. Fraud Score: ${aiData.fraudScore}/100.`;

        // 4️⃣ THE PLATFORM-WIDE DUPLICATE CHECK (The "Recycled Claim" Shield)
        // We query the ENTIRE database, ignoring churchCode, to see if this ID was claimed anywhere else.
        const duplicateClaims = await prisma.claim.findMany({
            where: { deceasedIdNumber: aiData.deceasedIdNumber }
        });

        if (duplicateClaims.length > 0) {
            status = 'FLAGGED_FRAUD_DUPLICATE';
            adminNotes = `🚨 CRITICAL FRAUD: This ID Number (${aiData.deceasedIdNumber}) has already been claimed ${duplicateClaims.length} time(s) on the Seabe network!`;
            console.warn(adminNotes);
        }

        // 5️⃣ FORENSIC AI TAMPER EVALUATION
        // Ensure fraudScore is treated as a number in case the LLM tries to return a string
        const parsedFraudScore = Number(aiData.fraudScore);
        if (status !== 'FLAGGED_FRAUD_DUPLICATE' && parsedFraudScore > 60) {
            status = 'FLAGGED_FRAUD_TAMPERING';
            adminNotes = `🚨 AI TAMPER WARNING: High fraud probability (${parsedFraudScore}/100). Indicators: ${aiData.fraudIndicators.join(', ')}`;
        }

        // 6️⃣ POLICY WAITING PERIOD VALIDATION
        const member = await prisma.member.findFirst({
            where: { idNumber: aiData.deceasedIdNumber, societyCode: orgCode }
        });

        if (!member) {
            if (status === 'PENDING_REVIEW') status = 'UNRECOGNIZED_ID';
            adminNotes += " | ⚠️ ID not listed as member/dependent in this society.";
        } else if (status === 'PENDING_REVIEW') {
            const joinedDate = new Date(member.joinedAt || new Date());
            const deathDate = new Date(aiData.dateOfDeath);
            const monthsDifference = (deathDate.getFullYear() - joinedDate.getFullYear()) * 12 + (deathDate.getMonth() - joinedDate.getMonth());

            if (aiData.causeOfDeath === 'NATURAL' && monthsDifference < 6) {
                status = 'FLAGGED_WAITING_PERIOD';
                adminNotes += ` | 🚨 POLICY VIOLATION: Natural death at ${monthsDifference} months (requires 6).`;
            }
        }

        // 7️⃣ PERSIST CLAIM TO DATABASE
        const claimant = await prisma.member.findUnique({ where: { phone: userPhone } });
        if (!claimant) throw new Error("Claimant not found in database.");

        const benName = `${claimant.firstName} ${claimant.lastName}`;

        await prisma.claim.create({
            data: {
                churchCode: orgCode, 
                memberPhone: userPhone, 
                deceasedIdNumber: aiData.deceasedIdNumber, 
                dateOfDeath: new Date(aiData.dateOfDeath),
                causeOfDeath: aiData.causeOfDeath,
                claimantPhone: userPhone,
                beneficiaryName: benName,
                payoutAmount: 0,
                status: status,
                documentUrl: uploadResult.secure_url,
                adminNotes: adminNotes
            }
        });

        // 8️⃣ SMART USER NOTIFICATION (Stealth Messaging)
        if (status.includes('FRAUD')) {
            // We give them a generic message so they don't know they've been caught
            await sendWhatsApp(userPhone, `🔍 *Claim Under Review*\n\nYour document for ID ending in *${aiData.deceasedIdNumber.slice(-4)}* has been received. This claim requires manual validation by our compliance team. We will contact you shortly.`);
        } else if (status === 'UNRECOGNIZED_ID') {
            await sendWhatsApp(userPhone, `⚠️ *Claim Escalated*\n\nWe were unable to verify your policy or ID number. We have escalated the request.`);
        } else {
            await sendWhatsApp(userPhone, `✅ *Claim Processed by AI*\n\nDocument Read: ${aiData.deceasedIdNumber}\nStatus: *${status.replace(/_/g, ' ')}*\n\nAn administrator will verify the details for payout.`);
        }

    } catch (error) {
        console.error("❌ Gemini Fraud Engine Error:", error.message);
        await sendWhatsApp(userPhone, `⚠️ *System Alert*\n\nWe experienced an issue processing your document. A support agent will contact you within 24 hours.`);
    }
}

// ==========================================
// ✨ ADMIN DASHBOARD: DIRECT FILE OCR
// ==========================================
async function analyzeAdminDocument(filePath, mimeType) {
    const fs = require('fs');
    try {
        console.log(`🚀 AI WORKER: Analyzing Admin Upload...`);
        const buffer = fs.readFileSync(filePath);

        // 1️⃣ CLOUDINARY VAULT (With Bulletproof JIT Injection)
        const uploadResult = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { 
                    folder: 'seabe_admin_claims', // 🛠️ Correct folder for admin uploads
                    resource_type: 'auto',
                    cloud_name: process.env.CLOUDINARY_NAME || process.env.CLOUDINARY_CLOUD_NAME,
                    api_key: process.env.CLOUDINARY_KEY || process.env.CLOUDINARY_API_KEY,
                    api_secret: process.env.CLOUDINARY_SECRET || process.env.CLOUDINARY_API_SECRET
                },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            );
            stream.end(buffer);
        });

        // 2️⃣ GEMINI 2.5 FLASH EXTRACTION
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash", 
            generationConfig: { responseMimeType: "application/json" } 
        });

        const prompt = `Act as a forensic document analyst. 
        Analyze this South African Death Certificate (DHA-1663) and extract:
        {
            "deceasedIdNumber": "13-digit string or 'UNREADABLE'",
            "dateOfDeath": "YYYY-MM-DD",
            "causeOfDeath": "NATURAL" or "UNNATURAL",
            "confidenceScore": number between 1 and 100,
            "documentType": "String identifying the document type"
        }
        Strict Classification Rule: Classify as "UNNATURAL" only if it mentions murder, assault, accident, suicide, or an open inquiry.`;

        const imagePart = {
            inlineData: { data: buffer.toString("base64"), mimeType: mimeType }
        };

        const result = await model.generateContent([prompt, imagePart]);
        const aiData = JSON.parse(result.response.text());

        // Clean up the temp file
        fs.unlinkSync(filePath);

        return { extractedData: aiData, vaultUrl: uploadResult.secure_url };

    } catch (error) {
        console.error("❌ Admin OCR Error:", error.message);
        throw error;
    }
}

module.exports = { processTwilioClaim, analyzeAdminDocument };