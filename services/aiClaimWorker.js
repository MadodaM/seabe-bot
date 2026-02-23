// ==========================================
// aiClaimWorker.js - Background OCR & Claim Logic (Powered by Gemini)
// ==========================================
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cloudinary = require('cloudinary').v2;
const { PrismaClient } = require('@prisma/client');
const { sendWhatsApp } = require('./whatsapp'); 

const prisma = new PrismaClient();

// Initialize Gemini (Will crash if GEMINI_API_KEY is missing!)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_KEY,
    api_secret: process.env.CLOUDINARY_SECRET
});

async function processTwilioClaim(userPhone, twilioImageUrl, orgCode) {
    try {
        console.log(`🚀 Starting background Gemini AI processing for ${userPhone}...`);

        // 1️⃣ SECURELY DOWNLOAD IMAGE FROM TWILIO
        const twilioAuth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
        
        const mediaResponse = await fetch(twilioImageUrl, {
            headers: { 'Authorization': `Basic ${twilioAuth}` }
        });

        if (!mediaResponse.ok) throw new Error(`Twilio download failed: ${mediaResponse.statusText}`);
        
        // Grab the mime type (usually image/jpeg) and the raw buffer
        const mimeType = mediaResponse.headers.get('content-type') || 'image/jpeg';
        const arrayBuffer = await mediaResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // 2️⃣ UPLOAD BUFFER TO CLOUDINARY
        const uploadResult = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { folder: `surepol_claims/${orgCode}`, resource_type: 'image' },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            );
            stream.end(buffer);
        });

        const vaultUrl = uploadResult.secure_url;

        // 3️⃣ ASK GEMINI TO READ THE DOCUMENT
        // We use gemini-1.5-flash because it is incredibly fast and cheap/free
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            generationConfig: { responseMimeType: "application/json" } // Force strict JSON
        });

        const prompt = `You are an expert AI data extractor for South African Death Certificates and DHA-1663 forms.
        Extract the following data into strict JSON:
        {
            "deceasedIdNumber": "13-digit string",
            "dateOfDeath": "YYYY-MM-DD",
            "causeOfDeath": "NATURAL" or "UNNATURAL"
        }
        Note: If the cause is murder, accident, or suicide, classify as UNNATURAL. Otherwise, NATURAL.
        If you cannot read a field, leave it as null.`;

        // Package the raw image buffer for Gemini
        const imagePart = {
            inlineData: {
                data: buffer.toString("base64"),
                mimeType: mimeType
            }
        };

        const result = await model.generateContent([prompt, imagePart]);
        const responseText = result.response.text();
        const aiData = JSON.parse(responseText);

        if (!aiData.deceasedIdNumber) {
            return await sendWhatsApp(userPhone, "❌ *Document Unreadable*\n\nWe couldn't clearly read the 13-digit ID number. Please take a closer, clearer photo and try again (Option 6).");
        }

        // 4️⃣ DATABASE VERIFICATION & 6-MONTH RULE
        const mainMember = await prisma.member.findFirst({
            where: { idNumber: aiData.deceasedIdNumber, churchCode: orgCode }
        });

        const dependent = await prisma.dependent.findFirst({
            where: { idNumber: aiData.deceasedIdNumber, member: { churchCode: orgCode } },
            include: { member: true }
        });

        const deceasedRecord = mainMember || dependent;
        
        if (!deceasedRecord) {
            return await sendWhatsApp(userPhone, `⚠️ *ID Not Found*\n\nThe ID number ${aiData.deceasedIdNumber} is not registered on this policy. Please contact an admin.`);
        }

        const joinedDate = mainMember ? mainMember.joinedAt : dependent.member.joinedAt;
        const deathDate = new Date(aiData.dateOfDeath);
        
        const monthsActive = (deathDate.getFullYear() - joinedDate.getFullYear()) * 12 + (deathDate.getMonth() - joinedDate.getMonth());

        let isWaitingPeriodValid = true;
        let adminNote = "Automated AI Approval.";

        if (aiData.causeOfDeath === 'NATURAL' && monthsActive < 6) {
            isWaitingPeriodValid = false;
            adminNote = `⚠️ AI FLAGGED: Natural death occurred at ${monthsActive} months (Before 6-month waiting period).`;
        }

        // 5️⃣ LOG THE CLAIM IN THE DATABASE
        await prisma.claim.create({
            data: {
                churchCode: orgCode,
                policyId: mainMember ? mainMember.id : dependent.member.id,
                deceasedIdNumber: aiData.deceasedIdNumber,
                dateOfDeath: deathDate,
                causeOfDeath: aiData.causeOfDeath,
                claimantPhone: userPhone,
                status: isWaitingPeriodValid ? 'PENDING_REVIEW' : 'FLAGGED_WAITING_PERIOD',
                documentUrl: vaultUrl,
                adminNotes: adminNote
            }
        });

        // 6️⃣ NOTIFY THE FAMILY
        if (!isWaitingPeriodValid) {
            await sendWhatsApp(userPhone, `⚠️ *Claim Flagged*\n\nWe successfully read ID: *${aiData.deceasedIdNumber}*.\n\nHowever, our system indicates the policy has not yet passed the 6-month waiting period for Natural causes. An admin will review this manually and contact you.`);
        } else {
            await sendWhatsApp(userPhone, `✅ *Claim Logged Successfully*\n\nID: *${aiData.deceasedIdNumber}*\nDate: *${aiData.dateOfDeath}*\n\nYour document has been securely saved. An admin is reviewing your claim and will reach out to arrange the payout or burial services.`);
        }

        console.log(`✅ Background Gemini Claim completed for ${aiData.deceasedIdNumber}`);

    } catch (error) {
        console.error("❌ ProcessTwilioClaim Error:", error);
        await sendWhatsApp(userPhone, "⚠️ We encountered a technical issue processing your document. An admin has been notified.");
    }
}

module.exports = { processTwilioClaim };