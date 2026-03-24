const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const cloudinary = require('cloudinary').v2;

// 🔒 NEW BANK-GRADE SECURITY IMPORTS
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');

const { sendWhatsApp } = require('../services/whatsapp'); 
const { decrypt } = require('../utils/crypto'); 
const { analyzeAdminDocument } = require('../services/aiClaimWorker');

// 🔌 1. IMPORT YOUR NEW API MICROSERVICES HERE
const claimsEngine = require('./crmClaims');
const blastEngine = require('./blastEngine');

// 🛡️ Cloudinary Config
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// 🛡️ Upload Config (Updated for AI Claims & CSVs)
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['text/csv', 'image/jpeg', 'image/png', 'application/pdf'];
        if (allowed.includes(file.mimetype) || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('❌ Invalid File Type. CSV, JPG, PNG, or PDF only.'));
        }
    }
});

// --- HELPERS ---
const parseCookies = (req) => {
    const list = {};
    const rc = req.headers.cookie;
    rc && rc.split(';').forEach(c => {
        const p = c.split('=');
        if (p.length >= 2) list[p.shift().trim()] = decodeURI(p.join('='));
    });
    return list;
};

// --- UI TEMPLATE ---
const renderPage = (org, activeTab, content) => {
    const isChurch = org.type === 'CHURCH';
    const isGrooming = org.type === 'SERVICE_PROVIDER' || org.type === 'PERSONAL_CARE';
    const isAcademy = org.type === 'ACADEMY' || org.type === 'COACHING' || org.type === 'NON_PROFIT'; // Added Academy types
    
    const navStyle = (tab) => `padding: 10px 15px; text-decoration: none; color: ${activeTab === tab ? '#000' : '#888'}; border-bottom: ${activeTab === tab ? '3px solid #00d2d3' : 'none'}; font-weight: bold; font-size: 14px;`;
    
    // Feature Toggles based on Type
    const verifyTab = !isChurch && !isGrooming && !isAcademy ? `<a href="/admin/${org.code}/verifications" style="${navStyle('verifications')}">🕵️ Verifications</a>` : '';
    const claimsTab = !isChurch && !isGrooming && !isAcademy ? `<a href="/admin/${org.code}/claims" style="${navStyle('claims')}">📑 Claims</a>` : '';
    const eventsTab = isChurch ? `<a href="/admin/${org.code}/events" style="${navStyle('events')}">📅 Events</a>` : '';
    const appointmentsTab = isGrooming ? `<a href="/admin/${org.code}/appointments" style="${navStyle('appointments')}">📅 Schedule</a>` : '';
    const servicesTab = isGrooming ? `<a href="/admin/${org.code}/services" style="${navStyle('services')}">✂️ Services</a>` : '';
    const academyTab = isAcademy ? `<a href="/admin/${org.code}/academy" style="${navStyle('academy')}">🎓 Academy</a>` : '';

    return `<!DOCTYPE html><html><head><title>${org.name}</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:-apple-system,sans-serif;background:#f4f7f6;margin:0;padding-bottom:50px;}.header{background:white;padding:20px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;}.nav{background:white;padding:0 20px;border-bottom:1px solid #ddd;overflow-x:auto;white-space:nowrap;display:flex;}.container{padding:20px;max-width:800px;margin:0 auto;}.card{background:white;padding:20px;border-radius:10px;box-shadow:0 2px 5px rgba(0,0,0,0.05);margin-bottom:20px;}.btn{display:inline-block;padding:12px 20px;background:#1e272e;color:white;text-decoration:none;border-radius:8px;border:none;font-weight:bold;font-size:14px;width:100%;text-align:center;cursor:pointer;}.btn-del{background:#ffebeb;color:#d63031;padding:5px 10px;font-size:11px;width:auto;border-radius:4px;border:none;}.approve{background:#2ecc71;}.reject{background:#e74c3c;}.img-preview{max-width:100%;height:auto;border:1px solid #ddd;border-radius:5px;margin-top:10px;}input,select,textarea,button{box-sizing:border-box;}input,select,textarea{width:100%;padding:12px;margin-bottom:15px;border:1px solid #ddd;border-radius:6px;}label{display:block;margin-bottom:5px;font-weight:bold;font-size:12px;color:#555;text-transform:uppercase;}table{width:100%;border-collapse:collapse;}td,th{padding:12px 8px;border-bottom:1px solid #eee;font-size:14px;text-align:left;}.badge{padding:4px 8px;border-radius:4px;font-size:10px;color:white;font-weight:bold;}a{color:#0984e3;text-decoration:none;}</style></head>
    <body><div class="header"><b>${org.name} (${org.type})</b><a href="/admin/${org.code}/logout" style="color:red;font-size:12px;">Logout</a></div>
    <div class="nav">
        <a href="/admin/${org.code}/dashboard" style="${navStyle('dashboard')}">📊 Dashboard</a>
        <a href="/admin/${org.code}/transactions" style="${navStyle('transactions')}">🧾 Ledger</a>
        ${verifyTab}
        <a href="/admin/${org.code}/members" style="${navStyle('members')}">👥 Members/Clients</a>
        ${appointmentsTab} ${servicesTab} ${claimsTab}
        ${eventsTab} ${academyTab}
        <a href="/admin/${org.code}/team" style="${navStyle('team')}">🛡️ Team</a>
        <a href="/admin/${org.code}/broadcast" style="${navStyle('broadcast')}">📢 Broadcasts</a>
        <a href="/admin/${org.code}/settings" style="${navStyle('settings')}">⚙️ Settings</a>
    </div><div class="container">${content}</div></body></html>`;
};

module.exports = (app, { prisma }) => {

    // --- MIDDLEWARE ---
    const checkSession = async (req, res, next) => {
        const { code } = req.params;
        const cookies = parseCookies(req);
        if (!cookies[`session_${code}`]) return res.redirect(`/admin/${code}`);
        req.org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
        if (!req.org) return res.send("Not Found");
        next();
    };

    // ==========================================
    // 🔐 ONBOARDING & MFA SETUP SCREEN (Triggered by Super Admin)
    // ==========================================
    router.get('/org/setup/:token', async (req, res) => {
        try {
            const org = await prisma.church.findFirst({ where: { setupToken: req.params.token } });
            if (!org) return res.send("<h1>Invalid or Expired Link</h1>");

            const secret = speakeasy.generateSecret({ name: `Seabe: ${org.name}` });
            const qrImage = await qrcode.toDataURL(secret.otpauth_url);

            res.send(`
                <html><body style="font-family:sans-serif; background:#f4f7f6; display:flex; justify-content:center; align-items:center; height:100vh; margin:0;">
                <form action="/org/setup/${req.params.token}" method="POST" style="background:white; padding:30px; border-radius:10px; width:350px; box-shadow:0 10px 25px rgba(0,0,0,0.1); text-align:center;">
                    <h2>Setup Secure Access</h2>
                    <p style="color:#7f8c8d; font-size:14px;">Welcome, <strong>${org.name}</strong></p>
                    
                    <input type="hidden" name="tempSecret" value="${secret.base32}">
                    
                    <div style="margin-bottom:15px; text-align:left;">
                        <label style="font-size:12px; font-weight:bold; color:#555;">Create Password</label>
                        <input type="password" name="password" required minlength="8" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:5px; box-sizing:border-box;">
                    </div>

                    <div style="background:#f8f9fa; padding:15px; border-radius:8px; margin-bottom:15px;">
                        <p style="font-size:12px; margin-top:0;"><strong>Step 2:</strong> Scan this QR with Google Authenticator or Authy.</p>
                        <img src="${qrImage}" style="width:150px; height:150px; border:3px solid #fff; border-radius:8px; box-shadow:0 2px 5px rgba(0,0,0,0.1);">
                    </div>

                    <div style="margin-bottom:15px; text-align:left;">
                        <label style="font-size:12px; font-weight:bold; color:#555;">Enter 6-Digit App Code</label>
                        <input type="text" name="totp" required placeholder="000 000" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:5px; box-sizing:border-box; text-align:center; font-weight:bold; letter-spacing:2px;">
                    </div>

                    <button style="width:100%; padding:15px; background:#1e272e; color:white; border:none; border-radius:5px; cursor:pointer; font-weight:bold;">SECURE MY ACCOUNT</button>
                </form>
                </body></html>
            `);
        } catch (e) {
            res.send("Error: " + e.message);
        }
    });

    router.post('/org/setup/:token', async (req, res) => {
        try {
            const { password, tempSecret, totp } = req.body;
            const org = await prisma.church.findFirst({ where: { setupToken: req.params.token } });
            
            if (!org) return res.send("Link expired.");

            const isValidMfa = speakeasy.totp.verify({
                secret: tempSecret,
                encoding: 'base32',
                token: totp,
                window: 1
            });

            if (!isValidMfa) return res.send("<h2>Setup Failed</h2><p>Incorrect Authenticator Code.</p><a href='javascript:history.back()'>Try again</a>");

            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            await prisma.church.update({
                where: { id: org.id },
                data: {
                    password: hashedPassword,
                    mfaSecret: tempSecret,
                    setupToken: null // Destroy token
                }
            });

            res.send(`
                <html><body style="font-family:sans-serif; background:#f4f7f6; display:flex; justify-content:center; align-items:center; height:100vh; margin:0;">
                <div style="background:white; padding:40px; border-radius:10px; width:350px; box-shadow:0 10px 25px rgba(0,0,0,0.1); text-align:center;">
                    <h2>Setup Complete! 🎉</h2>
                    <p style="color:#7f8c8d;">Your portal is now secured with Bank-Grade MFA.</p>
                    <a href="/admin/${org.code}" style="display:inline-block; padding:12px 20px; background:#27ae60; color:white; text-decoration:none; border-radius:5px; margin-top:15px; font-weight:bold;">Go to Login</a>
                </div>
                </body></html>
            `);
        } catch (e) {
            res.send("Error: " + e.message);
        }
    });

    // ==========================================
    // 🔐 LOGIN (Now Requires Password + MFA)
    // ==========================================
    router.get('/admin/:code', async (req, res) => {
        const { code } = req.params;
        const org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
        if (!org) return res.send("Not Found");

        res.send(`
            <html><body style="font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; background:#f4f7f6; margin:0;">
                <form action="/admin/${code}/login" method="POST" style="background:white; padding:30px; border-radius:10px; width:300px; box-shadow:0 10px 25px rgba(0,0,0,0.1);">
                    <h3 style="text-align:center; margin-top:0; color:#1e272e;">🔐 ${org.name}</h3>
                    
                    <div style="margin-bottom:15px;">
                        <label style="font-size:12px; font-weight:bold; color:#7f8c8d;">Admin Phone</label>
                        <input type="text" name="phone" placeholder="+27..." required style="width:100%; padding:12px; border:1px solid #ddd; border-radius:5px; box-sizing:border-box;">
                    </div>
                    
                    <div style="margin-bottom:15px;">
                        <label style="font-size:12px; font-weight:bold; color:#7f8c8d;">Password</label>
                        <input type="password" name="password" required style="width:100%; padding:12px; border:1px solid #ddd; border-radius:5px; box-sizing:border-box;">
                    </div>

                    <div style="margin-bottom:20px; background:#fffbe6; padding:15px; border:1px solid #ffe58f; border-radius:5px;">
                        <label style="font-size:12px; font-weight:bold; color:#d48806;">Google Authenticator Code</label>
                        <input type="text" name="totp" required placeholder="000 000" autocomplete="off" style="width:100%; padding:12px; border:1px solid #ddd; border-radius:5px; box-sizing:border-box; text-align:center; font-weight:bold; letter-spacing:2px; margin-top:5px;">
                    </div>

                    <button style="width:100%; padding:15px; background:#1e272e; color:white; border:none; border-radius:5px; cursor:pointer; font-weight:bold;">SECURE LOGIN</button>
                </form>
            </body></html>
        `);
    });

    router.post('/admin/:code/login', async (req, res) => {
        try {
            const { phone, password, totp } = req.body;
            const code = req.params.code.toUpperCase();
            
            // 1. Create different variations of the phone number
            const rawPhone = phone.trim();
            let cleanPhone = rawPhone.replace(/\D/g, ''); // Removes +, spaces, etc.
            let localPhone = cleanPhone; // e.g. 083...
            let intlPhone = cleanPhone;  // e.g. 2783...

            if (cleanPhone.startsWith('0')) intlPhone = '27' + cleanPhone.substring(1);
            if (cleanPhone.startsWith('27')) localPhone = '0' + cleanPhone.substring(2);
            
            // 2. Tell the database to check ALL of them!
            const org = await prisma.church.findFirst({ 
                where: { 
                    code: code, 
                    OR: [
                        { adminPhone: rawPhone },
                        { adminPhone: cleanPhone },
                        { adminPhone: localPhone },
                        { adminPhone: intlPhone },
                        { adminPhone: '+' + intlPhone }
                    ]
                } 
            });
            
            if (!org || !org.password || !org.mfaSecret) {
                return res.send(`<h2>Login Failed</h2><p>Invalid Credentials or MFA Setup Incomplete.</p><a href="/admin/${code}">Back</a>`);
            }

            const validPass = await bcrypt.compare(password, org.password);
            if (!validPass) {
                return res.send(`<h2>Login Failed</h2><p>Invalid Password.</p><a href="/admin/${code}">Back</a>`);
            }

            const isValidMfa = speakeasy.totp.verify({
                secret: org.mfaSecret,
                encoding: 'base32',
                token: totp,
                window: 1
            });

            if (!isValidMfa) {
                return res.send(`<h2>Login Failed</h2><p>Invalid 2FA Code.</p><a href="/admin/${code}">Back</a>`);
            }

            // Success! Set cookie and redirect
            res.setHeader('Set-Cookie', `session_${org.code}=active; HttpOnly; Path=/; Max-Age=86400`);
            res.redirect(`/admin/${org.code}/dashboard`);
            
        } catch (e) {
            res.send("Error: " + e.message);
        }
    });
    
    // --- Vendors ---
    
    // 1. Explicitly serve the HTML directly from memory
    router.get('/crm/vendors.html', (req, res) => {
        res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Vendor Directory & RFQ</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 font-sans p-6">
    <div class="max-w-6xl mx-auto">
        <div class="flex justify-between items-center mb-6">
            <div>
                <h1 class="text-2xl font-bold text-gray-800">🛒 Vendor Directory</h1>
                <p class="text-sm text-gray-500">Manage suppliers and send automated quote requests.</p>
            </div>
            <div class="space-x-2">
                <button onclick="toggleModal('rfqModal')" class="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded shadow transition">
                    🚀 Send RFQ
                </button>
                <button onclick="toggleModal('addVendorModal')" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded shadow transition">
                    + Add Vendor
                </button>
            </div>
        </div>

        <div class="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
            <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-100">
                    <tr>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Vendor Name</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contact</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    </tr>
                </thead>
                <tbody id="vendor-table-body" class="bg-white divide-y divide-gray-200">
                    <tr><td colspan="4" class="px-6 py-4 text-center text-gray-500">Loading vendors...</td></tr>
                </tbody>
            </table>
        </div>
    </div>

    <div id="addVendorModal" class="fixed inset-0 bg-gray-900 bg-opacity-50 hidden flex items-center justify-center z-50">
        <div class="bg-white rounded-lg p-8 max-w-md w-full shadow-2xl">
            <h2 class="text-xl font-bold mb-4 border-b pb-2">Add New Vendor</h2>
            <form id="add-vendor-form" class="space-y-4">
                <div>
                    <label class="block text-sm font-bold text-gray-700">Company Name</label>
                    <input type="text" id="v-name" required class="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500">
                </div>
                <div>
                    <label class="block text-sm font-bold text-gray-700">Category</label>
                    <select id="v-category" class="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500">
                        <option>Catering</option>
                        <option>Tent & Chair Hire</option>
                        <option>Undertaker / Hearse</option>
                        <option>Florist</option>
                        <option>Logistics / Bus</option>
                        <option>Other</option>
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-bold text-gray-700">WhatsApp / Phone Number</label>
                    <input type="text" id="v-phone" required placeholder="e.g., 0821234567" class="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500">
                </div>
                <div class="flex justify-end space-x-3 pt-4 border-t">
                    <button type="button" onclick="toggleModal('addVendorModal')" class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
                    <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">Save</button>
                </div>
            </form>
        </div>
    </div>

    <div id="rfqModal" class="fixed inset-0 bg-gray-900 bg-opacity-50 hidden flex items-center justify-center z-50">
        <div class="bg-white rounded-lg p-8 max-w-md w-full shadow-2xl border-t-4 border-orange-500">
            <h2 class="text-xl font-bold mb-1">🚀 Request for Quote (RFQ)</h2>
            <p class="text-xs text-gray-500 mb-4 pb-2 border-b">Blast a WhatsApp message to all vendors in a category.</p>
            <form id="rfq-form" class="space-y-4">
                <div>
                    <label class="block text-sm font-bold text-gray-700">Select Vendor Category</label>
                    <select id="rfq-category" class="w-full p-2 border rounded focus:ring-2 focus:ring-orange-500 bg-gray-50">
                        <option>Catering</option>
                        <option>Tent & Chair Hire</option>
                        <option>Undertaker / Hearse</option>
                        <option>Florist</option>
                        <option>Logistics / Bus</option>
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-bold text-gray-700">Requirement Details</label>
                    <textarea id="rfq-details" rows="4" required placeholder="e.g., Need a 5x10m tent and 50 chairs for a funeral this Saturday in Orkney. Please quote." class="w-full p-2 border rounded focus:ring-2 focus:ring-orange-500"></textarea>
                </div>
                <div id="rfq-status" class="hidden text-sm font-bold text-center p-2 rounded"></div>
                <div class="flex justify-end space-x-3 pt-4 border-t">
                    <button type="button" onclick="toggleModal('rfqModal')" class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
                    <button type="submit" id="rfq-submit-btn" class="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded shadow">Blast RFQ</button>
                </div>
            </form>
        </div>
    </div>

    <script>
        const urlParams = new URLSearchParams(window.location.search);
        const CHURCH_CODE = urlParams.get('code');

        function toggleModal(id) {
            document.getElementById(id).classList.toggle('hidden');
        }

        async function loadVendors() {
            try {
                const res = await fetch(\`/api/crm/vendors/\${CHURCH_CODE}\`);
                const data = await res.json();
                const tbody = document.getElementById('vendor-table-body');
                tbody.innerHTML = '';

                if (data.vendors.length === 0) {
                    tbody.innerHTML = \`<tr><td colspan="4" class="px-6 py-4 text-center text-gray-500">No vendors added yet. Click 'Add Vendor' to start.</td></tr>\`;
                    return;
                }

                data.vendors.forEach(v => {
                    tbody.innerHTML += \`
                        <tr class="hover:bg-gray-50">
                            <td class="px-6 py-4 whitespace-nowrap font-medium text-gray-900">\${v.name}</td>
                            <td class="px-6 py-4 whitespace-nowrap"><span class="px-2 inline-flex text-xs font-semibold rounded-full bg-blue-100 text-blue-800">\${v.category}</span></td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">\${v.phone}</td>
                            <td class="px-6 py-4 whitespace-nowrap"><span class="px-2 inline-flex text-xs font-semibold rounded-full bg-green-100 text-green-800">ACTIVE</span></td>
                        </tr>
                    \`;
                });
            } catch (e) { console.error(e); }
        }

        // Handle Add Vendor
        document.getElementById('add-vendor-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const payload = {
                name: document.getElementById('v-name').value,
                category: document.getElementById('v-category').value,
                phone: document.getElementById('v-phone').value,
            };
            const res = await fetch(\`/api/crm/vendors/\${CHURCH_CODE}\`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
            });
            const result = await res.json();
            if (result.success) {
                toggleModal('addVendorModal');
                document.getElementById('add-vendor-form').reset();
                loadVendors(); 
            } else alert("Error: " + result.error);
        });

        // Handle Send RFQ
        document.getElementById('rfq-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('rfq-submit-btn');
            const statusBox = document.getElementById('rfq-status');
            
            btn.innerText = "Sending...";
            btn.disabled = true;
            statusBox.classList.add('hidden');

            const payload = {
                category: document.getElementById('rfq-category').value,
                details: document.getElementById('rfq-details').value
            };

            try {
                const res = await fetch(\`/api/crm/vendors/\${CHURCH_CODE}/rfq\`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
                });
                const result = await res.json();
                
                statusBox.classList.remove('hidden');
                if (result.success) {
                    statusBox.className = "text-sm font-bold text-center p-2 rounded bg-green-100 text-green-800 mt-4";
                    statusBox.innerText = "✅ " + result.message;
                    setTimeout(() => { toggleModal('rfqModal'); statusBox.classList.add('hidden'); }, 3000);
                    document.getElementById('rfq-form').reset();
                } else {
                    statusBox.className = "text-sm font-bold text-center p-2 rounded bg-red-100 text-red-800 mt-4";
                    statusBox.innerText = "❌ " + result.error;
                }
            } catch (error) {
                statusBox.className = "text-sm font-bold text-center p-2 rounded bg-red-100 text-red-800 mt-4";
                statusBox.innerText = "❌ System Error";
            } finally {
                btn.innerText = "Blast RFQ";
                btn.disabled = false;
            }
        });

        loadVendors();
    </script>
</body>
</html>
        `);
    });

    // 2. The Admin Iframe Dashboard (Untouched)
    router.get('/admin/:code/vendors', checkSession, (req, res) => {
        const content = `
            <style> .container { max-width: 1200px !important; padding: 0 !important; } </style>
            <iframe 
                src="/crm/vendors.html?code=${req.params.code}" 
                style="width: 100%; height: 85vh; border: none; border-radius: 8px;"
                title="Vendor Directory"
            ></iframe>
        `;
        res.send(renderPage(req.org, 'vendors', content));
    });
    
    // 3. Send RFQ Blast via WhatsApp
    router.post('/api/crm/vendors/:code/rfq', express.json(), async (req, res) => {
        try {
            const { category, details } = req.body;
            
            const org = await prisma.church.findUnique({ where: { code: req.params.code } });
            if (!org) return res.status(404).json({ success: false, error: "Organization not found" });

            // Find all vendors in this specific category
            const vendors = await prisma.vendor.findMany({
                where: { churchId: org.id, category: category }
            });

            if (vendors.length === 0) {
                return res.status(400).json({ success: false, error: `No vendors found in the '${category}' category.` });
            }

            let sentCount = 0;
            for (const vendor of vendors) {
                if (vendor.phone) {
                    // Format the WhatsApp Message
                    const msg = `📢 *Request For Quote (RFQ)*\n\n*From:* ${org.name}\n*Category:* ${category}\n\n*Requirement:*\n${details}\n\n_Please reply directly to this message with your price estimate._`;
                    
                    // Clean the phone number for Twilio (+27 format)
                    let cleanPhone = vendor.phone.replace(/\D/g, '');
                    if (cleanPhone.startsWith('0')) cleanPhone = '27' + cleanPhone.substring(1);
                    
                    // Send the message
                    await sendWhatsApp(cleanPhone, msg).catch(e => console.error("RFQ Send Error", e));
                    sentCount++;
                }
            }

            res.json({ success: true, message: `RFQ blasted to ${sentCount} vendor(s)!` });
        } catch (error) {
            console.error("RFQ Blast Error:", error);
            res.status(500).json({ success: false, error: "Failed to send RFQ blast." });
        }
    });

    // ============================================================
    // 📊 DASHBOARD & WALLET SUMMARY
    // ============================================================
    router.get('/admin/:code/dashboard', checkSession, async (req, res) => {
        try {
            const org = req.org;

            // 1. Calculate Pending Wallet (Cleared Netcash, waiting for Seabe payout)
            const pendingStats = await prisma.transaction.aggregate({
                where: { churchCode: org.code, status: 'SUCCESS', payoutId: null },
                _sum: { netSettlement: true, amount: true, platformFee: true, netcashFee: true },
                _count: { id: true }
            });

            // 2. Calculate Lifetime Settled (Money already paid into their bank account)
            const settledStats = await prisma.transaction.aggregate({
                where: { churchCode: org.code, status: 'SUCCESS', payoutId: { not: null } },
                _sum: { netSettlement: true },
                _count: { id: true }
            });

            const pendingGross = pendingStats._sum.amount || 0;
            const pendingFees = (pendingStats._sum.platformFee || 0) + (pendingStats._sum.netcashFee || 0);
            const pendingNet = pendingStats._sum.netSettlement || 0;
            const totalSettled = settledStats._sum.netSettlement || 0;

            // 3. Get Recent Transactions
            const recentTxs = await prisma.transaction.findMany({
                where: { churchCode: org.code },
                orderBy: { date: 'desc' },
                take: 10,
                include: { member: true }
            });

            const txRows = recentTxs.map(tx => `
                <tr>
                    <td>${new Date(tx.date).toLocaleDateString()}</td>
                    <td>${tx.member ? tx.member.firstName + ' ' + tx.member.lastName : 'Walk-in'}</td>
                    <td>R${tx.amount.toFixed(2)}</td>
                    <td style="color:#27ae60; font-weight:bold;">+ R${(tx.netSettlement || 0).toFixed(2)}</td>
                    <td>${tx.payoutId ? '<span class="badge" style="background:#27ae60;">Settled</span>' : '<span class="badge" style="background:#e67e22;">Pending</span>'}</td>
                </tr>
            `).join('');

            const content = `
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:20px; margin-bottom:30px;">
                    <div class="card" style="border-top:4px solid #3498db; margin-bottom:0;">
                        <div style="font-size:11px; color:#7f8c8d; text-transform:uppercase; font-weight:bold; margin-bottom:5px;">Available Balance (Pending Payout)</div>
                        <h2 style="font-size:24px; color:#2c3e50; margin:0;">R ${pendingNet.toFixed(2)}</h2>
                        <div style="font-size:11px; color:#7f8c8d; margin-top:8px;">Gross: R${pendingGross.toFixed(2)} | Fees: -R${pendingFees.toFixed(2)}</div>
                    </div>
                    <div class="card" style="border-top:4px solid #2ecc71; margin-bottom:0;">
                        <div style="font-size:11px; color:#7f8c8d; text-transform:uppercase; font-weight:bold; margin-bottom:5px;">Lifetime Settled (Paid Out)</div>
                        <h2 style="font-size:24px; color:#2c3e50; margin:0;">R ${totalSettled.toFixed(2)}</h2>
                        <div style="font-size:11px; color:#27ae60; margin-top:8px;">✅ Transferred to Bank Account</div>
                    </div>
                </div>

                <div class="card">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                        <h3 style="margin:0; color:#2c3e50;">Recent Ledger Activity</h3>
                        <a href="/admin/${org.code}/transactions" style="font-size:12px; color:#3498db; text-decoration:none; font-weight:bold;">View All &rarr;</a>
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Payer</th>
                                <th>Gross Paid</th>
                                <th>Net Received</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${txRows || '<tr><td colspan="5" style="text-align:center; padding:20px; color:#95a5a6;">No transactions yet.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            `;
            res.send(renderPage(req.org, 'dashboard', content));
        } catch (e) {
            res.status(500).send("Error loading dashboard: " + e.message);
        }
    });

    // ============================================================
    // 🧾 TRANSACTION LEDGER
    // ============================================================
    router.get('/admin/:code/transactions', checkSession, async (req, res) => {
        try {
            const org = req.org;
            const transactions = await prisma.transaction.findMany({
                where: { churchCode: org.code },
                orderBy: { date: 'desc' },
                take: 100,
                include: { member: true, payoutBatch: true }
            });

            const rows = transactions.map(tx => {
                const isSuccess = tx.status === 'SUCCESS';
                const totalFees = (tx.platformFee || 0) + (tx.netcashFee || 0);
                const feeText = isSuccess ? `- R${totalFees.toFixed(2)} fees` : 'Failed';
                const netText = isSuccess ? `R${(tx.netSettlement || 0).toFixed(2)}` : 'R0.00';
                
                let settlementStatus = '<span class="badge" style="background:#eee; color:#666;">N/A</span>';
                if (isSuccess) {
                    settlementStatus = tx.payoutId 
                        ? `<span style="color:#27ae60; font-weight:bold; font-size:12px;">✅ Paid (Batch #${tx.payoutId})</span>` 
                        : `<span style="color:#e67e22; font-weight:bold; font-size:12px;">⏳ Pending Payout</span>`;
                }

                let statusBadgeColor = isSuccess ? '#27ae60' : '#e74c3c';
                if(tx.status === 'PENDING') statusBadgeColor = '#f39c12';

                return `
                    <tr>
                        <td>
                            <span style="font-family:monospace; font-size:11px; color:#7f8c8d;">${tx.reference}</span><br>
                            ${new Date(tx.date).toLocaleString()}
                        </td>
                        <td>
                            <strong>${tx.member ? tx.member.firstName + ' ' + tx.member.lastName : 'Walk-in / Link'}</strong><br>
                            <span style="font-size:11px; color:#95a5a6;">${tx.phone || 'No Phone'}</span>
                        </td>
                        <td>
                            <strong>R${tx.amount.toFixed(2)}</strong><br>
                            <span style="font-size:10px; color:#c0392b;">${feeText}</span>
                        </td>
                        <td style="color:${isSuccess ? '#27ae60' : '#95a5a6'}; font-weight:bold;">${netText}</td>
                        <td><span class="badge" style="background:${statusBadgeColor};">${tx.status}</span></td>
                        <td>${settlementStatus}</td>
                    </tr>
                `;
            }).join('');

            const content = `
                <div class="card" style="border-top:4px solid #34db98;">
                    <h3 style="margin-top:0;">Master Ledger</h3>
                    <p style="font-size:12px; color:#7f8c8d; margin-bottom:20px;">Detailed breakdown of all gross payments, deducted gateway/platform fees, and your final Net Settlement.</p>
                    <table>
                        <thead>
                            <tr>
                                <th>Ref & Date</th>
                                <th>Payer Details</th>
                                <th>Gross & Fees</th>
                                <th>Net Settlement</th>
                                <th>Payment Status</th>
                                <th>Payout Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows || '<tr><td colspan="6" style="text-align:center; padding:30px;">No transactions recorded.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            `;
            res.send(renderPage(req.org, 'transactions', content));
        } catch (e) {
            res.status(500).send("Error loading transactions: " + e.message);
        }
    });
	
// ==========================================
    // 📅 MERCHANT DASHBOARD: APPOINTMENTS
    // ==========================================
    router.get('/admin/:code/appointments', checkSession, async (req, res) => {
        const orgCode = req.params.code.toUpperCase();

        try {
            const appointments = await prisma.appointment.findMany({
                where: { churchId: req.org.id },
                include: { 
                    member: true,   
                    product: true   
                },
                orderBy: { bookingDate: 'desc' }
            });

            let rowsHtml = '';
            
            if (appointments.length === 0) {
                rowsHtml = `<tr><td colspan="5" style="text-align:center; padding:30px; color:#95a5a6;">No appointments booked yet.</td></tr>`;
            } else {
                appointments.forEach(appt => {
                    const dateObj = new Date(appt.bookingDate);
                    const formattedDate = dateObj.toLocaleDateString('en-ZA', { weekday: 'short', month: 'short', day: 'numeric' });
                    const formattedTime = dateObj.toLocaleTimeString('en-ZA', { hour: '2-digit', minute:'2-digit' });

                    let statusBadgeColor = '#f39c12'; // PENDING
                    if (appt.status === 'CONFIRMED' || appt.status === 'COMPLETED') statusBadgeColor = '#27ae60';
                    if (appt.status === 'CANCELLED') statusBadgeColor = '#c0392b';
                    let statusBadge = `<span class="badge" style="background:${statusBadgeColor};">${appt.status}</span>`;

                    const basePrice = appt.product.price.toFixed(2);

                    // --- 🚀 DYNAMIC ACTION BUTTONS ---
                    let actionBtns = '-';
                    if (appt.status === 'CONFIRMED' && !appt.depositPaid) {
                        actionBtns = `
                            <button onclick="openCheckoutModal(${appt.id}, '${appt.member.firstName}', '${appt.product.name}', ${basePrice})" class="btn" style="background:#00d2d3; color:#1e272e; padding:6px 12px; font-size:11px; width:auto;">
                                💳 Send Bill
                            </button>`;
                    } else if (appt.status === 'PENDING_PAYMENT') {
                        actionBtns = `
                            <button id="resend-btn-${appt.id}"
                                class="btn"
                                style="background:#fff7ed; color:#ea580c; border:1px solid #fdba74; padding:6px 12px; font-size:11px; width:auto;"
                                onclick="executeResendLink(${appt.id})"
                                data-sent-time="${appt.updatedAt.toISOString()}"
                                disabled>
                                Wait...
                            </button>`;
                    } else if (appt.depositPaid || appt.status === 'COMPLETED') {
                        actionBtns = `
                            <button class="btn" 
                                style="background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0; padding:6px 12px; font-size:11px; width:auto;"
                                onclick="resendInvoice(${appt.id})">
                                🧾 Resend Invoice
                            </button>`;
                    }
                    
                    rowsHtml += `
                        <tr>
                            <td>
                                <strong>${formattedDate}</strong><br>
                                <span style="font-size:11px; color:#7f8c8d;">${formattedTime}</span>
                            </td>
                            <td>
                                <strong>${appt.member.firstName} ${appt.member.lastName || ''}</strong><br>
                                <a href="https://wa.me/${appt.member.phone.replace('+', '')}" target="_blank" style="font-size:11px; color:#0984e3; text-decoration:none;">${appt.member.phone}</a>
                            </td>
                            <td>
                                <strong>${appt.product.name}</strong><br>
                                <span style="font-size:11px; color:#7f8c8d;">R${basePrice}</span>
                            </td>
                            <td>${statusBadge}</td>
                            <td style="text-align:right;">${actionBtns}</td>
                        </tr>
                    `;
                });
            }

            const content = `
                <div class="card" style="display:flex; justify-content:space-between; align-items:center; background:#1e272e; color:white;">
                    <div>
                        <h2 style="margin:0; color:#00d2d3;">📅 Appointments Schedule</h2>
                        <p style="margin:0; margin-top:5px; font-size:13px; color:#b2bec3;">Manage your bookings and daily schedule.</p>
                    </div>
                </div>

                <div class="card" style="overflow-x:auto;">
                    <table>
                        <thead>
                            <tr>
                                <th>Date & Time</th>
                                <th>Client</th>
                                <th>Service</th>
                                <th>Status</th>
                                <th style="text-align:right;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>

                <div id="checkoutModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:1000; justify-content:center; align-items:center;">
                    <div style="background:white; width:90%; max-width:400px; border-radius:10px; padding:20px; box-shadow:0 10px 25px rgba(0,0,0,0.2);">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                            <h3 style="margin:0; color:#1e272e;">Checkout: <span id="clientNameDisplay"></span></h3>
                            <button type="button" onclick="document.getElementById('checkoutModal').style.display='none'" style="background:none; border:none; font-size:20px; cursor:pointer;">&times;</button>
                        </div>
                        <form id="checkoutForm" method="POST">
                            <label>Add Products/Extras Used</label>
                            <input type="text" name="addedItems" placeholder="e.g. Beard Oil, Color Dye">
                            <label>Final Total Amount (R)</label>
                            <input type="number" name="finalAmount" id="finalAmountInput" step="0.01" required>
                            <button type="submit" class="btn">Send Payment Link 📱</button>
                        </form>
                    </div>
                </div>

                <script>
                    function openCheckoutModal(id, clientName, serviceName, basePrice) {
                        document.getElementById('clientNameDisplay').innerText = clientName;
                        document.getElementById('finalAmountInput').value = basePrice;
                        document.getElementById('checkoutForm').action = '/admin/${orgCode}/appointments/' + id + '/send-bill';
                        document.getElementById('checkoutModal').style.display = 'flex';
                    }

                    // --- ⏳ COUNTDOWN TIMER LOGIC ---
                    document.addEventListener('DOMContentLoaded', () => {
                        document.querySelectorAll('[id^="resend-btn-"]').forEach(btn => {
                            const sentTime = new Date(btn.dataset.sentTime).getTime();
                            const checkTimer = setInterval(() => {
                                const now = new Date().getTime();
                                const diffSeconds = (now - sentTime) / 1000;

                                if (diffSeconds >= 120) {
                                    btn.disabled = false;
                                    btn.innerHTML = "🔄 Resend Link";
                                    btn.style.background = "#ea580c";
                                    btn.style.color = "white";
                                    clearInterval(checkTimer);
                                } else {
                                    const remaining = Math.ceil(120 - diffSeconds);
                                    btn.innerHTML = 'Wait ' + remaining + 's';
                                }
                            }, 1000);
                        });
                    });

                    // --- 🔗 RESEND LINK EXECUTION ---
                    function executeResendLink(apptId) {
                        if(!confirm("Resend the payment link to the client?")) return;
                        const form = document.createElement('form');
                        form.method = 'POST';
                        form.action = window.location.pathname + '/' + apptId + '/send-bill';
                        document.body.appendChild(form);
                        form.submit();
                    }

                    // --- 🧾 RESEND INVOICE ---
                    async function resendInvoice(apptId) {
                        if(!confirm("Resend the official PDF invoice to the client?")) return;
                        const fetchUrl = window.location.pathname + '/' + apptId + '/resend-invoice';
                        try {
                            const response = await fetch(fetchUrl, { method: 'POST', headers: {'Content-Type': 'application/json'} });
                            const data = await response.json();
                            if(data.success) alert("✅ Invoice successfully resent!");
                            else alert("⚠️ Error: " + data.error);
                        } catch (error) {
                            alert("⚠️ Connection error.");
                        }
                    }
                </script>
            `;

            res.send(renderPage(req.org, 'appointments', content));

        } catch (e) {
            console.error("Schedule Load Error:", e);
            res.send(renderPage(req.org, 'appointments', '<div class="card">System Error Loading Schedule</div>'));
        }
    });

    // ==========================================
    // 💳 MERCHANT DASHBOARD: SEND BILL
    // ==========================================
    router.post('/admin/:code/appointments/:id/send-bill', express.urlencoded({ extended: true }), async (req, res) => {
        const { id, code } = req.params;
        const { addedItems, finalAmount } = req.body;

        try {
            const appt = await prisma.appointment.findUnique({ 
                where: { id: parseInt(id) }, 
                include: { member: true, product: true } 
            });
            
            // Use provided values or fallback to existing data for resends
            const amount = finalAmount ? parseFloat(finalAmount) : appt.finalAmount;
            const extras = addedItems !== undefined ? addedItems : appt.addedItems;

            const appointment = await prisma.appointment.update({
                where: { id: parseInt(id) },
                data: { 
                    addedItems: extras || null,
                    finalAmount: amount || appt.product.price,
                    status: 'PENDING_PAYMENT',
                    updatedAt: new Date() // 🚀 Reset the 2-minute timer
                },
                include: { member: true, church: true, product: true }
            });

            const host = process.env.HOST_URL || 'https://seabe.tech';
            const payLink = `${host}/pay?apptId=${appointment.id}&amount=${appointment.finalAmount}`;
            const extrasText = appointment.addedItems ? `\n➕ *Extras:* ${appointment.addedItems}` : '';
            
            const msg = `🧾 *${appointment.church.name} - Invoice*\n\nHi ${appointment.member.firstName}, your payment link is ready.\n\n✂️ *Service:* ${appointment.product.name}${extrasText}\n💰 *Total Due:* R${appointment.finalAmount.toFixed(2)}\n\n👉 Click to pay: ${payLink}`;

            const twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
            const botPhone = process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '');
            
            await twilioClient.messages.create({
                from: `whatsapp:${botPhone}`,
                to: `whatsapp:${appointment.member.phone}`,
                body: msg
            });

            res.redirect(`/admin/${code}/appointments`);

        } catch (e) {
            console.error("Send Bill Error:", e);
            res.status(500).send("Error sending bill.");
        }
    });

    // ==========================================
    // 🧾 RESEND INVOICE (PDF to WhatsApp)
    // ==========================================
    router.post('/admin/:code/appointments/:id/resend-invoice', async (req, res) => {
        try {
            const appt = await prisma.appointment.findUnique({
                where: { id: parseInt(req.params.id) },
                include: { member: true, church: true, product: true }
            });

            if (!appt) return res.status(404).json({ success: false, error: "Appointment not found." });

            const tx = await prisma.transaction.findFirst({
                where: { churchId: appt.churchId, memberId: appt.memberId, status: 'SUCCESS' },
                orderBy: { date: 'desc' }
            });

            if (!tx) return res.status(400).json({ success: false, error: "No successful payment found." });

            const { generateReceiptPDF } = require('../services/receiptGenerator');
            const pdfUrl = await generateReceiptPDF(tx, appt.church);

            const twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
            const botPhone = process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '');
            
            await twilioClient.messages.create({
                from: `whatsapp:${botPhone}`,
                to: `whatsapp:${appt.member.phone}`,
                body: `🧾 *Invoice Copy*\n\nHi ${appt.member.firstName}, here is your official receipt for the *${appt.product.name}*.`,
                mediaUrl: [pdfUrl]
            });

            res.json({ success: true });

        } catch (error) {
            console.error("Resend Error:", error);
            res.status(500).json({ success: false, error: "Internal Server Error" });
        }
    });
	
	// ============================================================
    // 🎓 LMS / ACADEMY DASHBOARD (Schema Aligned + Modal)
    // ============================================================
    router.get('/admin/:code/academy', checkSession, async (req, res) => {
        try {
            const org = req.org;

            // 1. Fetch Enrollments & count total modules dynamically
            const enrollments = await prisma.enrollment.findMany({
                where: { 
                    course: { churchId: org.id } 
                },
                include: { 
                    member: true, 
                    course: {
                        include: {
                            _count: { select: { modules: true } } // Get total lesson count
                        }
                    }
                },
                orderBy: { updatedAt: 'desc' }
            });

            // 2. Calculate Top-Level Metrics
            const totalStudents = enrollments.length;
            const completedCourses = enrollments.filter(e => e.status === 'COMPLETED').length;
            
            // Group by Course to see Uptake
            const courseUptake = {};
            enrollments.forEach(e => {
                const courseName = e.course.title; 
                if (!courseUptake[courseName]) {
                    courseUptake[courseName] = { count: 0, completed: 0 };
                }
                courseUptake[courseName].count++;
                if (e.status === 'COMPLETED') courseUptake[courseName].completed++;
            });

            // 3. Generate Course Uptake HTML Rows
            const uptakeRows = Object.keys(courseUptake).map(courseName => {
                const data = courseUptake[courseName];
                const completionRate = data.count > 0 ? Math.round((data.completed / data.count) * 100) : 0;
                return `
                    <tr>
                        <td><strong>${courseName}</strong></td>
                        <td><span class="badge" style="background:#3498db;">${data.count} Enrolled</span></td>
                        <td>
                            <div style="width: 100%; background: #eee; border-radius: 4px; overflow: hidden; margin-top: 5px;">
                                <div style="height: 8px; width: ${completionRate}%; background: #27ae60;"></div>
                            </div>
                            <span style="font-size:10px; color:#7f8c8d;">${completionRate}% Completion</span>
                        </td>
                    </tr>
                `;
            }).join('') || '<tr><td colspan="3" style="text-align:center; color:#95a5a6;">No active courses yet.</td></tr>';

            // 4. Generate Student Progress HTML Rows
            const studentRows = enrollments.map(e => {
                const totalModules = e.course._count.modules || 1; 
                
                let progressPercent = Math.round((e.progress / totalModules) * 100);
                if (progressPercent > 100) progressPercent = 100;
                
                let deliveryBadge = `<span class="badge" style="background:#f39c12;">Module ${e.progress} Sent</span>`;
                
                if (e.status === 'COMPLETED') {
                    deliveryBadge = `<span class="badge" style="background:#27ae60;">✅ Graduated</span>`;
                } else if (e.status === 'PAUSED') {
                    deliveryBadge = `<span class="badge" style="background:#e74c3c;">⏸️ Paused</span>`;
                } else if (e.quizState === 'AWAITING_ANSWER') {
                    deliveryBadge = `<span class="badge" style="background:#8e44ad;">⏳ Waiting on Quiz Reply</span>`;
                }

                // 🚀 Added the View Answers button column here
                return `
                    <tr>
                        <td>
                            <strong>${e.member.firstName} ${e.member.lastName || ''}</strong><br>
                            <a href="https://wa.me/${e.member.phone.replace('+', '')}" target="_blank" style="font-size:11px; color:#0984e3; text-decoration:none;">${e.member.phone}</a>
                        </td>
                        <td><strong>${e.course.title}</strong></td>
                        <td>
                            <strong>${progressPercent}%</strong><br>
                            <span style="font-size:11px; color:#7f8c8d;">Module ${e.progress} / ${totalModules}</span>
                        </td>
                        <td>
                            ${deliveryBadge}<br>
                            <span style="font-size:10px; color:#aaa;">Last active: ${new Date(e.updatedAt).toLocaleDateString()}</span>
                        </td>
                        <td style="text-align:right;">
                            <button onclick="viewAnswers(${e.id}, '${e.member.firstName.replace(/'/g, "\\'")}')" class="btn" style="background:#8e44ad; padding:6px 12px; font-size:11px; width:auto;">
                                📝 View Answers
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');

            // 5. The Dashboard UI Layout
            const content = `
                <div class="card" style="background:#2c3e50; color:white; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <h2 style="margin:0; color:#00d2d3;">🎓 Academy Mission Control</h2>
                        <p style="margin:5px 0 0 0; font-size:13px; color:#b2bec3;">Track student progress, course uptake, and WhatsApp delivery logs.</p>
                    </div>
                </div>

                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:20px; margin-bottom:20px;">
                    <div class="card" style="border-top:4px solid #3498db; margin-bottom:0;">
                        <div style="font-size:11px; color:#7f8c8d; text-transform:uppercase; font-weight:bold;">Total Active Students</div>
                        <h2 style="font-size:28px; color:#2c3e50; margin:5px 0;">${totalStudents}</h2>
                    </div>
                    <div class="card" style="border-top:4px solid #27ae60; margin-bottom:0;">
                        <div style="font-size:11px; color:#7f8c8d; text-transform:uppercase; font-weight:bold;">Total Graduates</div>
                        <h2 style="font-size:28px; color:#2c3e50; margin:5px 0;">${completedCourses}</h2>
                    </div>
                </div>

                <div class="card">
                    <h3 style="margin-top:0;">📈 Course Uptake & Performance</h3>
                    <table>
                        <thead>
                            <tr>
                                <th>Course Name</th>
                                <th>Total Enrollment</th>
                                <th>Average Completion</th>
                            </tr>
                        </thead>
                        <tbody>${uptakeRows}</tbody>
                    </table>
                </div>

                <div class="card" style="overflow-x:auto;">
                    <h3 style="margin-top:0;">👨‍🎓 Student Roster & Delivery Logs</h3>
                    <table>
                        <thead>
                            <tr>
                                <th>Student</th>
                                <th>Enrolled Course</th>
                                <th>Progress</th>
                                <th>WhatsApp Delivery Status</th>
                                <th style="text-align:right;">Assessments</th> </tr>
                        </thead>
                        <tbody>${studentRows.length > 0 ? studentRows : '<tr><td colspan="5" style="text-align:center; color:#999; padding:20px;">No enrollments found.</td></tr>'}</tbody>
                    </table>
                </div>

                <div id="answersModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:1000; justify-content:center; align-items:center;">
                    <div style="background:white; width:90%; max-width:600px; border-radius:10px; padding:25px; box-shadow:0 10px 25px rgba(0,0,0,0.2); max-height:80vh; overflow-y:auto;">
                        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:15px; margin-bottom:15px;">
                            <h3 style="margin:0; color:#2c3e50;">Assessments: <span id="modalStudentName" style="color:#8e44ad;"></span></h3>
                            <button onclick="closeAnswersModal()" style="background:none; border:none; font-size:24px; cursor:pointer; color:#7f8c8d;">&times;</button>
                        </div>
                        <div id="modalAnswersContent">
                            <p style="text-align:center; color:#7f8c8d;">Loading answers...</p>
                        </div>
                    </div>
                </div>

                <script>
                    function closeAnswersModal() {
                        document.getElementById('answersModal').style.display = 'none';
                    }

                    async function viewAnswers(enrollmentId, studentName) {
                        document.getElementById('modalStudentName').innerText = studentName;
                        document.getElementById('modalAnswersContent').innerHTML = '<p style="text-align:center; color:#7f8c8d;">Loading answers from database...</p>';
                        document.getElementById('answersModal').style.display = 'flex';

                        try {
                            const currentPath = window.location.pathname.replace(/\\/$/, ""); 
                            const fetchUrl = currentPath + '/answers/' + enrollmentId;
                            
                            const res = await fetch(fetchUrl);
                            const data = await res.json();
                            
                            if (data.answers.length === 0) {
                                document.getElementById('modalAnswersContent').innerHTML = '<p style="text-align:center; color:#95a5a6; padding:20px;">No quiz answers submitted yet.</p>';
                                return;
                            }

                            let html = '';
                            data.answers.forEach(ans => {
                                const statusColor = ans.isCorrect ? '#27ae60' : '#e74c3c';
                                const statusIcon = ans.isCorrect ? '✅ Correct' : '❌ Incorrect';
                                
                                html += \`
                                    <div style="background:#f8f9fa; border-left:4px solid \${statusColor}; padding:15px; margin-bottom:10px; border-radius:4px;">
                                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                            <span style="font-size:11px; color:#7f8c8d; font-weight:bold; text-transform:uppercase;">Module \${ans.lessonNumber}</span>
                                            <span style="font-size:11px; color:\${statusColor}; font-weight:bold;">\${statusIcon}</span>
                                        </div>
                                        <div style="font-weight:bold; margin-bottom:5px; color:#2c3e50;">Q: \${ans.questionText}</div>
                                        <div style="color:#555;"><strong>A:</strong> \${ans.studentResponse}</div>
                                        <div style="font-size:10px; color:#aaa; margin-top:8px; text-align:right;">Submitted: \${new Date(ans.submittedAt).toLocaleString()}</div>
                                    </div>
                                \`;
                            });
                            document.getElementById('modalAnswersContent').innerHTML = html;

                        } catch (error) {
                            document.getElementById('modalAnswersContent').innerHTML = '<p style="color:red; text-align:center;">⚠️ Connection Error Loading Answers.</p>';
                        }
                    }
                </script>
            `;

            res.send(renderPage(req.org, 'academy', content));

        } catch (error) {
            console.error("LMS Dashboard Error:", error);
            res.send(renderPage(req.org, 'academy', '<div class="card" style="color:red; font-weight:bold;">System Error Loading Academy Dashboard. Check Server Logs.</div>'));
        }
    });
	
	// ==========================================
    // 📝 API: FETCH STUDENT ANSWERS
    // ==========================================
    router.get('/admin/:code/academy/answers/:enrollmentId', checkSession, async (req, res) => {
        try {
            // Fetch the logs and include the related Module to get the Question text
            const logs = await prisma.assessmentLog.findMany({
                where: { enrollmentId: parseInt(req.params.enrollmentId) },
                include: { module: true },
                orderBy: { createdAt: 'desc' }
            });
            
            // Format the data for the frontend modal
            const answers = logs.map(log => ({
                submittedAt: log.createdAt,
                lessonNumber: log.module.order,
                questionText: log.module.quizQuestion || 'Assessment',
                studentResponse: log.response,
                isCorrect: log.isCorrect
            }));

            res.json({ success: true, answers });
        } catch (error) {
            console.error("Fetch Answers Error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch answers." });
        }
    });
	
    // ============================================================
    // 📅 ORGANIZATION EVENTS MANAGEMENT
    // ============================================================
    router.get('/admin/:code/events', checkSession, async (req, res) => {
        try {
            const events = await prisma.event.findMany({
                where: { churchCode: req.org.code },
                orderBy: { id: 'desc' }
            });

            const rows = events.map(e => `
                <tr>
                    <td><b>${e.name}</b><br><span style="font-size:11px; color:#888;">${e.date}</span></td>
                    <td>R${e.price}</td>
                    <td><span class="badge" style="background:#27ae60;">${e.status}</span></td>
                    <td style="text-align:right;">
                        <form method="POST" action="/admin/${req.org.code}/events/delete" style="display:inline;">
                            <input type="hidden" name="eventId" value="${e.id}">
                            <button class="btn-del" onclick="return confirm('Delete this event?');">Delete</button>
                        </form>
                    </td>
                </tr>
            `).join('');

            const content = `
                <div class="card" style="display:flex; justify-content:space-between; align-items:center; background:#1e272e; color:white;">
                    <div>
                        <h2 style="margin:0; color:#00d2d3;">📅 Event Management</h2>
                        <p style="margin:0; margin-top:5px; font-size:13px; color:#b2bec3;">Create and manage ticketing for your church events.</p>
                    </div>
                </div>

                <div class="card">
                    <h3 style="margin-top:0;">Add New Event</h3>
                    <form method="POST" action="/admin/${req.org.code}/events/add" style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; background:#f8f9fa; padding:15px; border-radius:6px;">
                        <div>
                            <label>Event Name</label>
                            <input name="name" required placeholder="e.g. Easter Conference">
                        </div>
                        <div>
                            <label>Date & Time String</label>
                            <input name="date" required placeholder="e.g. 12 April 2024, 09:00 AM">
                        </div>
                        <div>
                            <label>Ticket Price (R)</label>
                            <input type="number" name="price" required placeholder="150" value="0">
                        </div>
                        <div>
                            <label>Expiry Date</label>
                            <input type="date" name="expiryDate" required>
                        </div>
                        <div style="grid-column: span 2;">
                            <button class="btn" style="background:#0984e3; width:100%;">Create Event</button>
                        </div>
                    </form>
                </div>

                <div class="card">
                    <h3 style="margin:0 0 15px 0;">Active Events (${events.length})</h3>
                    <table>
                        <thead>
                            <tr>
                                <th>Event Details</th>
                                <th>Price</th>
                                <th>Status</th>
                                <th style="text-align:right;">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${events.length > 0 ? rows : '<tr><td colspan="4" style="text-align:center; padding:30px; color:#999;">No events created yet.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            `;

            res.send(renderPage(req.org, 'events', content));
        } catch (error) {
            console.error(error);
            res.send(renderPage(req.org, 'events', `<div class="card" style="color:red;">Error loading events.</div>`));
        }
    });

    router.post('/admin/:code/events/add', checkSession, async (req, res) => {
        try {
            await prisma.event.create({
                data: {
                    name: req.body.name,
                    date: req.body.date,
                    price: parseFloat(req.body.price),
                    churchCode: req.org.code,
                    status: 'Active',
                    expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : null
                }
            });
        } catch (e) {
            console.error("Add event error:", e);
        }
        res.redirect(`/admin/${req.org.code}/events`);
    });

    router.post('/admin/:code/events/delete', checkSession, async (req, res) => {
        try {
            await prisma.event.delete({
                where: { id: parseInt(req.body.eventId) }
            });
        } catch (e) {
            console.error("Delete event error:", e);
        }
        res.redirect(`/admin/${req.org.code}/events`);
    });

    // --- 💰 REVENUE RECOVERY (UI) ---
    router.get('/admin/:code/collections', checkSession, async (req, res) => {
        const debts = await prisma.collection.findMany({ 
            where: { churchCode: req.org.code },
            orderBy: { id: 'desc' }
        });

        const total = debts.reduce((sum, d) => sum + d.amount, 0);
        const pending = debts.filter(d => d.status === 'PENDING').length;

        const content = `
            <div class="card" style="display:flex; justify-content:space-between; align-items:center; background:#2d3436; color:white;">
                <div>
                    <h2 style="margin:0; color:#00d2d3;">Revenue Recovery</h2>
                    <p style="margin:0; margin-top:5px; font-size:13px; color:#b2bec3;">Automate outstanding invoice collection via WhatsApp.</p>
                </div>
                <div style="text-align:right;">
                    <p style="margin:0; font-size:12px; text-transform:uppercase; color:#b2bec3;">Total Outstanding</p>
                    <h2 style="margin:0; font-size:28px;">R${total.toLocaleString()}</h2>
                </div>
            </div>

            <div class="card">
                <h3 style="margin-top:0;">1. Upload Debtor CSV</h3>
                <form method="POST" action="/admin/${req.org.code}/collections/upload" enctype="multipart/form-data" style="background:#f8f9fa; padding:15px; border-radius:6px; display:flex; gap:10px; align-items:center;">
                    <input type="file" name="file" accept=".csv" required style="margin:0; background:white; flex:1;">
                    <button class="btn" style="width:auto; background:#0984e3;">Upload Data</button>
                </form>
                <small style="color:#666; display:block; margin-top:10px;">Required columns: Name, Phone, Amount, Reference</small>
            </div>

            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h3 style="margin:0;">2. Campaign Queue (${pending} Pending)</h3>
                    ${pending > 0 ? `<form method="POST" action="/api/crm/collections/blast/${req.org.code}" style="margin:0;"><button class="btn" style="width:auto; background:#d63031; padding:10px 20px;">🚀 LAUNCH CAMPAIGN</button></form>` : '<span style="color:#999; font-size:13px;">Queue is empty</span>'}
                </div>
                <hr style="margin:15px 0; border:0; border-top:1px solid #eee;">
                <table>
                    <thead>
                        <tr>
                            <th>Debtor / Ref</th>
                            <th>Phone</th>
                            <th>Amount</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                        <tbody>
                            ${debts.length > 0 ? debts.map(d => {
                                let badgeColor = '#27ae60'; 
                                if (d.status === 'PENDING') badgeColor = '#e67e22'; 
                                if (d.status === 'REMINDER_1') badgeColor = '#f39c12'; 
                                if (d.status === 'PROMISE_TO_PAY') badgeColor = '#0984e3'; 
                                if (d.status === 'DISPUTED') badgeColor = '#d63031'; 
                                if (d.status === 'FINAL_NOTICE') badgeColor = '#2d3436'; 
                                
                                return `
                                <tr>
                                    <td><b>${d.firstName}</b><br><span style="font-size:11px; color:#888;">Ref: ${d.reference}</span></td>
                                    <td>${d.phone}</td>
                                    <td><b>R${d.amount.toFixed(2)}</b></td>
                                    <td><span class="badge" style="background:${badgeColor}; padding:5px 8px;">${d.status.replace(/_/g, ' ')}</span></td>
                                </tr>`;
                            }).join('') : '<tr><td colspan="4" style="text-align:center; padding:30px; color:#999;">No active debtors found. Upload a CSV to begin.</td></tr>'}
                        </tbody>
                </table>
            </div>
        `;

        res.send(renderPage(req.org, 'collections', content));
    });
    
    // --- ⚰️ SUREPOL (BURIAL ADMIN UI) ---
    router.get('/admin/:code/surepol', checkSession, async (req, res) => {
        const pendingClaims = await prisma.claim.findMany({
            where: {
                churchCode: req.org.code,
                status: {
                    in: ['MANUAL_REVIEW_NEEDED', 'FLAGGED_WAITING_PERIOD', 'PENDING_REVIEW', 'PENDING_DOCUMENTATION']
                }
            },
            include: { member: true }, 
            orderBy: { id: 'desc' }
        });

        let claimsHtml = '';
        if (pendingClaims.length === 0) {
            claimsHtml = '<tr><td colspan="5" style="text-align:center; padding:30px; color:#999;">🎉 Queue is empty! No pending claims to review.</td></tr>';
        } else {
            claimsHtml = pendingClaims.map(c => {
                let badgeColor = '#f39c12';
                if (c.status === 'FLAGGED_WAITING_PERIOD') badgeColor = '#e74c3c';
                if (c.status === 'PENDING_REVIEW') badgeColor = '#3498db';
                if (c.status === 'MANUAL_REVIEW_NEEDED') badgeColor = '#e67e22';
                
                const docLink = c.documentUrl 
                    ? `<a href="${c.documentUrl}" target="_blank" style="background:#ecf0f1; padding:5px 10px; border-radius:4px; font-size:12px; font-weight:bold;">🖼️ View Doc</a>` 
                    : '<span style="color:#999; font-size:12px;">No Doc</span>';
                
                const displayPhone = c.claimantPhone || (c.member ? c.member.phone : 'Unknown');

                return `
                <tr style="background: ${c.status === 'MANUAL_REVIEW_NEEDED' ? '#fffbeb' : 'transparent'};">
                    <td><b>${c.deceasedIdNumber === 'UNREADABLE' ? '⚠️ UNREADABLE' : c.deceasedIdNumber}</b><br><span style="font-size:11px; color:#888;">Claimant: ${displayPhone}</span></td>
                    <td>${new Date(c.dateOfDeath).toLocaleDateString()}</td>
                    <td>
                        <span class="badge" style="background:${badgeColor}; padding:5px 8px;">${c.status.replace(/_/g, ' ')}</span>
                        <div style="font-size:11px; color:#555; margin-top:5px; max-width:250px;">${c.adminNotes || ''}</div>
                    </td>
                    <td>${docLink}</td>
                    <td><button class="btn" style="width:auto; padding:6px 12px; font-size:12px; background:#e67e22; border:none; color:white;" onclick="manualOverride(${c.id})">⚠️ Override</button></td>
                </tr>`;
            }).join('');
        }

        const content = `
            <div class="card" style="background:#1e272e; color:white;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <h2 style="margin:0; color:#00d2d3;">Surepol Burial Administration</h2>
                        <p style="margin:5px 0 0 0; font-size:13px; color:#b2bec3;">Manage policyholders, dependents, and verify claims.</p>
                    </div>
                </div>
            </div>

            <div class="card" style="border-left: 4px solid #e67e22;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <h3 style="margin:0; color:#d35400;">📑 Action Required: Pending Claims</h3>
                    <span class="badge" style="background:#e67e22; font-size:14px;">${pendingClaims.length} Pending</span>
                </div>
                <div style="overflow-x:auto;">
                    <table>
                        <thead>
                            <tr>
                                <th>Deceased ID / Claimant</th>
                                <th>Date of Death</th>
                                <th>Status / AI Notes</th>
                                <th>Document</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${claimsHtml}
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <h3 style="margin:0;">🔍 Policy Search</h3>
                    <button class="btn" style="width:auto; background:#27ae60;" onclick="document.getElementById('addPolicyModal').style.display='flex'">+ Add New Policy</button>
                </div>
                
                <div style="display:flex; gap:10px; margin-bottom:20px;">
                    <input type="text" id="searchIdInput" placeholder="Enter 13-digit SA ID Number..." style="margin:0; flex:1;">
                    <button id="searchMemberBtn" class="btn" style="width:auto; background:#0984e3;">Search</button>
                </div>

                <div id="policyResultArea"></div>
            </div>
            
            <div id="addPolicyModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:1000; justify-content:center; align-items:center;">
                <div style="background:white; width:90%; max-width:600px; border-radius:10px; padding:20px; max-height:90vh; overflow-y:auto;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                        <h3 style="margin:0;">Add New Surepol Policy</h3>
                        <button onclick="document.getElementById('addPolicyModal').style.display='none'" style="background:none; border:none; font-size:20px; cursor:pointer;">&times;</button>
                    </div>

                    <form id="newPolicyForm">
                        <h4 style="margin:0 0 10px 0; color:#7f8c8d; border-bottom:1px solid #eee; padding-bottom:5px;">Main Member Details</h4>
                        <div style="display:flex; gap:10px;">
                            <input type="text" id="pmFirstName" placeholder="First Name" required style="flex:1;">
                            <input type="text" id="pmLastName" placeholder="Surname" required style="flex:1;">
                        </div>
                        <div style="display:flex; gap:10px;">
                            <input type="text" id="pmIdNumber" placeholder="13-Digit SA ID Number" required style="flex:1;">
                            <input type="text" id="pmPhone" placeholder="Phone (e.g. 082...)" required style="flex:1;">
                        </div>

                        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:20px;">
                            <h4 style="margin:0; color:#7f8c8d;">Covered Dependents</h4>
                            <button type="button" id="addDependentBtn" class="btn-del" style="background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd;">+ Add Dependent</button>
                        </div>
                        <hr style="margin:10px 0; border:0; border-top:1px solid #eee;">
                        
                        <div id="dependentsContainer"></div>

                        <div id="formErrorMsg" style="color:#d63031; margin-top:10px; font-weight:bold; display:none;"></div>

                        <button type="submit" id="savePolicyBtn" class="btn" style="background:#27ae60; margin-top:20px;">Save Policy & Start Waiting Period</button>
                    </form>
                </div>
            </div>

            <div id="logPaymentModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:1000; justify-content:center; align-items:center;">
                <div style="background:white; width:90%; max-width:400px; border-radius:10px; padding:20px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                        <h3 style="margin:0;">Log Premium Payment</h3>
                        <button onclick="document.getElementById('logPaymentModal').style.display='none'" style="background:none; border:none; font-size:20px; cursor:pointer;">&times;</button>
                    </div>

                    <form id="paymentForm">
                        <p style="margin-top:0; color:#555; font-size:14px;">Receiving payment for: <strong id="payeeNameDisplay"></strong></p>
                        
                        <input type="hidden" id="payeePhone">
                        
                        <label>Amount (ZAR)</label>
                        <input type="number" id="payAmount" placeholder="e.g. 150" required style="width:100%; padding:10px; margin-bottom:15px;">

                        <label>Payment Method</label>
                        <select id="payMethod" style="width:100%; padding:10px; margin-bottom:15px;">
                            <option value="CASH">Cash</option>
                            <option value="EFT">EFT / Bank Transfer</option>
                            <option value="CARD">Card Swipe</option>
                        </select>

                        <label>Reference (Optional)</label>
                        <input type="text" id="payReference" placeholder="Receipt or Trace ID" style="width:100%; padding:10px; margin-bottom:15px;">

                        <div id="payErrorMsg" style="color:#d63031; margin-bottom:10px; font-weight:bold; display:none;"></div>

                        <button type="submit" id="savePaymentBtn" class="btn" style="background:#27ae60; width:100%;">Confirm Payment</button>
                    </form>
                </div>
            </div>

            <div id="logClaimModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:1000; justify-content:center; align-items:center;">
                <div style="background:white; width:90%; max-width:450px; border-radius:10px; padding:20px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                        <h3 style="margin:0; color:#c0392b;">Log Death Claim</h3>
                        <button onclick="document.getElementById('logClaimModal').style.display='none'" style="background:none; border:none; font-size:20px; cursor:pointer;">&times;</button>
                    </div>

                    <form id="claimForm">
                        <div style="background:#f0f9ff; border:1px dashed #bae6fd; padding:15px; border-radius:8px; margin-bottom:20px; text-align:center;">
                            <label style="color:#0369a1;">Upload Death Certificate / DHA-1663</label>
                            <input type="file" id="claimDocument" accept="image/*,.pdf" style="width:100%; margin:10px 0; background:white;">
                            <button type="button" id="aiExtractBtn" class="btn" style="background:#0284c7; width:100%; font-size:13px;">
                                ✨ Auto-Fill with AI
                            </button>
                            <div id="aiStatus" style="font-size:12px; color:#555; margin-top:5px; font-style:italic;"></div>
                        </div>

                        <input type="hidden" id="vaultUrl"> <label>ID Number of Deceased</label>
                        <input type="text" id="claimIdNumber" placeholder="13-Digit SA ID" required style="width:100%; padding:10px; margin-bottom:15px;">

                        <label>Date of Death</label>
                        <input type="date" id="claimDate" required style="width:100%; padding:10px; margin-bottom:15px;">

                        <label>Cause of Death</label>
                        <select id="claimCause" style="width:100%; padding:10px; margin-bottom:15px;">
                            <option value="NATURAL">Natural Causes</option>
                            <option value="UNNATURAL">Accidental / Unnatural</option>
                        </select>
                        
                        <label>Claimant Phone</label>
                        <input type="text" id="claimantPhone" placeholder="082..." required style="width:100%; padding:10px; margin-bottom:15px;">

                        <div id="claimErrorMsg" style="color:#d63031; margin-bottom:10px; font-weight:bold; display:none;"></div>

                        <button type="submit" id="saveClaimBtn" class="btn" style="background:#e74c3c; width:100%;">Verify & Log Claim</button>
                    </form>
                </div>
            </div>

            <script>
                // The Override Logic
                async function manualOverride(claimId) {
                    const manualId = prompt("Enter the exact ID Number from the Death Certificate:");
                    
                    if (!manualId || manualId.trim() === "") {
                        alert("Override cancelled. ID number is required.");
                        return;
                    }

                    if (confirm(\`Force approve this claim with ID: \${manualId}?\`)) {
                        try {
                            const res = await fetch(\`/api/crm/claims/${req.org.code}/override\`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ claimId: claimId, manualIdNumber: manualId.trim() })
                            });
                            
                            const result = await res.json();
                            if (result.success) {
                                alert("✅ " + result.message);
                                location.reload(); // Refresh to see the new Approved status
                            } else {
                                alert("❌ Failed: " + result.error);
                            }
                        } catch (e) {
                            alert("Network error.");
                        }
                    }
                }
                document.getElementById('searchMemberBtn').addEventListener('click', async () => {
                    const btn = document.getElementById('searchMemberBtn');
                    const input = document.getElementById('searchIdInput');
                    const resultArea = document.getElementById('policyResultArea');
                    const idNumber = input.value.trim();

                    if (!idNumber) {
                        resultArea.innerHTML = '<div style="padding:15px; background:#fee2e2; color:#991b1b; border-radius:5px;">Please enter an ID number.</div>';
                        return;
                    }

                    btn.innerText = "Searching...";
                    resultArea.innerHTML = ""; 

                    try {
                        const response = await fetch('/api/surepol/members/search?idNumber=' + idNumber);
                        const data = await response.json();

                        if (!response.ok) throw new Error(data.error || "Policy not found.");

                        const isWaiting = data.policyStatus.waitingPeriod.isActive;
                        const headerBg = isWaiting ? "#ffedd5" : "#dcfce7"; 
                        const headerColor = isWaiting ? "#9a3412" : "#166534";

                        // Format Dependents List
                        let depsHtml = "<p style='color:#7f8c8d; font-style:italic; font-size:13px;'>No dependents registered.</p>";
                        if (data.memberData.dependents && data.memberData.dependents.length > 0) {
                            depsHtml = data.memberData.dependents.map(dep => 
                                '<div style="background:#f1f2f6; padding:8px 12px; margin-bottom:5px; border-radius:4px; display:flex; justify-content:space-between;">' +
                                    '<strong>' + dep.firstName + ' ' + dep.lastName + '</strong>' +
                                    '<span class="badge" style="background:#bdc3c7; color:#333;">' + dep.relation + '</span>' +
                                '</div>'
                            ).join('');
                        }

                        // Paint the Results Card
                        resultArea.innerHTML = 
                            '<div style="border:1px solid #dfe4ea; border-radius:8px; overflow:hidden; margin-top:20px;">' +
                                '<div style="background:' + headerBg + '; color:' + headerColor + '; padding:15px; font-weight:bold; border-bottom:1px solid #dfe4ea;">' +
                                    data.policyStatus.waitingPeriod.adminMessage +
                                '</div>' +
                                '<div style="padding:20px; display:flex; gap:20px; flex-wrap:wrap;">' +
                                    
                                    '<div style="flex:1; min-width:250px;">' +
                                        '<h4 style="color:#7f8c8d; margin:0 0 10px 0; font-size:11px; text-transform:uppercase;">Main Member</h4>' +
                                        '<h2 style="margin:0 0 5px 0;">' + data.memberData.firstName + ' ' + data.memberData.lastName + '</h2>' +
                                        '<p style="margin:0 0 5px 0; font-size:14px;"><strong>ID:</strong> ' + data.memberData.idNumber + '</p>' +
                                        '<p style="margin:0 0 15px 0; font-size:14px;"><strong>Phone:</strong> ' + data.memberData.phone + '</p>' +
                                        '<span class="badge" style="background:#3498db; font-size:12px; padding:6px 10px;">Status: ' + data.policyStatus.accountStatus + '</span>' +
                                        '<div style="margin-top:15px; display:flex; gap:10px;">' +
                                            '<button class="btn" style="flex:1; background:#2ecc71; padding:8px 15px;" onclick="openPaymentModal(\\'' + data.memberData.phone + '\\', \\'' + data.memberData.firstName + '\\')">💰 Log Payment</button>' +
                                            '<button class="btn" style="flex:1; background:#e74c3c; padding:8px 15px;" onclick="document.getElementById(\\'logClaimModal\\').style.display=\\'flex\\'">📑 Log Death Claim</button>' +
                                        '</div>' +
                                    '</div>' +

                                    '<div style="flex:1; min-width:250px; border-left:1px solid #eee; padding-left:20px;">' +
                                        '<h4 style="color:#7f8c8d; margin:0 0 10px 0; font-size:11px; text-transform:uppercase;">Covered Dependents</h4>' +
                                        depsHtml +
                                    '</div>' +

                                '</div>' +
                            '</div>';

                    } catch (error) {
                        resultArea.innerHTML = '<div style="padding:15px; background:#fee2e2; border-left:4px solid #e74c3c; color:#c0392b; font-weight:bold; border-radius:0 5px 5px 0;">' + error.message + '</div>';
                    } finally {
                        btn.innerText = "Search";
                    }
                });

                // --- LOG PAYMENT LOGIC ---
                window.openPaymentModal = function(phone, name) {
                    document.getElementById('payeeNameDisplay').innerText = name;
                    document.getElementById('payeePhone').value = phone;
                    document.getElementById('logPaymentModal').style.display = 'flex';
                };

                document.getElementById('paymentForm').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const btn = document.getElementById('savePaymentBtn');
                    const errorBox = document.getElementById('payErrorMsg');
                    
                    btn.innerText = "Processing...";
                    errorBox.style.display = "none";

                    const payload = {
                        phone: document.getElementById('payeePhone').value,
                        amount: document.getElementById('payAmount').value,
                        paymentMethod: document.getElementById('payMethod').value,
                        reference: document.getElementById('payReference').value || ('CASH-' + Math.floor(Math.random() * 10000))
                    };

                    try {
                        const response = await fetch('/api/surepol/payments', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        
                        const data = await response.json();
                        if (!response.ok) throw new Error(data.error || "Failed to log payment.");

                        document.getElementById('logPaymentModal').style.display = 'none';
                        document.getElementById('paymentForm').reset();
                        
                        alert("✅ Payment of R" + payload.amount + " logged successfully!");
                        document.getElementById('searchMemberBtn').click(); 

                    } catch (error) {
                        errorBox.innerText = error.message;
                        errorBox.style.display = "block";
                    } finally {
                        btn.innerText = "Confirm Payment";
                    }
                });

                // --- ADD NEW POLICY LOGIC ---
                const depsContainer = document.getElementById('dependentsContainer');
                
                document.getElementById('addDependentBtn').addEventListener('click', () => {
                    const div = document.createElement('div');
                    div.style.cssText = "display:flex; gap:5px; margin-bottom:10px; background:#f8f9fa; padding:10px; border-radius:5px;";
                    div.innerHTML = 
                        '<input type="text" class="dep-fname" placeholder="First Name" required style="margin:0; flex:1; padding:8px;">' +
                        '<input type="text" class="dep-lname" placeholder="Surname" required style="margin:0; flex:1; padding:8px;">' +
                        '<input type="date" class="dep-dob" required style="margin:0; flex:1; padding:8px;">' +
                        '<select class="dep-rel" style="margin:0; flex:1; padding:8px;">' +
                            '<option value="SPOUSE">Spouse</option>' +
                            '<option value="CHILD">Child</option>' +
                            '<option value="EXTENDED">Extended Family</option>' +
                        '</select>' +
                        '<button type="button" onclick="this.parentElement.remove()">X</button>';
                    depsContainer.appendChild(div);
                });

                document.getElementById('newPolicyForm').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const btn = document.getElementById('savePolicyBtn');
                    const errorBox = document.getElementById('formErrorMsg');
                    
                    btn.innerText = "Saving...";
                    errorBox.style.display = "none";

                    const dependents = [];
                    const depRows = depsContainer.children;
                    for (let i = 0; i < depRows.length; i++) {
                        dependents.push({
                            firstName: depRows[i].querySelector('.dep-fname').value.trim(),
                            lastName: depRows[i].querySelector('.dep-lname').value.trim(),
                            dateOfBirth: depRows[i].querySelector('.dep-dob').value,
                            relation: depRows[i].querySelector('.dep-rel').value
                        });
                    }

                    const payload = {
                        firstName: document.getElementById('pmFirstName').value.trim(),
                        lastName: document.getElementById('pmLastName').value.trim(),
                        idNumber: document.getElementById('pmIdNumber').value.trim(),
                        phone: document.getElementById('pmPhone').value.trim(),
                        churchCode: "${req.org.code}", 
                        dependents: dependents
                    };

                    try {
                        const response = await fetch('/api/surepol/members', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        
                        const data = await response.json();
                        
                        if (!response.ok) throw new Error(data.error || "Failed to save policy.");

                        document.getElementById('addPolicyModal').style.display = 'none';
                        document.getElementById('newPolicyForm').reset();
                        depsContainer.innerHTML = ''; 
                        alert("✅ Policy created successfully! 6-Month waiting period has begun.");

                    } catch (error) {
                        errorBox.innerText = error.message;
                        errorBox.style.display = "block";
                    } finally {
                        btn.innerText = "Save Policy & Start Waiting Period";
                    }
                });
                
                // --- ✨ AI DOCUMENT EXTRACTION LOGIC ---
                document.getElementById('aiExtractBtn').addEventListener('click', async () => {
                    const fileInput = document.getElementById('claimDocument');
                    const statusText = document.getElementById('aiStatus');
                    
                    if (!fileInput.files[0]) {
                        alert("Please select a document image first.");
                        return;
                    }

                    statusText.innerText = "Processing document with AI... ⏳";
                    statusText.style.color = "#d97706";
                    document.getElementById('aiExtractBtn').disabled = true;

                    const formData = new FormData();
                    formData.append('document', fileInput.files[0]);

                    try {
                        const response = await fetch('/api/surepol/claims/extract-ocr', {
                            method: 'POST',
                            body: formData
                        });
                        
                        const result = await response.json();
                        if (!response.ok) throw new Error(result.error);

                        const ai = result.extractedData;
                        if (ai.deceasedIdNumber) document.getElementById('claimIdNumber').value = ai.deceasedIdNumber;
                        if (ai.dateOfDeath) document.getElementById('claimDate').value = ai.dateOfDeath;
                        if (ai.causeOfDeath) document.getElementById('claimCause').value = ai.causeOfDeath;
                        
                        document.getElementById('vaultUrl').value = result.vaultUrl;

                        statusText.innerText = '✅ AI Confidence: ' + (ai.confidenceScore || 'High') + '% (' + (ai.documentType || 'Doc') + ')';
                        statusText.style.color = "#16a34a";

                    } catch (error) {
                        statusText.innerText = "❌ AI Extraction failed: " + error.message;
                        statusText.style.color = "#dc2626";
                    } finally {
                        document.getElementById('aiExtractBtn').disabled = false;
                    }
                });
                
                document.getElementById('claimForm').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const btn = document.getElementById('saveClaimBtn');
                    const errorBox = document.getElementById('claimErrorMsg');
                    
                    btn.innerText = "Verifying Waiting Period...";
                    errorBox.style.display = "none";

                    const payload = {
                        deceasedIdNumber: document.getElementById('claimIdNumber').value.trim(),
                        dateOfDeath: document.getElementById('claimDate').value,
                        causeOfDeath: document.getElementById('claimCause').value,
                        claimantPhone: document.getElementById('claimantPhone').value.trim()
                    };

                    try {
                        const response = await fetch('/api/surepol/claims', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        
                        const data = await response.json();
                        
                        if (!response.ok) throw new Error(data.error || "Failed to log claim.");

                        document.getElementById('logClaimModal').style.display = 'none';
                        document.getElementById('claimForm').reset();
                        
                        alert("⚠️ Claim logged successfully. Awaiting official Home Affairs documentation (DHA-1663).");
                        document.getElementById('searchMemberBtn').click(); 

                    } catch (error) {
                        errorBox.innerText = error.message;
                        errorBox.style.display = "block";
                    } finally {
                        btn.innerText = "Verify & Submit Claim";
                    }
                });
            </script>
        `;

        res.send(renderPage(req.org, 'surepol', content));
    });

    // --- 👥 MEMBERS LIST ---
    router.get('/admin/:code/members', checkSession, async (req, res) => {
        const { q } = req.query;
        const members = await prisma.member.findMany({ 
            where: { churchCode: req.org.code, ...(q ? { OR: [{ phone: { contains: q } }, { lastName: { contains: q, mode: 'insensitive' } }] } : {}) },
            orderBy: { lastName: 'asc' } 
        });
        const rows = members.map(m => `<tr><td><a href="/admin/${req.org.code}/member/${m.id}"><b>${m.firstName} ${m.lastName}</b></a></td><td>${m.phone}</td></tr>`).join('');
        
        res.send(renderPage(req.org, 'members', `
            <div class="card">
                <div style="display:flex;gap:10px;justify-content:space-between;">
                    <form style="flex:1;display:flex;gap:5px;">
                        <input name="q" placeholder="Search name or phone..." value="${q || ''}">
                        <button class="btn" style="width:auto;">Search</button>
                    </form>
                </div>
                <hr style="margin:15px 0;border:0;border-top:1px solid #eee;">
                <form method="POST" action="/admin/${req.org.code}/members/upload" enctype="multipart/form-data" style="background:#f8f9fa;padding:15px;border-radius:5px;">
                    <label>📂 Bulk Import (CSV)</label>
                    <div style="display:flex;gap:10px;align-items:center;">
                        <input type="file" name="file" accept=".csv" required style="margin:0;background:white;">
                        <button class="btn" style="width:auto;background:#0984e3;">Upload</button>
                    </div>
                    <small style="color:#666;">Columns: Name, Surname, Phone</small>
                </form>
            </div>
            <div class="card">
                <h3>Member List (${members.length})</h3>
                <table>${rows}</table>
            </div>
        `));
    });

    // --- UPLOAD HANDLER (FIXED: Handling Last Name) ---
    router.post('/admin/:code/members/upload', checkSession, (req, res, next) => {
        upload.single('file')(req, res, (err) => { if (err) return res.send(err.message); next(); });
    }, async (req, res) => {
        const results = [];
        fs.createReadStream(req.file.path).pipe(csv()).on('data', (d) => results.push(d)).on('end', async () => {
            let added = 0;
            let errors = 0;
            for (const r of results) {
                // 1. Get Phone
                const phone = r.phone || r.Phone || r.mobile || r.Mobile || r['Phone Number'];
                
                // 2. Get First Name
                let firstName = r.firstName || r.Name || r['First Name'] || r.name || r.FirstName;
                
                // 3. Get Last Name (Or try to split the First Name if it has spaces)
                let lastName = r.lastName || r.Surname || r['Last Name'] || r.LastName || "";

                if (firstName && !lastName && firstName.trim().includes(' ')) {
                    const parts = firstName.trim().split(' ');
                    firstName = parts[0];
                    lastName = parts.slice(1).join(' '); // Use rest as last name
                }

                // 4. Fallback for Last Name (Database requires it)
                if (!lastName) lastName = "."; 

                if (phone && firstName) {
                    try { 
                        let cleanPhone = phone.replace(/\D/g, '');
                        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '27' + cleanPhone.substring(1);
                        
                        // 🚀 FIX: Upsert removed! Safely handles multi-tenant insertion
                        let existing = await prisma.member.findFirst({ where: { phone: cleanPhone, churchCode: req.org.code } });
                        if (existing) {
                            await prisma.member.update({ where: { id: existing.id }, data: { firstName: firstName, lastName: lastName } });
                        } else {
                            await prisma.member.create({
                                data: { firstName: firstName, lastName: lastName, phone: cleanPhone, churchCode: req.org.code, status: 'ACTIVE' }
                            });
                        }
                        added++;
                    } catch (e) { 
                        console.error("Import Error:", e.message); 
                        errors++;
                    }
                }
            }
            fs.unlinkSync(req.file.path);
            res.redirect(`/admin/${req.org.code}/members`);
        });
    });

    // --- 🛡️ TEAM ---
    router.get('/admin/:code/team', checkSession, async (req, res) => {
        try {
            const admins = await prisma.admin.findMany({ where: { churchId: req.org.id } });
            const rows = admins.map(a => `<tr><td>${a.name || 'Staff'}</td><td>${a.phone}</td></tr>`).join('');
            
            res.send(renderPage(req.org, 'team', `
                <div class="card">
                    <h3>Invite Team Member</h3>
                    <form method="POST" action="/admin/${req.org.code}/team/add" style="display:flex;gap:10px;flex-wrap:wrap;">
                        <input name="name" placeholder="Name (e.g. John)" required style="flex:1;">
                        <input name="phone" placeholder="Phone (e.g. +27...)" required style="flex:1;">
                        <button class="btn" style="width:auto;">Add Admin</button>
                    </form>
                </div>
                <div class="card"><table>${rows}</table></div>
            `));
        } catch (e) { res.send(renderPage(req.org, 'team', `<div class="card"><h3>Team</h3><p>Not available.</p></div>`)); }
    });

    router.post('/admin/:code/team/add', checkSession, async (req, res) => {
        try { 
            let p = req.body.phone.replace(/\D/g, '');
            if (p.length === 10 && p.startsWith('0')) p = '27' + p.substring(1);

            await prisma.admin.create({ 
                data: { 
                    name: req.body.name, 
                    phone: p, 
                    churchId: req.org.id, 
                    role: 'STAFF' 
                } 
            }); 
        } catch(e){ console.log(e); }
        res.redirect(`/admin/${req.org.code}/team`);
    });

    // --- 🕵️ VERIFICATIONS & ACTIONS ---
    router.get('/admin/:code/verifications', checkSession, async (req, res) => {
        const allMembers = await prisma.member.findMany({ 
            where: { churchCode: req.params.code.toUpperCase() },
            orderBy: { id: 'desc' }
        });
        
        // Find members who have uploaded documents but aren't verified yet
        const queue = allMembers.filter(m => (m.idPhotoUrl && !m.isIdVerified) || (m.kycToken === null && !m.isIdVerified && m.idNumber));
        
        const rows = queue.map(m => `
            <tr>
                <td><b>${m.firstName} ${m.lastName}</b><br><span style="font-size:11px; color:#7f8c8d;">${m.phone}</span></td>
                <td><span class="badge" style="background:#f39c12; padding:4px 8px;">Pending Review</span></td>
                <td style="text-align:right;">
                    <a href="/admin/${req.params.code}/member/${m.id}" class="btn" style="width:auto; padding:6px 12px; background:#0984e3;">Review Docs</a>
                </td>
            </tr>
        `).join('');

        res.send(renderPage(req.org, 'verifications', `
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h3 style="margin:0;">📂 KYC Verification Queue</h3>
                    <span class="badge" style="background:#e67e22; font-size:14px;">${queue.length} Pending</span>
                </div>
                <hr style="border:0; border-top:1px solid #eee; margin:15px 0;">
                <table>
                    <thead><tr><th>Member</th><th>Status</th><th style="text-align:right;">Action</th></tr></thead>
                    <tbody>${queue.length > 0 ? rows : '<tr><td colspan="3" style="text-align:center; padding:30px; color:#95a5a6;">🎉 Queue is empty! No documents to review.</td></tr>'}</tbody>
                </table>
            </div>
        `));
    });

    router.post('/admin/:code/verifications/action', checkSession, async (req, res) => {
        const { memberId, action, reason } = req.body;
        const member = await prisma.member.findUnique({ where: { id: parseInt(memberId) } });
        
        if (member) {
            // 🛠️ Phone Number Cleaner for Twilio (+27 format)
            let cleanPhone = member.phone.replace(/\D/g, '');
            if (cleanPhone.startsWith('0')) cleanPhone = '27' + cleanPhone.substring(1);

            if (action === 'approve') {
                // 🚀 FLIP THE SWITCH: Set isIdVerified AND status to ACTIVE
                await prisma.member.update({ 
                    where: { id: member.id }, 
                    data: { 
                        isIdVerified: true, 
                        verifiedAt: new Date(), 
                        rejectionReason: null,
                        status: 'ACTIVE' // <--- The magic key that activates the policy!
                    } 
                });
                
                try { 
                    await sendWhatsApp(cleanPhone, `✅ *KYC Approved & Policy Active!*\n\nHi ${member.firstName}, your documents have been successfully verified by ${req.org.name}.\n\nYour policy is now officially *ACTIVE*. You can reply with *Hi* at any time to view your policy details, check your waiting period, or make a payment.`); 
                } catch(e){ console.error(e.message); }
                
            } else {
                // Rejection Logic
                const rejectMsg = reason || "Documents were not clear or incomplete";
                await prisma.member.update({ 
                    where: { id: member.id }, 
                    data: { isIdVerified: false, rejectionReason: rejectMsg, status: 'PENDING_KYC' } 
                });
                
                try { 
                    await sendWhatsApp(cleanPhone, `❌ *KYC Verification Failed*\n\nHi ${member.firstName}, your recent document upload was rejected.\n\n*Reason:* ${rejectMsg}\n\nPlease reply directly to this message with clear photos of your ID and Proof of Address to try again.`); 
                } catch(e){ console.error(e.message); }
            }
        }
        res.redirect(`/admin/${req.org.code}/verifications`);
    });

    // --- 👤 MEMBER PROFILE & KYC REVIEW ---
    router.get('/admin/:code/member/:id', checkSession, async (req, res) => {
        const member = await prisma.member.findUnique({ where: { id: parseInt(req.params.id) } });
        if (!member) return res.send("Not Found");

        // 🛠️ Smarter Decryptor: Ignores URLs and legacy plain-text data
        const safeDecrypt = (data) => {
            if (!data) return null;
            
            // 🛑 STOP: If it's a web link, it's definitely not encrypted!
            if (typeof data === 'string' && data.startsWith('http')) {
                return data;
            }

            // Otherwise, if it has a colon and is long, try to decrypt
            if (typeof data === 'string' && data.includes(':') && data.length > 30) {
                try { return decrypt ? decrypt(data) : data; } catch (e) { return data; }
            }
            return data; 
        };

        const idNum = safeDecrypt(member.idNumber) || 'Not Provided';
        const address = safeDecrypt(member.address) || 'Not Provided';
        let idPhoto = safeDecrypt(member.idPhotoUrl);
        let addressPhoto = safeDecrypt(member.proofOfAddressUrl);

        if (idPhoto && idPhoto.startsWith('http:')) idPhoto = idPhoto.replace('http:', 'https:');
        if (addressPhoto && addressPhoto.startsWith('http:')) addressPhoto = addressPhoto.replace('http:', 'https:');

        const renderDoc = (url, title) => {
            if (!url) return `<div style="padding:15px; background:#f9f9f9; border:1px dashed #ccc; text-align:center; color:#999; border-radius:8px; margin-bottom:15px;">No ${title} Uploaded</div>`;
            if (url.endsWith('.pdf')) {
                return `<div style="margin-bottom:15px; background:#eef2f5; padding:15px; border-radius:8px; border:1px solid #ddd;"><strong style="display:block; margin-bottom:10px;">📄 ${title} (PDF)</strong><a href="${url}" target="_blank" class="btn" style="background:#3498db; width:auto;">Open PDF Document</a></div>`;
            }
            return `<div style="margin-bottom:15px;"><strong style="display:block; margin-bottom:5px; color:#2c3e50;">📸 ${title}</strong><a href="${url}" target="_blank"><img src="${url}" style="max-width:100%; border-radius:8px; border:1px solid #ddd; box-shadow:0 2px 5px rgba(0,0,0,0.1);"></a></div>`;
        };

        res.send(renderPage(req.org, 'members', `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <a href="/admin/${req.params.code}/members" style="color:#7f8c8d; text-decoration:none; font-weight:bold;">← Back to Members</a>
                ${member.isIdVerified ? '<span class="badge" style="background:#27ae60; padding:6px 12px; font-size:14px;">✅ Fully Verified</span>' : '<span class="badge" style="background:#f39c12; padding:6px 12px; font-size:14px;">Pending Review</span>'}
            </div>

            <div class="card" style="border-top: 4px solid #00d2d3;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <h2 style="margin:0;">${member.firstName} ${member.lastName}</h2>
                    <button onclick="requestDebiCheck(${member.id})" class="btn" style="background:#f59e0b; width:auto; font-size:12px; padding:8px 15px; border:none;">
                        🔄 Request DebiCheck
                    </button>
                </div>

                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom:20px;">
                    <div style="background:#f8f9fa; padding:15px; border-radius:6px;">
                        <span style="font-size:11px; color:#7f8c8d; text-transform:uppercase;">Contact</span><br>
                        <strong>${member.phone}</strong>
                    </div>
                    <div style="background:#f8f9fa; padding:15px; border-radius:6px;">
                        <span style="font-size:11px; color:#7f8c8d; text-transform:uppercase;">ID Number (${member.idType || 'SA_ID'})</span><br>
                        <strong>${idNum}</strong>
                    </div>
                </div>

                <hr style="border:0; border-top:1px solid #eee; margin:20px 0;">
                <h3 style="color:#2c3e50;">Uploaded Documents</h3>
                ${renderDoc(idPhoto, 'ID / Passport Document')}
                ${renderDoc(addressPhoto, 'Proof of Address')}

                ${!member.isIdVerified ? `
                <div style="background:#fffbeb; border:1px solid #fde68a; padding:20px; border-radius:8px; margin-top:30px;">
                    <h3 style="margin-top:0; color:#b45309;">Review Decision</h3>
                    <form action="/admin/${req.params.code}/verifications/action" method="POST">
                        <input type="hidden" name="memberId" value="${member.id}">
                        <label style="color:#b45309;">Rejection Reason</label>
                        <textarea name="reason" placeholder="Blurry photo..." style="background:white; border-color:#fcd34d;"></textarea>
                        <div style="display:flex; gap:10px; margin-top:10px;">
                            <button name="action" value="approve" class="btn" style="flex:1; background:#27ae60;">✅ Approve KYC</button> 
                            <button name="action" value="reject" class="btn" style="flex:1; background:#e74c3c;">❌ Reject</button>
                        </div>
                    </form>
                </div>` : ''}
            </div>

            <script>
                async function requestDebiCheck(memberId) {
                    if(!confirm('Send a secure DebiCheck setup link via WhatsApp?')) return;
                    try {
                        const res = await fetch('/admin/${req.params.code}/request-mandate', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ memberId: memberId })
                        });
                        const data = await res.json();
                        alert(data.success ? '✅ ' + data.message : '❌ ' + data.error);
                    } catch (e) { alert('❌ Server Connection Error'); }
                }
            </script>
        `));
    });

    // --- 📄 PDF & SETTINGS ---
    router.get('/admin/:code/members/:phone/pdf', checkSession, async (req, res) => {
        // 🚀 FIX: findUnique crashes if phone is not unique. Using findFirst.
        const m = await prisma.member.findFirst({ where: { phone: req.params.phone, churchCode: req.org.code } }); 
        if (!m) return res.status(404).send("Member profile not found");

        const doc = new PDFDocument({ margin: 50 });
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="Statement_${m.firstName}_${m.lastName}.pdf"`);
        doc.pipe(res);

        try {
            if (req.org.logoUrl) { 
                const response = await fetch(req.org.logoUrl);
                const arrayBuffer = await response.arrayBuffer();
                const imageBuffer = Buffer.from(arrayBuffer);
                
                doc.image(imageBuffer, (doc.page.width - 100) / 2, 40, { width: 100 });
                doc.moveDown(5); 
            } else {
                doc.fontSize(22).text(`${req.org.name}`, { align: 'center' });
                doc.moveDown(1);
            }
        } catch (error) {
            console.error("PDF Logo Error:", error.message);
            doc.fontSize(22).text(`${req.org.name}`, { align: 'center' });
            doc.moveDown(1);
        }

        doc.fontSize(16).text(`Account Statement`, { align: 'center', underline: true });
        doc.moveDown(1);
        
        doc.fontSize(12).text(`Member: ${m.firstName} ${m.lastName}`);
        doc.text(`Phone: ${m.phone}`);
        doc.text(`ID Number: ${m.idNumber || 'N/A'}`);
        doc.text(`Date Issued: ${new Date().toLocaleDateString()}`);
        
        doc.moveDown(2);
        
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(1);

        doc.fontSize(14).text(`Account Status: Confirmed`, { align: 'center' });

        doc.end();
    });

    // 🎯 The Embedded Settings Tab
    router.get('/admin/:code/settings', checkSession, (req, res) => {
        const content = `
            <style>
                .container { max-width: 1000px !important; padding: 0 !important; }
            </style>
            <iframe 
                src="/crm/settings.html?code=${req.params.code}" 
                style="width: 100%; height: 85vh; border: none; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"
                title="Settings Vault"
            ></iframe>
        `;
        res.send(renderPage(req.org, 'settings', content));
    });
    
    // ==========================================
    // 📢 1. The Embedded Broadcasts Tab
    // ==========================================
    router.get('/admin/:code/broadcast', checkSession, (req, res) => {
        const content = `
            <style>
                .container { max-width: 1200px !important; padding: 0 !important; }
            </style>
            <iframe 
                src="/crm/broadcast.html?code=${req.params.code}" 
                style="width: 100%; height: 85vh; border: none; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"
                title="Broadcast Engine"
            ></iframe>
        `;
        res.send(renderPage(req.org, 'broadcast', content));
    });
	
	// ==========================================
    // 📢 2. API: Send WhatsApp Broadcast
    // ==========================================
    router.post('/api/crm/broadcast/:code', express.json(), async (req, res) => {
        try {
            const { message } = req.body;
            if (!message) return res.status(400).json({ success: false, error: "Message is required" });

            // 1. Get the org and ALL ACTIVE members (checking both relation types)
            const org = await prisma.church.findUnique({ 
                where: { code: req.params.code },
                include: { 
                    churchMembers: { where: { status: 'ACTIVE' } },
                    societyMembers: { where: { status: 'ACTIVE' } }
                } 
            });

            if (!org) return res.status(404).json({ success: false, error: "Organization not found" });
            
            // Combine them just in case the members are split across the two relations
            const activeMembers = [...(org.churchMembers || []), ...(org.societyMembers || [])];
            if (activeMembers.length === 0) {
                return res.status(400).json({ success: false, error: "No active members found to broadcast to." });
            }

            // 2. Log the Broadcast in the database using the "Ad" model
            await prisma.ad.create({
                data: {
                    content: message,
                    churchId: org.id,
                    status: 'Sent',
                    views: activeMembers.length, // Storing the recipient count here
                    expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days from now
                }
            });

            // 3. Blast the messages out! 🚀
            let successCount = 0;
            for (const member of activeMembers) {
                if (member.phone) {
                    const formattedMsg = `📢 *${org.name} Announcement*\n\n${message}\n\n_Reply 0 for menu._`;
                    // Fire off the WhatsApp message
                    await sendWhatsApp(member.phone, formattedMsg).catch(e => console.error(`Broadcast failed for ${member.phone}`));
                    successCount++;
                }
            }

            res.json({ success: true, message: `Broadcast successfully sent to ${successCount} members!` });
        } catch (error) {
            console.error("Broadcast Error:", error);
            res.status(500).json({ success: false, error: "Failed to send broadcast." });
        }
    });

    // ==========================================
    // 📢 3. API: Fetch Broadcast History
    // ==========================================
    router.get('/api/crm/broadcasts/:code', async (req, res) => {
        try {
            const org = await prisma.church.findUnique({ where: { code: req.params.code } });
            if (!org) return res.json({ success: true, history: [] });

            const history = await prisma.ad.findMany({
                where: { churchId: org.id },
                orderBy: { id: 'desc' },
                take: 10
            });
            res.json({ success: true, history });
        } catch (e) { 
            res.status(500).json({ success: false, error: e.message }); 
        }
    });
    
    // 🎯 The Embedded Claims Vault Tab
    router.get('/admin/:code/claims', checkSession, (req, res) => {
        const content = `
            <style>
                /* Expand the legacy container just for this tab so the new UI has room */
                .container { max-width: 1200px !important; padding: 0 !important; }
            </style>
            <iframe 
                src="/crm/claims.html?code=${req.params.code}" 
                style="width: 100%; height: 85vh; border: none; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"
                title="Claims Vault"
            ></iframe>
        `;
        res.send(renderPage(req.org, 'claims', content));
    });
    router.get('/admin/:code/logout', (req, res) => {
        res.setHeader('Set-Cookie', `session_${req.params.code}=; Path=/; Max-Age=0`);
        res.redirect(`/admin/${req.params.code}`);
    });


    // ==========================================
    // 🛡️ API: MANUAL CLAIM OVERRIDE
    // ==========================================
    router.post('/api/crm/claims/:code/override', express.json(), async (req, res) => {
        try {
            const { claimId, manualIdNumber } = req.body;

            if (!claimId || !manualIdNumber) {
                return res.status(400).json({ success: false, error: "Claim ID and Manual ID Number are required." });
            }

            // 1. Verify the organization and claim
            const org = await prisma.church.findUnique({ where: { code: req.params.code } });
            if (!org) return res.status(404).json({ success: false, error: "Organization not found" });

            const claim = await prisma.claim.findUnique({ where: { id: parseInt(claimId) } });
            if (!claim || claim.churchId !== org.id) {
                return res.status(404).json({ success: false, error: "Claim not found or unauthorized." });
            }

            // 2. Force the update (Bypassing AI)
            await prisma.claim.update({
                where: { id: claim.id },
                data: {
                    deceasedId: manualIdNumber,
                    status: 'APPROVED', // Force it through!
                    aiConfidence: 100, // We trust the human admin 100%
                    notes: `Manually overridden by Admin. Original AI failure bypassed.`
                }
            });

            res.json({ success: true, message: "Claim successfully overridden and approved!" });
        } catch (error) {
            console.error("Manual Override Error:", error);
            res.status(500).json({ success: false, error: "System error processing override." });
        }
    });

    // ==========================================
    // ✨ API: SUREPOL AI OCR EXTRACTOR
    // ==========================================
    router.post('/api/surepol/claims/extract-ocr', checkSession, (req, res, next) => {
        upload.single('document')(req, res, (err) => { 
            if (err) return res.status(400).json({ error: err.message }); 
            next(); 
        });
    }, async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ error: "No document uploaded." });

            const aiResponse = await analyzeAdminDocument(req.file.path, req.file.mimetype);
            
            res.json(aiResponse);
        } catch (error) {
            res.status(500).json({ error: "AI Processing Failed. Please fill manually." });
        }
    });

    // 🔌 2. MOUNT THE NEW API ROUTES HERE (Right before app.use)
    app.use('/api/crm/claims', claimsEngine);
    app.use('/api/crm/collections', blastEngine);
    
    // ==========================================
    // ⚙️ API: SETTINGS MODULE
    // ==========================================
    
    // 1. Fetch current settings
    router.get('/api/crm/settings/:code', async (req, res) => {
        try {
            const org = await prisma.church.findUnique({ where: { code: req.params.code } });
            res.json({ success: true, data: org });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 2. Save updated settings
    router.put('/api/crm/settings/:code', express.json(), async (req, res) => {
        try {
            const org = await prisma.church.update({
                where: { code: req.params.code },
                data: {
                    email: req.body.email,
                    adminPhone: req.body.adminPhone,
                    contactPerson: req.body.contactPerson,
                    defaultPremium: parseFloat(req.body.defaultPremium) || 150,
                    bankName: req.body.bankName,
                    accountNumber: req.body.accountNumber,
                    branchCode: req.body.branchCode
                }
            });
            res.json({ success: true, message: "Settings saved successfully!" });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // ==========================================
    // 🛒 API: VENDOR MANAGEMENT
    // ==========================================
    
    // 1. Fetch all vendors for this society
    router.get('/api/crm/vendors/:code', async (req, res) => {
        try {
            const org = await prisma.church.findUnique({ where: { code: req.params.code } });
            if (!org) return res.status(404).json({ success: false, error: "Organization not found" });
            
            const vendors = await prisma.vendor.findMany({
                where: { churchId: org.id },
                orderBy: { name: 'asc' }
            });
            res.json({ success: true, vendors });
        } catch (error) {
            console.error("Fetch Vendors Error:", error);
            res.status(500).json({ success: false, error: "Failed to load vendors." });
        }
    });

    // 2. Add a new vendor
    router.post('/api/crm/vendors/:code', express.json(), async (req, res) => {
        try {
            const { name, category, phone, email, bankDetails } = req.body;
            
            const org = await prisma.church.findUnique({ where: { code: req.params.code } });
            if (!org) return res.status(404).json({ success: false, error: "Organization not found" });

            const newVendor = await prisma.vendor.create({
                data: {
                    churchId: org.id,
                    name,
                    category,
                    phone,
                    email,
                    bankDetails
                }
            });

            res.json({ success: true, message: "Vendor added successfully!", vendor: newVendor });
        } catch (error) {
            console.error("Add Vendor Error:", error);
            res.status(500).json({ success: false, error: "Failed to save vendor." });
        }
    });

    // ============================================================
    // 🧮 API: FETCH DYNAMIC QUOTE DATA
    // ============================================================
    app.get('/api/public/quote-data/:code', async (req, res) => {
        try {
            const org = await prisma.church.findUnique({
                where: { code: req.params.code },
                include: {
                    plans: true,   // Fetching the dynamic plans
                    addons: true   // Fetching the dynamic addons
                }
            });

            if (!org) return res.status(404).json({ error: "Organization not found" });

            res.json({
                success: true,
                orgName: org.name,
                plans: org.plans,
                addons: org.addons
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: "Failed to fetch quote data" });
        }
    });

    app.use('/', router);
	
	// ==========================================
    // 📲 ADMIN: SEND DEBICHECK SETUP LINK
    // ==========================================
    router.post('/admin/:code/request-mandate', checkSession, async (req, res) => {
        const { memberId } = req.body;
        try {
            // 🚀 FIX: Removed the invalid 'include' statement. 
            // We already have the org details in req.org!
            const member = await prisma.member.findUnique({ 
                where: { id: parseInt(memberId) }
            });

            if (!member) return res.json({ success: false, error: "Member not found." });

            const host = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
            const mandateLink = `${host}/mandate/${member.id}`;

            if (process.env.TWILIO_SID && process.env.TWILIO_AUTH) {
                const twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
                const cleanTwilioNumber = process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '');
                
                // 🚀 FIX: Using req.org.name instead of member.organization.name
                const msg = `🔒 *Monthly Contribution Setup*\n\nHi ${member.firstName}, please click the secure link below to authorize your monthly DebiCheck contribution for *${req.org.name}*.\n\n👉 ${mandateLink}`;

                await twilioClient.messages.create({
                    from: `whatsapp:${cleanTwilioNumber}`,
                    to: `whatsapp:${member.phone}`,
                    body: msg
                });
                return res.json({ success: true, message: "Mandate link sent!" });
            } else {
                return res.json({ success: false, error: "WhatsApp service missing keys." });
            }
        } catch (error) {
            console.error("DebiCheck Trigger Error:", error);
            res.json({ success: false, error: error.message });
        }
    });
	
	// ============================================================
    // ✂️ MERCHANT DASHBOARD: SERVICES & PRICING
    // ============================================================
    router.get('/admin/:code/services', checkSession, async (req, res) => {
        try {
            const services = await prisma.product.findMany({
                where: { churchId: req.org.id },
                orderBy: { name: 'asc' }
            });

            const rows = services.map(s => `
                <tr>
                    <td><b>${s.name}</b></td>
                    <td>R${s.price.toFixed(2)}</td>
                    <td><span class="badge" style="background:${s.isActive ? '#27ae60' : '#e74c3c'};">${s.isActive ? 'Active' : 'Inactive'}</span></td>
                    <td style="text-align:right;">
                        <form method="POST" action="/admin/${req.org.code}/services/delete" style="display:inline;">
                            <input type="hidden" name="serviceId" value="${s.id}">
                            <button class="btn-del" onclick="return confirm('Are you sure you want to delete this service?');">Delete</button>
                        </form>
                    </td>
                </tr>
            `).join('');

            const content = `
                <div class="card" style="display:flex; justify-content:space-between; align-items:center; background:#1e272e; color:white;">
                    <div>
                        <h2 style="margin:0; color:#00d2d3;">✂️ Service & Price List</h2>
                        <p style="margin:0; margin-top:5px; font-size:13px; color:#b2bec3;">Manage the grooming services clients can book via WhatsApp.</p>
                    </div>
                </div>

                <div class="card">
                    <h3 style="margin-top:0;">Add New Service</h3>
                    <form method="POST" action="/admin/${req.org.code}/services/add" style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; background:#f8f9fa; padding:15px; border-radius:6px;">
                        <div>
                            <label>Service Name</label>
                            <input type="text" name="name" required placeholder="e.g. Standard Fade">
                        </div>
                        <div>
                            <label>Price (R)</label>
                            <input type="number" name="price" required placeholder="100" step="0.01">
                        </div>
                        <div style="grid-column: span 2;">
                            <button type="submit" class="btn" style="background:#0984e3; width:100%;">Add Service</button>
                        </div>
                    </form>
                </div>

                <div class="card">
                    <h3 style="margin:0 0 15px 0;">Active Services (${services.length})</h3>
                    <table>
                        <thead>
                            <tr>
                                <th>Service Name</th>
                                <th>Price</th>
                                <th>Status</th>
                                <th style="text-align:right;">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${services.length > 0 ? rows : '<tr><td colspan="4" style="text-align:center; padding:30px; color:#999;">No services added yet. Add one above!</td></tr>'}
                        </tbody>
                    </table>
                </div>
            `;

            res.send(renderPage(req.org, 'services', content));
        } catch (error) {
            console.error("Services Error:", error);
            res.send(renderPage(req.org, 'services', `<div class="card" style="color:red;">Error loading services.</div>`));
        }
    });

    router.post('/admin/:code/services/add', checkSession, async (req, res) => {
        try {
            await prisma.product.create({
                data: {
                    name: req.body.name,
                    price: parseFloat(req.body.price),
                    churchId: req.org.id,
                    isActive: true
                }
            });
        } catch (e) {
            console.error("Add service error:", e);
        }
        res.redirect(`/admin/${req.org.code}/services`);
    });

    router.post('/admin/:code/services/delete', checkSession, async (req, res) => {
        try {
            await prisma.product.delete({
                where: { id: parseInt(req.body.serviceId) }
            });
        } catch (e) {
            console.error("Delete service error:", e);
        }
        res.redirect(`/admin/${req.org.code}/services`);
    });
};