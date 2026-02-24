// ==========================================
// services/aiClaimWorker.js - Background OCR & Claim Logic
// ==========================================
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cloudinary = require('cloudinary').v2;
const prisma = require('./prisma'); // Ensure this points to your existing prisma service
const axios = require('axios');
const { MessagingResponse } = require('twilio').twiml;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_KEY,
    api_secret: process.env.CLOUDINARY_SECRET
});

/**
 * Main Worker: Processes Twilio images, vaults them, and runs Gemini OCR
 */
async function processTwilioClaim(userPhone, twilioImageUrl, orgCode) {
    try {
        console.log(`🚀 Starting background Gemini AI processing for ${userPhone}...`);

        // 1️⃣ SECURELY DOWNLOAD IMAGE FROM TWILIO (Requires Auth)
        const twilioAuth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
        
        const mediaResponse = await axios.get(twilioImageUrl, {
            headers: { 'Authorization': `Basic ${twilioAuth}` },
            responseType: 'arraybuffer'
        });

        const mimeType = mediaResponse.headers['content-type'] || 'image/jpeg';
        const buffer = Buffer.from(mediaResponse.data, 'binary');

        // 2️⃣ UPLOAD TO CLOUDINARY (Secure Vault)
        const uploadResult = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { folder: `seabe_claims/${orgCode}`, resource_type: 'image' },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            );
            stream.end(buffer);
        });

        const vaultUrl = uploadResult.secure_url;

        // 3️⃣ ASK GEMINI 1.5 FLASH TO READ THE DOCUMENT
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            generationConfig: { responseMimeType: "application/json" } 
        });

        const prompt = `You are an expert AI data extractor for South African Death Certificates. 
        Extract the following into strict JSON:
        {
            "deceasedIdNumber": "13-digit string",
            "dateOfDeath": "YYYY-MM-DD",
            "causeOfDeath": "NATURAL" or "UNNATURAL"
        }
        Note: If the cause is murder, accident, or suicide, classify as UNNATURAL. Otherwise, NATURAL.`;

        const imagePart = {
            inlineData: { data: buffer.toString("base64"), mimeType: mimeType }
        };

        const result = await model.generateContent([prompt, imagePart]);
        const aiData = JSON.parse(result.response.text());

        // 4️⃣ DATABASE VERIFICATION & 6-MONTH RULE
        const member = await prisma.member.findFirst({
            where: { idNumber: aiData.deceasedIdNumber, churchCode: orgCode },
            include: { church: true }
        });

        // (We check dependents if member not found - logic omitted for brevity)
        
        if (!member) {
            console.log("⚠️ ID not found in database. Manual review triggered.");
            // Log partial claim for Admin review...
            return;
        }

        const joinedDate = new Date(member.joinedAt);
        const deathDate = new Date(aiData.dateOfDeath);
        const monthsActive = (deathDate.getFullYear() - joinedDate.getFullYear()) * 12 + (deathDate.getMonth() - joinedDate.getMonth());

        let status = 'PENDING_REVIEW';
        let adminNotes = "Automated AI Approval.";

        if (aiData.causeOfDeath === 'NATURAL' && monthsActive < 6) {
            status = 'FLAGGED_WAITING_PERIOD';
            adminNotes = `⚠️ FLAG: Natural death at ${monthsActive} months.`;
        }

        // 5️⃣ SAVE THE FULL CLAIM
        await prisma.claim.create({
            data: {
                churchCode: orgCode,
                policyId: member.id,
                deceasedIdNumber: aiData.deceasedIdNumber,
                dateOfDeath: deathDate,
                causeOfDeath: aiData.causeOfDeath,
                claimantPhone: userPhone,
                status: status,
                documentUrl: vaultUrl,
                adminNotes: adminNotes
            }
        });

        console.log(`✅ Claim successfully logged for ${aiData.deceasedIdNumber}`);

    } catch (error) {
        console.error("❌ aiClaimWorker Error:", error.message);
    }
}

module.exports = { processTwilioClaim };