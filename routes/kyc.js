const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { encrypt } = require('../utils/crypto');
const prisma = new PrismaClient();
const crypto = require('crypto');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

// 1️⃣ Configure Cloud Storage
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_KEY,
    api_secret: process.env.CLOUDINARY_SECRET
});

// 2️⃣ Configure Upload Handling (RAM Storage)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Helper: Stream Buffer to Cloudinary
const uploadToCloud = (buffer) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder: "kyc_docs", resource_type: "auto" },
            (error, result) => {
                if (error) reject(error);
                else resolve(result.secure_url);
            }
        );
        stream.end(buffer);
    });
};

// Helper: Generate Link (Unchanged)
async function generateKYCLink(phone, host) {
    const token = crypto.randomBytes(16).toString('hex');
    await prisma.member.update({
        where: { phone: phone },
        data: { kycToken: token, kycTokenExpires: new Date(Date.now() + 86400000) }
    });
    return `https://${host}/kyc/${token}`;
}

// GET: The Form (Now with File Inputs)
router.get('/:token', async (req, res) => {
    const member = await prisma.member.findFirst({
        where: { kycToken: req.params.token, kycTokenExpires: { gte: new Date() } }
    });
    if (!member) return res.send("<h3>❌ Link Expired</h3>");

    res.send(`
        <!DOCTYPE html><html><head><title>Upload Documents</title><meta name="viewport" content="width=device-width, initial-scale=1">
        <style>body{font-family:sans-serif;padding:20px;background:#f4f7f6;} .card{background:white;padding:25px;border-radius:12px;box-shadow:0 4px 10px rgba(0,0,0,0.1);max-width:400px;margin:auto;} input, select, textarea{width:100%;padding:12px;margin:10px 0;border:1px solid #ddd;border-radius:6px;} button{width:100%;padding:15px;background:#1e272e;color:white;border:none;border-radius:6px;font-weight:bold; cursor:pointer;} .file-label{display:block;margin-top:10px;font-weight:bold;font-size:0.9em;color:#555;}</style>
        </head><body><div class="card">
            <h2>📂 Document Upload</h2>
            <p>Please upload clear photos of your documents.</p>
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
router.post('/:token', upload.fields([{ name: 'idPhoto' }, { name: 'addressProof' }]), async (req, res) => {
    try {
        console.log("Processing KYC Upload...");
        
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
        // We encrypt the URL too, so nobody can just "browse" your DB to see member IDs
        const encryptedID = encrypt(req.body.idNumber);
        const encryptedAddress = encrypt(req.body.address);
        const encryptedIdUrl = encrypt(idPhotoUrl);
        const encryptedProofUrl = encrypt(addressProofUrl);

        // 3. Save to DB
        await prisma.member.update({
            where: { kycToken: req.params.token },
            data: { 
                idType: req.body.idType,
                idNumber: encryptedID,
                address: encryptedAddress,
                idPhotoUrl: encryptedIdUrl,       // ✅ Saved securely
                proofOfAddressUrl: encryptedProofUrl, // ✅ Saved securely
                kycToken: null, 
                kycTokenExpires: null 
            }
        });

        res.send("<div style='text-align:center; padding:50px; font-family:sans-serif;'><h1>✅ Documents Received!</h1><p>Your identity and proof of address have been securely stored.</p></div>");
    } catch (e) { 
        console.error("KYC Upload Error:", e);
        res.send("<h3>❌ Upload Failed</h3><p>Please try again or contact support.</p>"); 
    }
});

module.exports = { router, generateKYCLink };