// ==========================================
// aiClaimWorker.js - Background OCR & Claim Logic
// ==========================================
const { OpenAI } = require('openai');
const cloudinary = require('cloudinary').v2;
const { PrismaClient } = require('@prisma/client');
const { sendWhatsApp } = require('./whatsapp'); // Assuming your WhatsApp sender is here

const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Cloudinary config (will automatically use your .env variables)
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_KEY,
    api_secret: process.env.CLOUDINARY_SECRET
});

async function processTwilioClaim(userPhone, twilioImageUrl, orgCode) {
    try {
        console.log(`🚀 Starting background AI Claim processing for ${userPhone}...`);

        // 1️⃣ SECURELY DOWNLOAD IMAGE FROM TWILIO
        // We use your Twilio credentials to authenticate and grab the private image
        const twilioAuth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
        
        const mediaResponse = await fetch(twilioImageUrl, {
            headers: { 'Authorization': `Basic ${twilioAuth}` }
        });

        if (!mediaResponse.ok) throw new Error(`Twilio download failed: ${mediaResponse.statusText}`);
        
        const arrayBuffer = await mediaResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // 2️⃣ UPLOAD BUFFER TO CLOUDINARY
        // Instead of giving Cloudinary a URL, we directly stream the downloaded file to the vault
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

        // 2️⃣ ASK AI TO READ THE DOCUMENT
        const aiResponse = await openai.chat.completions.create({
            model: "gpt-4o",
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: `You are an expert AI data extractor for South African Death Certificates and DHA-1663 forms.
                    Extract the following data into strict JSON:
                    {
                        "deceasedIdNumber": "13-digit string",
                        "dateOfDeath": "YYYY-MM-DD",
                        "causeOfDeath": "NATURAL" or "UNNATURAL"
                    }
                    Note: If the cause is murder, accident, or suicide, classify as UNNATURAL. Otherwise, NATURAL.`
                },
                {
                    role: "user",
                    content: [{ type: "image_url", image_url: { url: vaultUrl } }]
                }
            ]
        });

        const aiData = JSON.parse(aiResponse.choices[0].message.content);

        // Fail-safe: AI couldn't read the ID
        if (!aiData.deceasedIdNumber) {
            return await sendWhatsApp(userPhone, "❌ *Document Unreadable*\n\nWe couldn't clearly read the 13-digit ID number. Please take a closer, clearer photo and try again (Option 6).");
        }

        // 3️⃣ DATABASE VERIFICATION & 6-MONTH RULE
        // Check if this ID belongs to the main member or a dependent
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

        // Get the date the policy started
        const joinedDate = mainMember ? mainMember.joinedAt : dependent.member.joinedAt;
        const deathDate = new Date(aiData.dateOfDeath);
        
        // Calculate months between joining and death
        const monthsActive = (deathDate.getFullYear() - joinedDate.getFullYear()) * 12 + (deathDate.getMonth() - joinedDate.getMonth());

        // Apply Surepol 6-Month Rule
        let isWaitingPeriodValid = true;
        let adminNote = "Automated AI Approval.";

        if (aiData.causeOfDeath === 'NATURAL' && monthsActive < 6) {
            isWaitingPeriodValid = false;
            adminNote = `⚠️ AI FLAGGED: Natural death occurred at ${monthsActive} months (Before 6-month waiting period).`;
        }

        // 4️⃣ LOG THE CLAIM IN THE DATABASE
        await prisma.claim.create({
            data: {
                policyId: mainMember ? mainMember.id : dependent.member.id,
                deceasedIdNumber: aiData.deceasedIdNumber,
                dateOfDeath: deathDate,
                causeOfDeath: aiData.causeOfDeath,
                claimantPhone: userPhone,
                status: isWaitingPeriodValid ? 'PENDING_REVIEW' : 'FLAGGED_WAITING_PERIOD',
                documentUrl: vaultUrl,
                adminNotes: adminNote,
                churchCode: orgCode
            }
        });

        // 5️⃣ NOTIFY THE FAMILY
        if (!isWaitingPeriodValid) {
            await sendWhatsApp(userPhone, `⚠️ *Claim Flagged*\n\nWe successfully read ID: *${aiData.deceasedIdNumber}*.\n\nHowever, our system indicates the policy has not yet passed the 6-month waiting period for Natural causes. An admin will review this manually and contact you.`);
        } else {
            await sendWhatsApp(userPhone, `✅ *Claim Logged Successfully*\n\nID: *${aiData.deceasedIdNumber}*\nDate: *${aiData.dateOfDeath}*\n\nYour document has been securely saved. An admin is reviewing your claim and will reach out to arrange the payout or burial services.`);
        }

        console.log(`✅ Background AI Claim completed for ${aiData.deceasedIdNumber}`);

    } catch (error) {
        console.error("❌ ProcessTwilioClaim Error:", error);
        await sendWhatsApp(userPhone, "⚠️ We encountered a technical issue processing your document. An admin has been notified.");
    }
}

module.exports = { processTwilioClaim };