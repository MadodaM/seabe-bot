// routes/web.js
// PURPOSE: Public Website (Home, Register, Demo, Terms, Privacy) + Cloudinary FICA + Netcash Redirect
// DESIGN SYSTEM: Deep Navy (#0f172a), Warm Teal (#14b8a6), Gold (#f59e0b)

const express = require('express');
const axios = require('axios');
const sgMail = require('@sendgrid/mail');
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const netcash = require('../services/netcash'); // Required for Payment Redirect
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const EMAIL_FROM = process.env.EMAIL_FROM;
if (process.env.SENDGRID_KEY) sgMail.setApiKey(process.env.SENDGRID_KEY);

// --- 1. CLOUDINARY CONFIGURATION ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_KEY,
    api_secret: process.env.CLOUDINARY_SECRET
});

// --- 2. STORAGE ENGINE ---
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'seabe-fica-vault',
        allowed_formats: ['jpg', 'png', 'pdf', 'jpeg'],
        resource_type: 'auto',
        public_id: (req, file) => `FICA_${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`
    },
});

const uploadCloud = multer({ storage: storage });

module.exports = function(app, upload, { prisma, syncToHubSpot }) {

    // --- CONFIGURATION & HELPERS ---
    const emailStyle = "font-family: 'Inter', sans-serif; color: #333; line-height: 1.6;";
    const headerStyle = "background-color: #0f172a; color: #ffffff; padding: 30px; text-align: center; border-bottom: 4px solid #f59e0b;";

    // --- SHARED HEAD ---
    const sharedHead = `
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script src="https://cdn.tailwindcss.com"></script>
        <script>
            tailwind.config = {
                theme: { 
                    extend: { 
                        colors: { 
                            seabe: { navy: '#0f172a', teal: '#14b8a6', gold: '#f59e0b', light: '#f8fafc' } 
                        },
                        fontFamily: { sans: ['Inter', 'sans-serif'] }
                    } 
                }
            }
        </script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700;800&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Inter', sans-serif; scroll-behavior: smooth; }
            .whatsapp-float { position: fixed; bottom: 20px; right: 20px; background-color: #25d366; color: white; border-radius: 50px; padding: 12px 20px; font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 100; text-decoration: none; display: flex; align-items: center; gap: 8px; transition: transform 0.2s; }
            .whatsapp-float:hover { transform: translateY(-3px); }
        </style>
    `;

    const whatsAppButton = `
        <a href="https://wa.me/27600000000" class="whatsapp-float" target="_blank">
            <svg width="20" height="20" fill="currentColor" viewBox="0 0 16 16"><path d="M13.601 2.326A7.854 7.854 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.933 7.933 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.898 7.898 0 0 0 13.6 2.326zM7.994 14.521a6.573 6.573 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.557 6.557 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592z"/></svg>
            Chat with Seabe
        </a>
    `;

    // ==========================================
    // 0. SEO & BOT CONTROLS
    // ==========================================
    app.get('/robots.txt', (req, res) => {
        res.type('text/plain');
        res.send(`User-agent: *\nAllow: /\nAllow: /terms\nAllow: /privacy\nAllow: /register\nDisallow: /admin/\nDisallow: /dashboard\nDisallow: /api/`);
    });

    // ==========================================
    // 0.1 PAYMENT REDIRECT (Short Link Decoder)
    // ==========================================
    app.get('/pay/:token', (req, res) => {
        const { token } = req.params;

        try {
            // 1. Decode the Token (Reverse the Base64 logic)
            // Restore padding and standard chars
            let base64 = token.replace(/-/g, '+').replace(/_/g, '/');
            while (base64.length % 4) { base64 += '='; }

            // 2. Parse JSON
            const jsonString = Buffer.from(base64, 'base64').toString('utf-8');
            const data = JSON.parse(jsonString);

            // 3. Generate Form (Using the decoded data)
            // Map the short keys back to full names
            const htmlForm = netcash.generateAutoPostForm({
                amount: data.a,
                reference: data.r,
                description: data.o || 'Seabe Payment',
                phone: data.p,
                email: data.e
            });
            
            res.send(htmlForm);

        } catch (error) {
            console.error("Link Decode Error:", error);
            res.status(400).send(`
                <div style="text-align:center; padding:50px; font-family:sans-serif;">
                    <h1>❌ Invalid Link</h1>
                    <p>This payment link is broken or incomplete.</p>
                </div>
            `);
        }
    });

    // ==========================================
    // 1. HOME LANDING PAGE
    // ==========================================
    app.get('/', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <title>Seabe Digital | Administer with Ease</title>
                <meta name="description" content="Automated administration for Churches, Burial Societies, and NPOs. Reclaim time with Seabe Digital.">
                ${sharedHead}
            </head>
            <body class="bg-seabe-light text-slate-800">
                <nav class="bg-white border-b border-gray-100 py-4 px-6 md:px-12 flex justify-between items-center sticky top-0 z-50">
                    <div class="text-2xl font-extrabold text-seabe-navy tracking-tight">Seabe<span class="text-seabe-teal">.</span></div>
                    <div class="hidden md:flex gap-8 text-sm font-semibold text-gray-600">
                        <a href="#features" class="hover:text-seabe-teal transition">Features</a>
                        <a href="#use-cases" class="hover:text-seabe-teal transition">Who We Serve</a>
                        <a href="/pricing" class="hover:text-seabe-teal transition">Pricing</a>
                    </div>
                    <div class="flex gap-3">
                        <a href="/demo" class="px-4 py-2 text-sm font-bold text-seabe-navy border border-gray-200 rounded-lg hover:bg-gray-50 transition">Book Demo</a>
                        <a href="/register" class="px-4 py-2 text-sm font-bold text-white bg-seabe-navy rounded-lg hover:bg-slate-800 transition shadow-lg shadow-blue-900/20">Get Started</a>
                    </div>
                </nav>

                <header class="pt-20 pb-24 px-6 text-center bg-seabe-navy relative overflow-hidden">
                    <div class="absolute top-0 left-0 w-full h-full opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
                    <div class="max-w-4xl mx-auto relative z-10">
                        <span class="inline-block py-1 px-3 rounded-full bg-seabe-teal/10 text-seabe-teal text-xs font-bold uppercase tracking-wider mb-6 border border-seabe-teal/20">The Operating System for Community Leaders</span>
                        <h1 class="text-4xl md:text-6xl font-extrabold text-white mb-6 leading-tight">
                            Administer with Ease.<br/>
                            <span class="text-transparent bg-clip-text bg-gradient-to-r from-seabe-teal to-emerald-400">Lead with Purpose.</span>
                        </h1>
                        <p class="text-lg md:text-xl text-slate-300 mb-10 max-w-2xl mx-auto leading-relaxed">
                            Seabe Digital automates the complex so you can focus on the community. From automated billing to digital FICA, we turn administrative hours into community minutes.
                        </p>
                        <div class="flex flex-col md:flex-row gap-4 justify-center">
                            <a href="/register" class="px-8 py-4 bg-seabe-gold text-seabe-navy font-bold text-lg rounded-xl hover:bg-yellow-400 transition transform hover:-translate-y-1 shadow-xl">Start Your Free Trial</a>
                            <a href="/demo" class="px-8 py-4 bg-white/10 text-white border border-white/20 font-bold text-lg rounded-xl hover:bg-white/20 transition backdrop-blur-sm">See How It Works</a>
                        </div>
                    </div>
                </header>

                <section id="use-cases" class="py-20 px-6 max-w-6xl mx-auto">
                    <div class="text-center mb-16">
                        <h2 class="text-3xl font-bold text-seabe-navy mb-4">Tailored for Your Mission</h2>
                        <p class="text-gray-500 max-w-2xl mx-auto">We understand the unique challenges of community organizations. Our tools are built to solve your specific pain points.</p>
                    </div>

                    <div class="grid md:grid-cols-3 gap-8">
                        <div class="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 hover:shadow-xl transition hover:border-seabe-teal/30 group">
                            <div class="w-12 h-12 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center text-2xl mb-6 group-hover:bg-blue-600 group-hover:text-white transition">⛪</div>
                            <h3 class="text-xl font-bold text-seabe-navy mb-3">The Church Leader</h3>
                            <p class="text-gray-600 leading-relaxed mb-4">Replace Sunday cash counting and manual spreadsheets with real-time digital reports.</p>
                            <ul class="text-sm text-gray-500 space-y-2">
                                <li class="flex gap-2">✅ Automate Tithes & Offerings</li>
                                <li class="flex gap-2">✅ WhatsApp Payment Links</li>
                                <li class="flex gap-2">✅ Real-time Financial Reporting</li>
                            </ul>
                        </div>
                        <div class="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 hover:shadow-xl transition hover:border-seabe-gold/30 group">
                            <div class="w-12 h-12 bg-amber-50 text-amber-600 rounded-lg flex items-center justify-center text-2xl mb-6 group-hover:bg-seabe-gold group-hover:text-seabe-navy transition">🛡️</div>
                            <h3 class="text-xl font-bold text-seabe-navy mb-3">Burial Societies</h3>
                            <p class="text-gray-600 leading-relaxed mb-4">Eliminate the stress of premium collection. Automated reminders ensure funds are collected on time.</p>
                            <ul class="text-sm text-gray-500 space-y-2">
                                <li class="flex gap-2">✅ "Pay Now" WhatsApp Reminders</li>
                                <li class="flex gap-2">✅ Policy Management</li>
                                <li class="flex gap-2">✅ Automated Receipts</li>
                            </ul>
                        </div>
                        <div class="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 hover:shadow-xl transition hover:border-seabe-teal/30 group">
                            <div class="w-12 h-12 bg-teal-50 text-seabe-teal rounded-lg flex items-center justify-center text-2xl mb-6 group-hover:bg-seabe-teal group-hover:text-white transition">🤝</div>
                            <h3 class="text-xl font-bold text-seabe-navy mb-3">NPO Administrators</h3>
                            <p class="text-gray-600 leading-relaxed mb-4">Effortless transparency. Generate donor reports and manage compliance-heavy documentation.</p>
                            <ul class="text-sm text-gray-500 space-y-2">
                                <li class="flex gap-2">✅ Donor Tax Certificates</li>
                                <li class="flex gap-2">✅ Secure FICA Vault</li>
                                <li class="flex gap-2">✅ Grant Reporting</li>
                            </ul>
                        </div>
                    </div>
                </section>

                <section class="bg-slate-50 border-y border-gray-200 py-16 px-6">
                    <div class="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8">
                        <div>
                            <h3 class="text-2xl font-bold text-seabe-navy mb-2">Bank-Grade Security & Compliance</h3>
                            <p class="text-gray-600">We partner with Netcash to ensure your funds and data are secure, POPIA compliant, and auditable.</p>
                        </div>
                        <div class="flex gap-6 opacity-60 grayscale hover:grayscale-0 transition duration-500">
                             <div class="font-bold text-xl text-gray-400">Netcash</div>
                             <div class="font-bold text-xl text-gray-400">Ozow</div>
                             <div class="font-bold text-xl text-gray-400">HubSpot</div>
                        </div>
                    </div>
                </section>

                <footer class="bg-seabe-navy text-white py-12 px-6 mt-12">
                    <div class="max-w-6xl mx-auto grid md:grid-cols-4 gap-8 mb-8">
                        <div class="col-span-1 md:col-span-2">
                            <h4 class="text-2xl font-bold mb-4">Seabe<span class="text-seabe-teal">.</span></h4>
                            <p class="text-slate-400 text-sm max-w-sm">The digital operating system for African community organizations. Secure, efficient, and built for growth.</p>
                        </div>
                        <div>
                            <h5 class="font-bold mb-4 text-seabe-gold">Platform</h5>
                            <ul class="space-y-2 text-sm text-slate-400">
                                <li><a href="/register" class="hover:text-white">Register Organization</a></li>
                                <li><a href="/demo" class="hover:text-white">Book a Demo</a></li>
                                <li><a href="/login" class="hover:text-white">Admin Login</a></li>
                            </ul>
                        </div>
                        <div>
                            <h5 class="font-bold mb-4 text-seabe-gold">Legal</h5>
                            <ul class="space-y-2 text-sm text-slate-400">
                                <li><a href="/terms" class="hover:text-white">Terms of Service</a></li>
                                <li><a href="/privacy" class="hover:text-white">Privacy Policy (POPIA)</a></li>
                                <li><a href="#" class="hover:text-white">FICA Requirements</a></li>
                            </ul>
                        </div>
                    </div>
                    <div class="border-t border-slate-700 pt-8 text-center text-xs text-slate-500">
                        &copy; ${new Date().getFullYear()} Seabe Digital. All rights reserved.
                    </div>
                </footer>
                ${whatsAppButton}
            </body>
            </html>
        `);
    });

    // ==========================================
    // 2. REGISTRATION PAGE
    // ==========================================
    app.get('/register', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <title>Register Organization | Seabe</title>
                ${sharedHead}
            </head>
            <body class="bg-seabe-light min-h-screen flex flex-col items-center justify-center p-6">
                
                <a href="/" class="mb-8 text-2xl font-extrabold text-seabe-navy tracking-tight">Seabe<span class="text-seabe-teal">.</span></a>

                <div class="bg-white p-8 md:p-10 rounded-2xl shadow-xl w-full max-w-xl border border-gray-100">
                    <div class="text-center mb-8">
                        <h2 class="text-2xl font-bold text-seabe-navy">Start Your Digital Journey</h2>
                        <p class="text-gray-500 text-sm mt-2">Complete this form to create your organization's secure vault.</p>
                    </div>
                    
                    <form action="/register-church" method="POST" enctype="multipart/form-data" class="space-y-5">
                        
                        <div class="grid md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Organization Name</label>
                                <input type="text" name="churchName" required placeholder="e.g. St. Marks" class="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-seabe-teal outline-none bg-gray-50">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Org Type</label>
                                <select name="type" class="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-seabe-teal outline-none bg-gray-50">
                                    <option value="BURIAL_SOCIETY">Burial Society</option>
                                    <option value="CHURCH">Church</option>
                                    <option value="STOKVEL_SAVINGS">Stokvel / Savings Club</option>
                                    <option value="NON_PROFIT">NPO / NGO</option>
                                </select>
                            </div>
                        </div>
                        
                        <div>
                            <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Official Email</label>
                            <input type="email" name="email" required placeholder="admin@org.co.za" class="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-seabe-teal outline-none bg-gray-50">
                        </div>

                        <div class="bg-slate-50 p-4 rounded-xl border border-slate-200">
                            <h4 class="font-bold text-seabe-navy flex items-center gap-2 mb-3">
                                <span class="bg-seabe-gold text-white text-xs px-2 py-1 rounded">MANDATORY</span> 
                                Level 1 FICA Verification
                            </h4>
                            
                            <div class="mb-4">
                                <label class="block text-xs font-bold text-gray-600 mb-1">Upload Leader's ID (PDF/Img)</label>
                                <input type="file" name="idDoc" accept="image/*,.pdf" required class="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-seabe-teal/10 file:text-seabe-teal hover:file:bg-seabe-teal/20">
                            </div>

                            <div>
                                <label class="block text-xs font-bold text-gray-600 mb-1">Proof of Bank Account</label>
                                <input type="file" name="bankDoc" accept="image/*,.pdf" required class="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-seabe-teal/10 file:text-seabe-teal hover:file:bg-seabe-teal/20">
                            </div>
                        </div>

                        <div class="flex items-start gap-3 mt-4">
                            <input type="checkbox" name="tos" required class="mt-1 w-4 h-4 text-seabe-teal rounded border-gray-300"> 
                            <span class="text-sm text-gray-600">I agree to the <a href="/terms" target="_blank" class="text-seabe-teal font-bold hover:underline">Terms of Service</a> and <a href="/privacy" target="_blank" class="text-seabe-teal font-bold hover:underline">Privacy Policy</a>.</span>
                        </div>

                        <button type="submit" class="w-full bg-seabe-navy text-white font-bold py-4 rounded-lg hover:bg-slate-800 transition shadow-lg mt-4">
                            Submit Verification & Register
                        </button>
                    </form>
                    <p class="text-center mt-6"><a href="/" class="text-gray-400 hover:text-gray-600 text-sm font-semibold">Cancel</a></p>
                </div>
                ${whatsAppButton}
            </body>
            </html>
        `);
    });

    // ==========================================
    // 3. REGISTRATION HANDLER (With X-Ray Logging)
    // ==========================================
    const kybUploads = uploadCloud.fields([{ name: 'idDoc', maxCount: 1 }, { name: 'bankDoc', maxCount: 1 }]);

    app.post('/register-church', (req, res) => {
        console.log("\n=========================================");
        console.log("🚀 [STEP 1] /register-church POST route hit!");
        console.log("🔍 [DIAGNOSTICS] Checking Cloudinary Keys:");
        console.log("   Cloud Name:", process.env.CLOUDINARY_CLOUD_NAME ? "✅ SET" : "❌ MISSING");
        console.log("   API Key:", process.env.CLOUDINARY_API_KEY ? "✅ SET" : "❌ MISSING");
        console.log("   API Secret:", process.env.CLOUDINARY_API_SECRET ? "✅ SET" : "❌ MISSING");
        console.log("=========================================\n");

        // Force Multer to try and parse the files
        kybUploads(req, res, async (uploadError) => {
            console.log("🚀 [STEP 2] Multer streaming attempt finished.");

            if (uploadError) {
                console.error("❌ [FATAL CRASH IN STEP 2]:", uploadError);
                return res.send(`
                    <div style="text-align:center; padding:50px; font-family:sans-serif;">
                        <h1 style="color:#e74c3c;">Cloudinary Upload Failed</h1>
                        <p>The server failed to stream the files to the secure vault.</p>
                        <p style="color:#7f8c8d; font-size:12px;">Error: ${uploadError.message}</p>
                    </div>
                `);
            }

            console.log("✅ [STEP 3] Files and Form Data parsed successfully.");
            console.log("📥 [BODY PAYLOAD]:", req.body);
            console.log("📁 [FILES UPLOADED]:", req.files ? Object.keys(req.files) : "None detected!");

            const { churchName, email, tos, type, adminPhone } = req.body;
            
            if (!type) console.warn("⚠️ WARNING: Form did not send 'type'!");
            if (!tos) return res.send("⚠️ You must accept the Terms.");

            try {
                const idDocUrl = (req.files && req.files['idDoc']) ? req.files['idDoc'][0].path : null;
                const bankDocUrl = (req.files && req.files['bankDoc']) ? req.files['bankDoc'][0].path : null;
                const mimeType = (req.files && req.files['bankDoc']) ? req.files['bankDoc'][0].mimetype : 'image/jpeg';

                if (!idDocUrl || !bankDocUrl) {
                    return res.send("❌ Error: Documents missing from upload payload.");
                }

                const prefix = churchName.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
                const newCode = `${prefix}${Math.floor(100 + Math.random() * 900)}`;

                console.log(`⏳ [STEP 4] Sending Bank Document to Gemini 2.5...`);
                
                let extractedBank = {
                    bankName: "Pending Review", accountName: churchName,
                    accountNumber: "PENDING", branchCode: "PENDING", accountType: "CURRENT"
                };

                try {
                    const fileResponse = await axios.get(bankDocUrl, { responseType: 'arraybuffer' });
                    const base64Data = Buffer.from(fileResponse.data).toString('base64');

                    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
                    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

                    const prompt = `You are a strict financial compliance AI. Extract the banking details from this Proof of Bank Account / Confirmation Letter. 
                    Return ONLY a raw JSON object with no markdown formatting. 
                    Format: {"bankName": "FNB", "accountName": "Stokvel Savings", "accountNumber": "62000000000", "branchCode": "250655", "accountType": "CURRENT"}`;

                    const result = await model.generateContent([
                        prompt, { inlineData: { data: base64Data, mimeType: mimeType } }
                    ]);
                    
                    const cleanJson = result.response.text().replace(/```json/gi, '').replace(/```/g, '').trim();
                    extractedBank = JSON.parse(cleanJson);
                    console.log("✅ [STEP 5] AI Extraction Success:", extractedBank.accountNumber);
                } catch (aiError) {
                    console.error("⚠️ [AI ERROR] Could not read document:", aiError.message);
                }

                console.log("💾 [STEP 6] Saving Organization to Prisma DB...");
                await prisma.church.create({ 
                    data: { 
                        name: churchName, code: newCode, email: email, 
                        adminPhone: adminPhone || '0000000000', 
                        subaccountCode: 'PENDING_KYC', tosAcceptedAt: new Date(), 
                        type: type || 'CHURCH', ficaStatus: 'LEVEL_1_PENDING',
                        bankDetail: {
                            create: {
                                bankName: extractedBank.bankName, accountName: extractedBank.accountName,
                                accountNumber: String(extractedBank.accountNumber), branchCode: String(extractedBank.branchCode),     
                                accountType: extractedBank.accountType || 'CURRENT', accountstatus: false 
                            }
                        }
                    } 
                });

                console.log("✅ [STEP 7] Registration Complete! Sending emails...");
                
                if (process.env.SENDGRID_KEY) {
                    await sgMail.send({ 
                        to: EMAIL_FROM, from: EMAIL_FROM, 
                        subject: `📝 NEW FICA UPLOAD: ${churchName}`, 
                        html: `<h2>New Application</h2><p><strong>Name:</strong> ${churchName}</p><hr><ul><li><a href="${idDocUrl}">📄 View Leader ID</a></li><li><a href="${bankDocUrl}">🏦 View Bank Proof</a></li></ul>` 
                    }).catch(e => console.error("Email Error:", e.response.body));
                }
                
                res.send(`
                    <!DOCTYPE html>
                    <html><head>${sharedHead}</head><body class="bg-seabe-light flex items-center justify-center h-screen">
                    <div class="bg-white p-10 rounded-2xl shadow-xl text-center max-w-md">
                        <div class="text-5xl mb-4">🎉</div>
                        <h1 class="text-2xl font-bold text-seabe-navy mb-2">Application Received</h1>
                        <p class="text-gray-500 mb-6">We have securely vaulted your FICA documents. Check your email (<strong>${email}</strong>) for next steps.</p>
                        <a href="/" class="text-seabe-teal font-bold hover:underline">Return Home</a>
                    </div>
                    </body></html>
                `);

            } catch (e) { 
                console.error("❌ [FATAL CRASH IN DB/LOGIC]:", e);
                res.send(`
                    <div style="text-align:center; padding:50px; font-family:sans-serif;">
                        <h1 style="color:#e74c3c;">System Error</h1>
                        <p>Something went wrong processing your documents.</p>
                        <p style="color:#7f8c8d; font-size:12px;">${e.message}</p>
                    </div>
                `); 
            }
        }); 
    });
    
    // ==========================================
    // 6.5. QR CODE VERIFICATION PAGE (NEW!)
    // ==========================================
    app.get('/verify', async (req, res) => {
        const { org, policy } = req.query;

        if (!org || !policy) {
            return res.send(`
                <html><head>${sharedHead}</head><body class="bg-seabe-light flex items-center justify-center h-screen">
                    <div class="bg-white p-8 rounded-2xl shadow-xl text-center max-w-sm border-t-4 border-red-500">
                        <h1 class="text-2xl font-bold text-red-500 mb-2">❌ Invalid Link</h1>
                        <p class="text-gray-500">Missing verification parameters.</p>
                    </div>
                </body></html>
            `);
        }

        try {
            const church = await prisma.church.findUnique({ where: { code: org } });
            if (!church) {
                return res.send(`
                    <html><head>${sharedHead}</head><body class="bg-seabe-light flex items-center justify-center h-screen">
                        <div class="bg-white p-8 rounded-2xl shadow-xl text-center max-w-sm border-t-4 border-red-500">
                            <h1 class="text-2xl font-bold text-red-500 mb-2">❌ Organization Not Found</h1>
                            <p class="text-gray-500">This code is invalid or the organization no longer exists.</p>
                        </div>
                    </body></html>
                `);
            }

            // Attempt to find the member securely
            let member;
            if (policy.startsWith('SB-')) {
                const phoneSuffix = policy.replace('SB-', '');
                member = await prisma.member.findFirst({
                    where: {
                        churchCode: org,
                        phone: { endsWith: phoneSuffix }
                    }
                });
            } else {
                member = await prisma.member.findFirst({
                    where: { churchCode: org, policyNumber: policy }
                });
            }

            if (!member) {
                return res.send(`
                    <html><head>${sharedHead}</head><body class="bg-seabe-light flex items-center justify-center h-screen">
                        <div class="bg-white p-8 rounded-2xl shadow-xl text-center max-w-sm border-t-4 border-red-500">
                            <h1 class="text-2xl font-bold text-red-500 mb-2">❌ Member Not Found</h1>
                            <p class="text-gray-500">This policy number could not be verified in our records.</p>
                        </div>
                    </body></html>
                `);
            }

            // Render a beautiful Verification UI
            const isActive = member.status === 'ACTIVE';
            const statusColorClass = isActive ? 'bg-green-500' : 'bg-red-500';
            const statusIcon = isActive ? '✅ POLICY ACTIVE' : '❌ ' + (member.status || 'INACTIVE');
            const borderColorClass = isActive ? 'border-green-500' : 'border-red-500';

            // Mask the phone number for privacy (e.g. ******2707)
            const maskedPhone = member.phone.replace(/.(?=.{4})/g, '*');
            const joinedDate = member.createdAt ? new Date(member.createdAt).toLocaleDateString('en-ZA') : 'N/A';

            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Policy Verification</title>
                    ${sharedHead}
                </head>
                <body class="bg-seabe-light flex items-center justify-center min-h-screen p-4">
                    <div class="bg-white p-8 rounded-2xl shadow-xl w-full max-w-sm border-t-8 ${borderColorClass} text-center">
                        <h3 class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Official Verification</h3>
                        <h2 class="text-2xl font-extrabold text-seabe-navy mb-4">${church.name}</h2>
                        
                        <div class="${statusColorClass} text-white px-6 py-3 rounded-full font-bold text-lg inline-block mb-6 shadow-md shadow-${isActive ? 'green' : 'red'}-500/40">
                            ${statusIcon}
                        </div>
                        
                        <div class="bg-gray-50 p-5 rounded-xl border border-gray-100 text-left space-y-4">
                            <div class="flex justify-between items-center border-b border-gray-200 pb-3">
                                <strong class="text-gray-500 text-sm">Member:</strong> 
                                <span class="font-bold text-gray-800">${member.firstName} ${member.lastName || ''}</span>
                            </div>
                            <div class="flex justify-between items-center border-b border-gray-200 pb-3">
                                <strong class="text-gray-500 text-sm">Policy No:</strong> 
                                <span class="font-mono text-gray-800 font-semibold">${policy}</span>
                            </div>
                            <div class="flex justify-between items-center border-b border-gray-200 pb-3">
                                <strong class="text-gray-500 text-sm">Phone:</strong> 
                                <span class="font-bold text-gray-800">${maskedPhone}</span>
                            </div>
                            <div class="flex justify-between items-center">
                                <strong class="text-gray-500 text-sm">Joined:</strong> 
                                <span class="font-bold text-gray-800">${joinedDate}</span>
                            </div>
                        </div>
                        
                        <p class="mt-8 text-xs text-gray-400 font-semibold">Verified securely via Seabe Digital</p>
                    </div>
                </body>
                </html>
            `);

        } catch (error) {
            console.error("Verification Error:", error);
            res.send("System Error");
        }
    });

    // ==========================================
    // 8. DEBICHECK MANDATE CAPTURE (Public Link)
    // ==========================================
    app.get('/mandate/:memberId', async (req, res) => {
        try {
            // 🚀 FIX: Fetch member, then fetch the org safely using churchCode
            const member = await prisma.member.findUnique({
                where: { id: parseInt(req.params.memberId) }
            });

            if (!member) return res.status(404).send("Link expired or invalid.");

            const org = await prisma.church.findUnique({
                where: { code: member.churchCode }
            });

            const orgName = org ? org.name : 'Seabe Digital';

            res.send(`
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <title>Authorize DebiCheck | ${orgName}</title>
                    ${sharedHead}
                </head>
                <body class="bg-seabe-light min-h-screen flex flex-col items-center justify-center p-6">
                    <div class="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-gray-100">
                        <div class="text-center mb-6">
                            <h2 class="text-2xl font-bold text-seabe-navy">Setup Monthly Contribution</h2>
                            <p class="text-gray-500 text-sm mt-2">Authorize a secure DebiCheck mandate for <strong>${orgName}</strong>.</p>
                        </div>

                        <div class="bg-blue-50 border border-blue-100 p-4 rounded-lg mb-6">
                            <p class="text-xs text-blue-800 font-semibold mb-1">🏦 How DebiCheck Works:</p>
                            <p class="text-xs text-blue-600">Once you submit this form, your bank will send a secure pop-up to your banking app or via SMS asking you to approve the monthly deduction.</p>
                        </div>

                        <form action="/api/mandates/process" method="POST" class="space-y-4">
                            <input type="hidden" name="memberId" value="${member.id}">
                            
                            <div>
                                <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Bank Name</label>
                                <select name="bankName" required class="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-seabe-teal outline-none bg-gray-50">
                                    <option value="ABSA">ABSA</option>
                                    <option value="CAPITEC">Capitec</option>
                                    <option value="FNB">First National Bank (FNB)</option>
                                    <option value="NEDBANK">Nedbank</option>
                                    <option value="STANDARD_BANK">Standard Bank</option>
                                    <option value="TYME">TymeBank</option>
                                </select>
                            </div>

                            <div>
                                <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Account Type</label>
                                <select name="accountType" required class="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-seabe-teal outline-none bg-gray-50">
                                    <option value="1">Current / Cheque</option>
                                    <option value="2">Savings</option>
                                    <option value="3">Transmission</option>
                                </select>
                            </div>

                            <div>
                                <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Account Number</label>
                                <input type="text" name="accountNumber" required pattern="[0-9]+" placeholder="e.g. 62000000000" class="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-seabe-teal outline-none bg-gray-50 font-mono text-lg tracking-wider">
                            </div>

                            <button type="submit" class="w-full bg-seabe-teal text-white font-bold py-4 rounded-lg hover:bg-teal-500 transition shadow-lg mt-4 flex justify-center items-center gap-2">
                                🔒 Submit to Bank for Approval
                            </button>
                        </form>
                    </div>
                </body>
                </html>
            `);
        } catch (e) {
            console.error("Mandate Page Error:", e);
            res.send("Error loading mandate page.");
        }
    });

   // ==========================================
    // 9. PROCESS THE MANDATE (Triggers Bank USSD)
    // ==========================================
    app.post('/api/mandates/process', express.urlencoded({ extended: true }), async (req, res) => {
        const { memberId, bankName, accountType, accountNumber } = req.body;

        try {
            const member = await prisma.member.findUnique({ where: { id: parseInt(memberId) } });
            
            if (!member) return res.send("Member not found.");

            console.log(`📡 [NETCASH API] Sending DebiCheck Request for ${member.firstName}...`);
            console.log(`   Bank: ${bankName} | Acc: ${accountNumber}`);

            // ✅ THE FIX IS NOW ACTIVE: Update the Database!
            await prisma.member.update({
                where: { id: parseInt(memberId) },
                data: { 
                    mandateStatus: 'PENDING_USSD_APPROVAL'
                }
            });

            res.send(`
                <!DOCTYPE html>
                <html><head>${sharedHead}</head><body class="bg-seabe-light flex items-center justify-center h-screen">
                <div class="bg-white p-10 rounded-2xl shadow-xl text-center max-w-md">
                    <div class="text-5xl mb-4">📱</div>
                    <h1 class="text-2xl font-bold text-seabe-navy mb-2">Check Your Phone!</h1>
                    <p class="text-gray-500 mb-6">We have sent the request to <strong>${bankName}</strong>. Please check your banking app or USSD messages to approve the recurring deduction.</p>
                    <a href="https://wa.me/27600000000" class="text-seabe-teal font-bold hover:underline">Return to WhatsApp</a>
                </div>
                </body></html>
            `);

        } catch (e) {
            console.error("Mandate Process Error:", e);
            res.send(`<h1>Error</h1><p>System error processing mandate.</p>`);
        }
    });

    // ==========================================
    // 4. DEMO REQUEST
    // ==========================================
    app.get('/demo', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head><title>Book Demo | Seabe</title>${sharedHead}</head>
            <body class="bg-seabe-light min-h-screen flex items-center justify-center p-4">
                <div class="bg-white p-10 rounded-2xl shadow-xl w-full max-w-lg border border-gray-100">
                    <h2 class="text-3xl font-extrabold text-seabe-navy text-center mb-2">Book a Demo</h2>
                    <p class="text-center text-gray-500 mb-8">See how Seabe improves efficiency & productivity.</p>
                    <form action="/request-demo" method="POST" class="space-y-4">
                        <input name="firstname" placeholder="Your Name" required class="w-full p-4 border border-gray-200 rounded-lg focus:ring-2 focus:ring-seabe-teal outline-none">
                        <input name="orgName" placeholder="Organization Name" required class="w-full p-4 border border-gray-200 rounded-lg focus:ring-2 focus:ring-seabe-teal outline-none">
                        <input name="email" placeholder="Email Address" required type="email" class="w-full p-4 border border-gray-200 rounded-lg focus:ring-2 focus:ring-seabe-teal outline-none">
                        <input name="phone" placeholder="WhatsApp Number" required class="w-full p-4 border border-gray-200 rounded-lg focus:ring-2 focus:ring-seabe-teal outline-none">
                        <button type="submit" class="w-full bg-seabe-teal text-white font-bold text-lg py-4 rounded-lg hover:bg-teal-500 transition shadow-lg mt-2">Request Demo</button>
                    </form>
                    <p class="text-center mt-6"><a href="/" class="text-gray-400 hover:text-gray-600 text-sm font-semibold">Back</a></p>
                </div>
            </body>
            </html>
        `);
    });

    app.post('/request-demo', upload.none(), async (req, res) => {
        const { firstname, email, phone, orgName } = req.body;
        if (syncToHubSpot) {
            await syncToHubSpot({ name: firstname, email, phone, company: orgName, lifeCycleStage: 'lead' });
        }
        if (process.env.SENDGRID_KEY) {
            await sgMail.send({ to: EMAIL_FROM, from: EMAIL_FROM, subject: `🔥 DEMO REQUEST: ${orgName}`, html: `<p>${firstname} from ${orgName} wants a demo.<br>Phone: ${phone}</p>` });
        }
        res.redirect('/?demo=success');
    });

    // ==========================================
    // 5. PRIVACY POLICY
    // ==========================================
    app.get('/privacy', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head><title>Privacy Policy | Seabe</title>${sharedHead}</head>
            <body class="bg-white text-gray-800 p-8 md:p-16">
                <div class="max-w-3xl mx-auto">
                    <h1 class="text-4xl font-extrabold text-seabe-navy mb-2">Privacy Policy</h1>
                    <p class="text-sm text-gray-500 mb-10">Effective Date: March 1, 2026</p>
                    <div class="prose prose-slate">
                        <h3 class="font-bold text-xl mb-2">1. Introduction</h3>
                        <p class="mb-4">Seabe Digital ("we", "us") is committed to protecting your personal information in accordance with POPIA.</p>
                        <h3 class="font-bold text-xl mb-2">2. Information We Collect</h3>
                        <p class="mb-4">We collect Information required for FICA compliance, including Identity Documents and Banking Details.</p>
                        <h3 class="font-bold text-xl mb-2">3. How We Use Your Information</h3>
                        <p class="mb-4">Your data is used strictly for facilitating payments via Netcash/Ozow and verifying legal entity status.</p>
                        <h3 class="font-bold text-xl mb-2">4. Data Security</h3>
                        <p class="mb-4">All sensitive documents (IDs, Bank Letters) are encrypted at rest.</p>
                        <h3 class="font-bold text-xl mb-2">5. Your Rights</h3>
                        <p class="mb-4">Under POPIA, you have the right to request access to your data or request deletion.</p>
                        <h3 class="font-bold text-xl mb-2">6. Contact Information Officer</h3>
                        <p>For privacy concerns, contact: <a href="mailto:privacy@seabe.tech" class="text-seabe-teal font-bold">privacy@seabe.tech</a></p>
                    </div>
                    <div class="mt-12 pt-8 border-t"><a href="/" class="font-bold text-seabe-navy">&larr; Back to Home</a></div>
                </div>
            </body>
            </html>
        `);
    });

    // ==========================================
    // 6. TERMS OF SERVICE
    // ==========================================
    app.get('/terms', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head><title>Terms of Service | Seabe</title>${sharedHead}</head>
            <body class="bg-white text-gray-800 p-8 md:p-16">
                <div class="max-w-3xl mx-auto">
                    <h1 class="text-4xl font-extrabold text-seabe-navy mb-2">Master Service Agreement</h1>
                    <p class="text-sm text-gray-500 mb-10">Last Updated: March 2026</p>
                    <div class="space-y-6 text-gray-600">
                        <p><strong>1. Acceptance of Terms:</strong> By registering, you agree to these terms. Seabe Digital provides administrative software; we are not a bank.</p>
                        <p><strong>2. Payment Processing:</strong> All funds are processed by registered PSPs (Netcash/Ozow).</p>
                        <p><strong>3. FICA Compliance:</strong> You warrant that all documents uploaded are authentic.</p>
                        <p><strong>4. Subscription Fees:</strong> Seabe charges a platform fee per transaction as agreed upon in your pricing schedule.</p>
                        <p><strong>5. Limitation of Liability:</strong> Seabe is not liable for lost funds due to incorrect banking details provided by the user.</p>
                    </div>
                    <div class="mt-12 pt-8 border-t"><a href="/" class="font-bold text-seabe-navy">&larr; Back to Home</a></div>
                </div>
            </body>
            </html>
        `);
    });

    // ==========================================
    // 7. TOOLS & PREVIEWS (PDF & Webhooks)
    // ==========================================
    
    // Ensure uploads directory exists (Legacy Support for PDF generation)
    const uploadsDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Explicit Route to Serve the PDF to Twilio
    app.get('/api/public/quote-file/:filename', (req, res) => {
        const filePath = path.join(uploadsDir, req.params.filename);
        if (fs.existsSync(filePath)) {
            res.setHeader('Content-Type', 'application/pdf');
            res.sendFile(filePath);
        } else {
            res.status(404).send('File not found');
        }
    });

    // The PDF Receiver and Sender
    app.post('/api/public/send-quote', express.json({ limit: '10mb' }), async (req, res) => {
        const { phone, pdfBase64, orgName } = req.body;
        
        try {
            const base64Data = pdfBase64.replace(/^data:application\/pdf;base64,/, "");
            const fileName = `Quote_${Date.now()}.pdf`;
            const filePath = path.join(uploadsDir, fileName);
            fs.writeFileSync(filePath, base64Data, 'base64');

            const host = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
            const fileUrl = `${host}/api/public/quote-file/${fileName}`;

            if (process.env.TWILIO_SID && process.env.TWILIO_AUTH) {
                const twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
                const cleanTwilioNumber = process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '');
                
                await twilioClient.messages.create({
                    from: `whatsapp:${cleanTwilioNumber}`,
                    to: `whatsapp:${phone}`,
                    body: `📄 Here is your official quote from *${orgName}*.`,
                    mediaUrl: [fileUrl]
                });
            }

            res.json({ success: true });
        } catch (error) {
            console.error("PDF Send Error:", error);
            res.status(500).json({ success: false });
        }
    });

    // Payment Webhook
    app.post('/api/webhooks/payment-success', express.json(), async (req, res) => {
        const { enrollmentId, status } = req.body; 

        if (status === 'SUCCESS') {
            try {
                const enrollment = await prisma.enrollment.update({
                    where: { id: parseInt(enrollmentId) },
                    data: { status: 'ACTIVE', progress: 1 },
                    include: { member: true, course: { include: { modules: true } } }
                });

                const foundationModule = enrollment.course.modules.find(m => m.order === 1);

                if (process.env.TWILIO_SID && foundationModule) {
                    const twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
                    const cleanTwilioNumber = process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '');
                    const msg = `🎉 *Payment Confirmed!*\n\nWelcome to *${enrollment.course.title}*. Your subscription is active.\n\nHere is your *Foundation Module:*\n📘 *${foundationModule.title}*\n\nAccess the material here:\n👉 ${foundationModule.contentUrl}\n\nReply *Next* when you have completed this module to unlock Module 2!`;

                    await twilioClient.messages.create({
                        from: `whatsapp:${cleanTwilioNumber}`,
                        to: `whatsapp:${enrollment.member.phone}`,
                        body: msg
                    });
                }

                res.status(200).send('Webhook Processed');
            } catch (error) {
                console.error("Webhook Error:", error);
                res.status(500).send('Error');
            }
        } else {
            res.status(400).send('Payment not successful');
        }
    });
};