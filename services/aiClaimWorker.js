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

        // 2️⃣ CLOUDINARY VAULT
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

        // 3️⃣ GEMINI 2.5 FLASH DATA EXTRACTION
        // Note: Using 2.5-flash for superior extraction accuracy
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
        await prisma.claim.create({
            data: {
                societyCode: orgCode,
                deceasedIdNumber: aiData.deceasedIdNumber,
                dateOfDeath: new Date(aiData.dateOfDeath),
                causeOfDeath: aiData.causeOfDeath,
                claimantPhone: userPhone,
                status: status,
                documentUrl: uploadResult.secure_url,
                adminNotes: adminNotes
            }
        });

        // 6️⃣ NOTIFY USER
        await sendWhatsApp(userPhone, `✅ *Claim Processed by AI*\n\nDocument Read: ${aiData.deceasedIdNumber}\nStatus: *${status.replace(/_/g, ' ')}*\n\nAn administrator will verify the bank details for payout.`);

    } catch (error) {
        console.error("❌ Gemini 2.5 Worker Error:", error.message);
        // Fallback or Admin notification could go here
    }
}

module.exports = { processTwilioClaim };