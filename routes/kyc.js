// routes/kyc.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { encrypt } = require('../utils/crypto'); // 👈 Import Security Helper
const prisma = new PrismaClient();
const crypto = require('crypto');


// to parse the HTML Form data
router.use(express.urlencoded({ extended: true }));

// Helper: Generate Link (Same as before)
async function generateKYCLink(phone, host) {
    const token = crypto.randomBytes(16).toString('hex');
    await prisma.member.update({
        where: { phone: phone },
        data: { kycToken: token, kycTokenExpires: new Date(Date.now() + 86400000) }
    });
    return `https://${host}/kyc/${token}`;
}

// GET: The Form (Same HTML as before)
router.get('/:token', async (req, res) => {
    // ... validation logic ...
    // ... send the HTML form with ID/Passport toggle ...
    // (Use the code from our previous chat for the HTML)
    const member = await prisma.member.findFirst({
        where: { kycToken: req.params.token, kycTokenExpires: { gte: new Date() } }
    });
    if (!member) return res.send("<h3>❌ Link Expired</h3>");

    res.send(`
        <!DOCTYPE html><html><head><title>Update Profile</title><meta name="viewport" content="width=device-width, initial-scale=1">
        <style>body{font-family:sans-serif;padding:20px;background:#f4f7f6;} .card{background:white;padding:25px;border-radius:12px;box-shadow:0 4px 10px rgba(0,0,0,0.1);max-width:400px;margin:auto;} input, select, textarea{width:100%;padding:12px;margin:10px 0;border:1px solid #ddd;border-radius:6px;} button{width:100%;padding:15px;background:#1e272e;color:white;border:none;border-radius:6px;font-weight:bold;}</style>
        </head><body><div class="card">
            <h2>🔐 Secure Identity Update</h2>
            <p>Hi ${member.firstName}. Your data will be encrypted for your safety.</p>
            <form action="/kyc/${req.params.token}" method="POST">
                <label>Document Type</label>
                <select name="idType"><option value="SA_ID">SA ID Number</option><option value="PASSPORT">Passport</option></select>
                <label>Number</label><input name="idNumber" required placeholder="Enter ID or Passport Number">
                <label>Physical Address</label><textarea name="address" required></textarea>
                <button>🔒 Encrypt & Submit</button>
            </form>
        </div></body></html>
    `);
});

// POST: The Secure Save
router.post('/:token', async (req, res) => {
    try {
        // 🔒 ENCRYPT DATA BEFORE SAVING
        const encryptedID = encrypt(req.body.idNumber);
        const encryptedAddress = encrypt(req.body.address);

        await prisma.member.update({
            where: { kycToken: req.params.token },
            data: { 
                idType: req.body.idType,
                idNumber: encryptedID,      // Saved as gibberish
                address: encryptedAddress,  // Saved as gibberish
                kycToken: null, 
                kycTokenExpires: null 
            }
        });
        res.send("<div style='text-align:center; margin-top:50px; font-family:sans-serif;'><h1>✅ Verified Securely!</h1><p>Your data has been encrypted and stored safely.</p></div>");
    } catch (e) { 
        console.error(e);
        res.send("Error processing secure update."); 
    }
});

module.exports = { router, generateKYCLink };