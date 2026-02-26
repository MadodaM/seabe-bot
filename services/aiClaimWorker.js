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

async function processTwilioClaim(userPhone, twilioImageUrl, orgCode) {
    try {
        console.log(`🚀 AI WORKER: Initializing Gemini 2.5 Flash for ${userPhone}...`);

        // 1️⃣ SECURE DOWNLOAD
        const twilioAuth = Buffer.from(`${process.env.TWILIO_SID}:${process.env.TWILIO_AUTH}`).toString('base64');
        const mediaResponse = await axios.get(twilioImageUrl, {
            headers: { 'Authorization': `Basic ${twilioAuth}` },
            responseType: 'arraybuffer'
        });
        const mimeType = mediaResponse.headers['content-type'] || 'image/jpeg';
        const buffer = Buffer.from(mediaResponse.data, 'binary');

        // 2️⃣ CLOUDINARY VAULT (With Bulletproof JIT Injection)
        const uploadResult = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { 
                    folder: `seabe_claims/${orgCode}`, 
                    resource_type: 'auto',
                    // 🔥 Force-feed the keys right at the moment of upload
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

        // 3️⃣ GEMINI 2.5 FLASH DATA EXTRACTION
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash", 
            generationConfig: { responseMimeType: "application/json" } 
        });

        const prompt = `Act as a forensic document analyst. 
        Analyze the South African Death Certificate provided and extract:
        {
            "deceasedIdNumber": "13-digit string",
            "dateOfDeath": "YYYY-MM-DD",
            "causeOfDeath": "NATURAL" or "UNNATURAL"
        }
        Strict Classification Rule:
        Classify as "UNNATURAL" only if the certificate mentions murder, assault, accident, suicide, or an open inquiry. Otherwise, "NATURAL".`;

        const imagePart = {
            inlineData: { data: buffer.toString("base64"), mimeType: mimeType }
        };

        const result = await model.generateContent([prompt, imagePart]);
        const aiData = JSON.parse(result.response.text());

        // 4️⃣ POLICY LOOKUP & VALIDATION
        const member = await prisma.member.findFirst({
            where: { idNumber: aiData.deceasedIdNumber, societyCode: orgCode }
        });

        let status = 'PENDING_REVIEW';
        let adminNotes = "Gemini 2.5 Scan Successful.";

        if (member) {
            const joinedDate = new Date(member.joinedAt || new Date());
            const deathDate = new Date(aiData.dateOfDeath);
            const monthsDifference = (deathDate.getFullYear() - joinedDate.getFullYear()) * 12 + (deathDate.getMonth() - joinedDate.getMonth());

            if (aiData.causeOfDeath === 'NATURAL' && monthsDifference < 6) {
                status = 'FLAGGED_WAITING_PERIOD';
                adminNotes = `🚨 WAITING PERIOD VIOLATION: Natural death at ${monthsDifference} months. Policy requires 6 months.`;
            }
        } else {
            adminNotes = "⚠️ ID NOT RECOGNIZED: Deceased is not listed as a member or dependent in this society.";
            status = 'UNRECOGNIZED_ID';
        }

        // 5️⃣ PERSIST CLAIM
        const claimant = await prisma.member.findUnique({ where: { phone: userPhone } });
        
        // If for some reason the claimant isn't in the DB, we can't save the claim.
        if (!claimant) {
            throw new Error("Claimant not found in database.");
        }

        const benName = `${claimant.firstName} ${claimant.lastName}`;

        await prisma.claim.create({
            data: {
                church: { connect: { code: orgCode } }, 
                member: { connect: { id: claimant.id } }, 
                
                // 🛠️ FIX: Matching the standard Prisma schema field names
                idNumber: aiData.deceasedIdNumber, // Changed from deceasedIdNumber
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

        // 6️⃣ NOTIFY USER (Smart Messaging)
        if (status === 'UNRECOGNIZED_ID') {
            await sendWhatsApp(userPhone, `⚠️ *Claim Escalated*\n\nWe were unable to verify your policy or ID number. We have escalated the request, and a support agent will contact you within 24 hours.`);
        } else {
            await sendWhatsApp(userPhone, `✅ *Claim Processed by AI*\n\nDocument Read: ${aiData.deceasedIdNumber}\nStatus: *${status.replace(/_/g, ' ')}*\n\nAn administrator will verify the bank details for payout.`);
        }

    } catch (error) {
        console.error("❌ Gemini 2.5 Worker Error:", error.message);
        // 🛡️ Catch-All Safety Message if anything crashes
        await sendWhatsApp(userPhone, `⚠️ *System Alert*\n\nWe experienced an issue verifying your document. We have escalated the request, and a support agent will contact you within 24 hours.`);
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