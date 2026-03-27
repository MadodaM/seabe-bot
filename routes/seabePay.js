// routes/seabePay.js
const express = require('express');
const router = express.Router();
const prisma = require('../services/db');
const { decryptReference, generateAutoPostForm } = require('../services/netcash');

// 1. Landing Page
router.get('/', (req, res) => res.render('seabe-pay'));

// 2. Lead Capture
router.post('/demo-request', async (req, res) => {
    const { fullName, shopName, whatsappNumber } = req.body;
    try {
        console.log(`🚀 New Seabe Pay Lead: ${shopName} (${fullName})`);
        res.send(`<div style="text-align: center; margin-top: 50px; font-family: sans-serif;">
            <h1 style="color: #2563EB;">Request Received!</h1>
            <p>Thank you, ${fullName}. We will contact you on WhatsApp.</p>
            <a href="/seabe-pay">Return to home</a></div>`);
    } catch (error) {
        res.status(500).send("Something went wrong.");
    }
});

// 3. Netcash Success / Decline Pages
router.all('/netcash/success', (req, res) => {
    res.send(`<!DOCTYPE html><html><body style="font-family: sans-serif; text-align: center; padding: 50px;"><h1>✅ Payment Successful!</h1><p>Your receipt has been sent via WhatsApp.</p></body></html>`);
});

router.all('/netcash/decline', (req, res) => {
    res.send(`<!DOCTYPE html><html><body style="font-family: sans-serif; text-align: center; padding: 50px;"><h1>⚠️ Payment Incomplete</h1><p>Your transaction was cancelled or declined.</p></body></html>`);
});

module.exports = router;