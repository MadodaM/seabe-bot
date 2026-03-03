// routes/kyc.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { encrypt } = require('../utils/crypto');
const prisma = new PrismaClient();
const crypto = require('crypto');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 1️⃣ Configure Cloud Storage
if (process.env.CLOUDINARY_URL) {
    console.log("☁️ Cloudinary: Connecting via CLOUDINARY_URL...");
} else {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_NAME,
        api_key: process.env.CLOUDINARY_KEY || process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_SECRET || process.env.CLOUDINARY_API_SECRET
    });
}

// 2️⃣ Configure Secure Upload Handling (RAM Storage)
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 🔒 Limit: 5MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('❌ Invalid File Type. Only JPG, PNG, or PDF allowed.'));
        }
    }
});

// Helper: Stream Buffer to Cloudinary
const uploadToCloud = (buffer) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { 
                folder: "kyc_docs", 
                resource_type: "auto",
                cloud_name: process.env.CLOUDINARY_NAME,
                api_key: process.env.CLOUDINARY_KEY || process.env.CLOUDINARY_API_KEY,
                api_secret: process.env.CLOUDINARY_SECRET || process.env.CLOUDINARY_API_SECRET
            },
            (error, result) => {
                if (error) reject(error);
                else resolve(result.secure_url);
            }
        );
        stream.end(buffer);
    });
};

// 3️⃣ Initialize Twilio for Automatic Confirmations
let twilioClient;
if (process.env.TWILIO_SID && process.env.TWILIO_AUTH) {
    twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
}

const sendWhatsApp = async (to, body) => {
    if (!twilioClient) return console.log("⚠️ Twilio Keys Missing! Could not send KYC confirmation.");
    const cleanTwilioNumber = process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '');
    
    // Ensure clean +27 format for Twilio
    const cleanToNumber = to.startsWith('+') ? to : `+${to.replace(/\D/g, '')}`;

    try {
        await twilioClient.messages.create({
            from: `whatsapp:${cleanTwilioNumber}`,
            to: `whatsapp:${cleanToNumber}`,
            body: body
        });
        console.log(`✅ KYC Confirmation delivered to ${cleanToNumber}`);
    } catch (err) {
        console.error("❌ Twilio Send Error:", err.message);
    }
};

// Helper: Generate Link (🚀 FIX: Multi-Tenant Safe Lookup)
async function generateKYCLink(phone, host, memberId = null) {
    const token = crypto.randomBytes(16).toString('hex');
    
    // Find the specific member to attach the token to
    let targetId = memberId;
    if (!targetId) {
        const member = await prisma.member.findFirst({
            where: { phone: phone },
            orderBy: { id: 'desc' }
        });
        if (member) targetId = member.id;
    }

    if (targetId) {
        await prisma.member.update({
            where: { id: targetId }, // Safely update by specific ID
            data: { kycToken: token, kycTokenExpires: new Date(Date.now() + 86400000) } // 24 hours
        });
    }
    
    return `https://${host}/kyc/${token}`;
}

// GET: The Form
router.get('/:token', async (req, res) => {
    const member = await prisma.member.findFirst({
        where: { kycToken: req.params.token, kycTokenExpires: { gte: new Date() } }
    });
    if (!member) return res.send("<h3>❌ Link Expired</h3><p>Please request a new KYC link from the WhatsApp menu.</p>");

    res.send(`
        <!DOCTYPE html><html><head><title>Upload Documents</title><meta name="viewport" content="width=device-width, initial-scale=1">
        <style>body{font-family:sans-serif;padding:20px;background:#f4f7f6;} .card{background:white;padding:25px;border-radius:12px;box-shadow:0 4px 10px rgba(0,0,0,0.1);max-width:400px;margin:auto;} input, select, textarea{width:100%;padding:12px;margin:10px 0;border:1px solid #ddd;border-radius:6px;} button{width:100%;padding:15px;background:#1e272e;color:white;border:none;border-radius:6px;font-weight:bold; cursor:pointer;} .file-label{display:block;margin-top:10px;font-weight:bold;font-size:0.9em;color:#555;}</style>
        </head><body><div class="card">
            <h2>📂 Document Upload</h2>
            <p>Please upload clear photos of your documents (Max 5MB).</p>
            <form action="/kyc/${req.params.token}" method="POST" enctype="multipart/form-data">
                
                <label class="file-label">Select ID Type</label>
                <select name="idType"><option value="SA_ID">SA ID Document</option><option value="PASSPORT">Passport</option></select>

                <label class="file-label">ID / Passport Number</label>
                <input name="idNumber" required placeholder="Type number manually">
                
                <label class="file-label">Physical Address</label>
                <textarea name="address" required placeholder="Type your address"></textarea>

                <hr style="border:0; border-top:1px solid #eee; margin:20px 0;">

                <label class="file-label">📸 Upload Photo of ID / Passport</label>
                <input type="file" name="idPhoto" accept="image/*,application/pdf" required>

                <label class="file-label">📄 Upload Proof of Address (Bill/Statement)</label>
                <input type="file" name="addressProof" accept="image/*,application/pdf" required>
                
                <button type="submit">🔒 Encrypt & Submit</button>
            </form>
        </div></body></html>
    `);
});

// POST: Handle Files + Data
router.post('/:token', (req, res) => {
    const uploadMiddleware = upload.fields([{ name: 'idPhoto' }, { name: 'addressProof' }]);

    uploadMiddleware(req, res, async (err) => {
        if (err) {
            console.error("Upload Blocked:", err.message);
            return res.send(`
                <div style='text-align:center; padding:50px; font-family:sans-serif;'>
                    <h2 style="color:red;">❌ Upload Failed</h2>
                    <p>${err.message}</p>
                    <p>Max size is 5MB. Only Images and PDFs allowed.</p>
                    <a href="/kyc/${req.params.token}" style="padding:10px 20px; background:#333; color:white; text-decoration:none; border-radius:5px;">Try Again</a>
                </div>
            `);
        }

        try {
            console.log("Processing KYC Upload...");
            
            // 🚀 FIX: Safely retrieve the member before updating
            const targetMember = await prisma.member.findFirst({
                where: { kycToken: req.params.token, kycTokenExpires: { gte: new Date() } }
            });

            if (!targetMember) {
                return res.send("<h3>❌ Link Expired</h3><p>Please request a new KYC link from the WhatsApp menu.</p>");
            }

            // 1. Upload files to Cloudinary
            let idPhotoUrl = null;
            let addressProofUrl = null;

            if (req.files['idPhoto']) {
                idPhotoUrl = await uploadToCloud(req.files['idPhoto'][0].buffer);
            }
            if (req.files['addressProof']) {
                addressProofUrl = await uploadToCloud(req.files['addressProof'][0].buffer);
            }

            // 2. Encrypt Text & URLs
            const encryptedID = encrypt(req.body.idNumber);
            const encryptedAddress = encrypt(req.body.address);
            const encryptedIdUrl = encrypt(idPhotoUrl);
            const encryptedProofUrl = encrypt(addressProofUrl);

            // 3. Save to DB (🚀 FIX: Update strictly by ID)
            const updatedMember = await prisma.member.update({
                where: { id: targetMember.id },
                data: { 
                    idType: req.body.idType,
                    idNumber: encryptedID,
                    address: encryptedAddress,
                    idPhotoUrl: encryptedIdUrl,
                    proofOfAddressUrl: encryptedProofUrl,
                    kycToken: null, 
                    kycTokenExpires: null 
                }
            });

            // 4. 🚀 TRIGGER AI OCR & WHATSAPP CONFIRMATION (Background)
            if (updatedMember.phone) {
                (async () => {
                    try {
                        console.log(`🤖 Sending KYC ID to Gemini 2.5 Flash...`);
                        let aiMessage = "";

                        // If an ID photo was uploaded, run OCR!
                        if (req.files['idPhoto']) {
                            const mimeType = req.files['idPhoto'][0].mimetype;
                            const base64Data = req.files['idPhoto'][0].buffer.toString("base64");

                            const model = genAI.getGenerativeModel({ 
                                model: "gemini-2.5-flash",
                                generationConfig: { responseMimeType: "application/json" }
                            });

                            const prompt = `Act as a KYC verification agent. Read this South African ID or Passport.
                            Extract the following into strict JSON:
                            {
                                "extractedIdNumber": "string",
                                "firstName": "string",
                                "lastName": "string",
                                "dateOfBirth": "YYYY-MM-DD"
                            }
                            If a field is blurry or unreadable, output "UNKNOWN".`;

                            const result = await model.generateContent([
                                prompt, 
                                { inlineData: { data: base64Data, mimeType: mimeType } }
                            ]);
                            
                            const aiData = JSON.parse(result.response.text());
                            console.log("🤖 KYC AI Extraction:", aiData);

                            // Compare what they typed vs what the AI read
                            const matchStatus = (aiData.extractedIdNumber === req.body.idNumber) ? "✅ *100% Match*" : "⚠️ *Mismatch Detected*";

                            aiMessage = `✅ *KYC Documents Received!*\n\nHi ${aiData.firstName !== "UNKNOWN" ? aiData.firstName : 'Member'},\n\nOur AI has instantly scanned your ID:\n🆔 Extracted: ${aiData.extractedIdNumber}\n📊 AI Verification: ${matchStatus}\n\nOur team will securely review your proof of address next.`;
                        } else {
                            aiMessage = `✅ *Documents Received!*\n\nHi ${updatedMember.firstName || 'Member'}, we have securely received your documents for review.`;
                        }

                        await sendWhatsApp(updatedMember.phone, aiMessage);

                    } catch (aiError) {
                        console.error("❌ KYC AI OCR Error:", aiError.message);
                        // Fallback if AI is busy
                        await sendWhatsApp(updatedMember.phone, `✅ *Documents Received!*\n\nYour documents have been securely stored. Our team will review them shortly.`);
                    }
                })();
            }

            res.send(`
                <div style='text-align:center; padding:50px; font-family:sans-serif;'>
                    <h1 style="color: green;">✅ Documents Received!</h1>
                    <p>Your files have been securely encrypted and stored.</p>
                    <p>You may now close this page and return to WhatsApp.</p>
                </div>
            `);

        } catch (e) { 
            console.error("KYC Processing Error:", e);
            res.send("<h3>❌ System Error</h3><p>An error occurred while saving your documents. Please try again.</p>"); 
        }
    });
});

// Add this so /kyc (no token) doesn't show a blank page
router.get('/', (req, res) => {
    res.send("<h3>👋 KYC Portal</h3><p>Please use the unique link sent to your WhatsApp to upload documents.</p>");
});

module.exports = { router, generateKYCLink };