const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const cloudinary = require('cloudinary').v2;
const { sendWhatsApp } = require('../services/whatsapp'); 
const { decrypt } = require('../utils/crypto'); // Ensure this path matches your setup


// 🛡️ Cloudinary Config
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// 🛡️ Upload Config (Updated to allow Images/PDFs for Claims)
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
const generateOTP = () => Math.floor(1000 + Math.random() * 9000).toString();
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
    const navStyle = (tab) => `padding: 10px 15px; text-decoration: none; color: ${activeTab === tab ? '#000' : '#888'}; border-bottom: ${activeTab === tab ? '3px solid #00d2d3' : 'none'}; font-weight: bold; font-size: 14px;`;
    
    // Feature Toggles based on Type
    const verifyTab = !isChurch ? `<a href="/admin/${org.code}/verifications" style="${navStyle('verifications')}">🕵️ Verifications</a>` : '';
    const claimsTab = !isChurch ? `<a href="/admin/${org.code}/claims" style="${navStyle('claims')}">📑 Claims</a>` : '';
    const eventsTab = isChurch ? `<a href="/admin/${org.code}/events" style="${navStyle('events')}">📅 Events</a>` : '';

    return `<!DOCTYPE html><html><head><title>${org.name}</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:-apple-system,sans-serif;background:#f4f7f6;margin:0;padding-bottom:50px;}.header{background:white;padding:20px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;}.nav{background:white;padding:0 20px;border-bottom:1px solid #ddd;overflow-x:auto;white-space:nowrap;display:flex;}.container{padding:20px;max-width:800px;margin:0 auto;}.card{background:white;padding:20px;border-radius:10px;box-shadow:0 2px 5px rgba(0,0,0,0.05);margin-bottom:20px;}.btn{display:inline-block;padding:12px 20px;background:#1e272e;color:white;text-decoration:none;border-radius:8px;border:none;font-weight:bold;font-size:14px;width:100%;text-align:center;cursor:pointer;}.btn-del{background:#ffebeb;color:#d63031;padding:5px 10px;font-size:11px;width:auto;border-radius:4px;border:none;}.approve{background:#2ecc71;}.reject{background:#e74c3c;}.img-preview{max-width:100%;height:auto;border:1px solid #ddd;border-radius:5px;margin-top:10px;}input,select,textarea,button{box-sizing:border-box;}input,select,textarea{width:100%;padding:12px;margin-bottom:15px;border:1px solid #ddd;border-radius:6px;}label{display:block;margin-bottom:5px;font-weight:bold;font-size:12px;color:#555;text-transform:uppercase;}table{width:100%;border-collapse:collapse;}td,th{padding:12px 8px;border-bottom:1px solid #eee;font-size:14px;text-align:left;}.badge{padding:4px 8px;border-radius:4px;font-size:10px;color:white;font-weight:bold;}a{color:#0984e3;text-decoration:none;}</style></head>
    <body><div class="header"><b>${org.name} (${org.type})</b><a href="/admin/${org.code}/logout" style="color:red;font-size:12px;">Logout</a></div>
    <div class="nav">
        <a href="/admin/${org.code}/dashboard" style="${navStyle('dashboard')}">📊 Dashboard</a>
        ${verifyTab}
        <a href="/admin/${org.code}/members" style="${navStyle('members')}">👥 Members</a>
        ${claimsTab}
        ${eventsTab}
        <a href="/admin/${org.code}/team" style="${navStyle('team')}">🛡️ Team</a>
        <a href="/admin/${org.code}/ads" style="${navStyle('ads')}">📢 Ads</a>
		<a href="/admin/${org.code}/collections" style="${navStyle('collections')}">💰 Revenue Recovery</a>
		<a href="/admin/${org.code}/surepol" style="${navStyle('surepol')}">⚰️ Surepol (Burial)</a>
        <a href="/admin/${org.code}/settings" style="${navStyle('settings')}">⚙️ Settings</a>
    </div><div class="container">${content}</div></body></html>`;
};

// --- ✨ API: SUREPOL AI OCR EXTRACTOR ---
    const { analyzeAdminDocument } = require('../services/aiClaimWorker'); // Add this import at the top of admin.js if preferred

        }, async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ error: "No document uploaded." });

            // Send the file to Gemini!
            const aiResponse = await analyzeAdminDocument(req.file.path, req.file.mimetype);
            
            res.json(aiResponse);
        } catch (error) {
            res.status(500).json({ error: "AI Processing Failed. Please fill manually." });
        }
    });

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

    // --- LOGIN ---
    router.get('/admin/:code', async (req, res) => {
        const { code } = req.params;
        const { phone } = req.query; 
        const org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
        if (!org) return res.send("Not Found");

        if (!phone) {
            return res.send(`<html><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#f4f7f6;margin:0;">
                <form style="background:white;padding:30px;border-radius:10px;width:300px;box-shadow:0 10px 25px rgba(0,0,0,0.1);">
                    <h3 style="text-align:center;">🔐 ${org.name}</h3>
                    <input name="phone" placeholder="+27..." required style="width:100%;padding:12px;margin-bottom:10px;border:1px solid #ddd;border-radius:5px;">
                    <button style="width:100%;padding:15px;background:#1e272e;color:white;border:none;border-radius:5px;cursor:pointer;width:100%;font-weight:bold;">Request OTP</button>
                </form></body></html>`);
        }
        const otp = generateOTP();
        await prisma.church.update({ where: { id: org.id }, data: { otp, otpExpires: new Date(Date.now() + 300000) } });
        try { await sendWhatsApp(phone, `🔐 *${org.name} Admin Login*\nOTP: *${otp}*`); } catch (e) {}
        
        res.send(`<html><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#f4f7f6;margin:0;">
            <form action="/admin/${code}/verify" method="POST" style="background:white;padding:30px;border-radius:10px;width:300px;box-shadow:0 10px 25px rgba(0,0,0,0.1);">
                <input type="hidden" name="phone" value="${phone}">
                <h3 style="text-align:center;">Enter OTP</h3>
                <input name="otp" maxlength="4" style="font-size:28px;text-align:center;width:100%;padding:10px;border:1px solid #ddd;" required autofocus>
                <button style="width:100%;padding:15px;background:#1e272e;color:white;border:none;border-radius:5px;margin-top:15px;cursor:pointer;width:100%;">Verify</button>
            </form></body></html>`);
    });

    router.post('/admin/:code/verify', async (req, res) => {
        const org = await prisma.church.findUnique({ where: { code: req.params.code.toUpperCase() } });
        if (!org || org.otp !== req.body.otp) return res.send("Invalid OTP");
        res.setHeader('Set-Cookie', `session_${org.code}=active; HttpOnly; Path=/; Max-Age=3600`);
        res.redirect(`/admin/${org.code}/dashboard`);
    });

    // --- DASHBOARD ---
    router.get('/admin/:code/dashboard', checkSession, async (req, res) => {
        const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const tx = await prisma.transaction.findMany({ 
            where: { churchCode: req.org.code, status: 'SUCCESS', date: { gte: start } }, 
            orderBy: { id: 'desc' } 
        });
        const total = tx.reduce((s, t) => s + parseFloat(t.amount), 0);
        res.send(renderPage(req.org, 'dashboard', `<div class="card"><h3>💰 Collected (This Month)</h3><h1>R${total.toLocaleString()}</h1></div><div class="card"><h3>Recent Activity</h3><table>${tx.slice(0, 5).map(t => `<tr><td>${t.phone}</td><td>${t.type}</td><td>R${t.amount}</td></tr>`).join('')}</table></div>`));
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
                    ${pending > 0 ? `<form method="POST" action="/admin/${req.org.code}/collections/blast" style="margin:0;"><button class="btn" style="width:auto; background:#d63031; padding:10px 20px;">🚀 LAUNCH CAMPAIGN</button></form>` : '<span style="color:#999; font-size:13px;">Queue is empty</span>'}
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
								// Assign Badge Colors
								let badgeColor = '#27ae60'; // Default Green for SENT
								if (d.status === 'PENDING') badgeColor = '#e67e22'; // Orange
								if (d.status === 'REMINDER_1') badgeColor = '#f39c12'; // Amber Warning
								if (d.status === 'PROMISE_TO_PAY') badgeColor = '#0984e3'; // Blue
								if (d.status === 'DISPUTED') badgeColor = '#d63031'; // Red
								if (d.status === 'FINAL_NOTICE') badgeColor = '#2d3436'; // Black / Dark Grey
                            
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
    });;
	
// --- ⚰️ SUREPOL (BURIAL ADMIN UI) ---
    router.get('/admin/:code/surepol', checkSession, async (req, res) => {
        
        // 1. Fetch all pending claims for this specific church/society
        const pendingClaims = await prisma.claim.findMany({
            where: {
                churchCode: req.org.code,
                status: {
                    in: ['MANUAL_REVIEW_NEEDED', 'FLAGGED_WAITING_PERIOD', 'PENDING_REVIEW', 'PENDING_DOCUMENTATION']
                }
            },
            orderBy: { id: 'desc' }
        });

        // 2. Build the HTML rows for the claims table
        let claimsHtml = '';
        if (pendingClaims.length === 0) {
            claimsHtml = '<tr><td colspan="5" style="text-align:center; padding:30px; color:#999;">🎉 Queue is empty! No pending claims to review.</td></tr>';
        } else {
            claimsHtml = pendingClaims.map(c => {
                // Assign Badge Colors based on the AI's status
                let badgeColor = '#f39c12'; // Default Warning Orange
                if (c.status === 'FLAGGED_WAITING_PERIOD') badgeColor = '#e74c3c'; // Danger Red
                if (c.status === 'PENDING_REVIEW') badgeColor = '#3498db'; // Info Blue
                if (c.status === 'MANUAL_REVIEW_NEEDED') badgeColor = '#e67e22'; // Action Orange
                
                const docLink = c.documentUrl 
                    ? `<a href="${c.documentUrl}" target="_blank" style="background:#ecf0f1; padding:5px 10px; border-radius:4px; font-size:12px; font-weight:bold;">🖼️ View Doc</a>` 
                    : '<span style="color:#999; font-size:12px;">No Doc</span>';
                
                return `
                <tr style="background: ${c.status === 'MANUAL_REVIEW_NEEDED' ? '#fffbeb' : 'transparent'};">
                    <td><b>${c.deceasedIdNumber === 'UNREADABLE' ? '⚠️ UNREADABLE' : c.deceasedIdNumber}</b><br><span style="font-size:11px; color:#888;">Claimant: ${c.claimantPhone}</span></td>
                    <td>${new Date(c.dateOfDeath).toLocaleDateString()}</td>
                    <td>
                        <span class="badge" style="background:${badgeColor}; padding:5px 8px;">${c.status.replace(/_/g, ' ')}</span>
                        <div style="font-size:11px; color:#555; margin-top:5px; max-width:250px;">${c.adminNotes || ''}</div>
                    </td>
                    <td>${docLink}</td>
                    <td><button class="btn" style="width:auto; padding:6px 12px; font-size:12px; background:#2c3e50;" onclick="alert('Review action coming next!')">Review</button></td>
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
                // (Leave all your existing scripts inside here untouched!)
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
                    // Inside the 'addDependentBtn' click listener in admin.js
					div.innerHTML = 
						'<input type="text" class="dep-fname" placeholder="First Name" required style="margin:0; flex:1; padding:8px;">' +
						'<input type="text" class="dep-lname" placeholder="Surname" required style="margin:0; flex:1; padding:8px;">' +
						'<input type="date" class="dep-dob" required style="margin:0; flex:1; padding:8px;">' + // 👈 Changed to type="date"
						'<select class="dep-rel" style="margin:0; flex:1; padding:8px;">' +
							'<option value="SPOUSE">Spouse</option>' +
							'<option value="CHILD">Child</option>' +
							'<option value="EXTENDED">Extended Family</option>' +
						'</select>' +
						'<button type="button" onclick="this.parentElement.remove()" ...>X</button>';
                });

                document.getElementById('newPolicyForm').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const btn = document.getElementById('savePolicyBtn');
                    const errorBox = document.getElementById('formErrorMsg');
                    
                    btn.innerText = "Saving...";
                    errorBox.style.display = "none";

                    const dependents = [];
                    const depRows = depsContainer.children;
                    // Inside the 'newPolicyForm' submit listener
					for (let i = 0; i < depRows.length; i++) {
						dependents.push({
							firstName: depRows[i].querySelector('.dep-fname').value.trim(),
							lastName: depRows[i].querySelector('.dep-lname').value.trim(),
							dateOfBirth: depRows[i].querySelector('.dep-dob').value, // 👈 Updated
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
                        
                        // 🛠️ FIX: Added lastName to CREATE block
                        await prisma.member.upsert({ 
                            where: { phone: cleanPhone }, 
                            update: { firstName: firstName, lastName: lastName }, 
                            create: { 
                                firstName: firstName, 
                                lastName: lastName, // <--- The Missing Field!
                                phone: cleanPhone, 
                                churchCode: req.org.code,
                                status: 'ACTIVE'
                            } 
                        }); 
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
                await prisma.member.update({ where: { id: member.id }, data: { isIdVerified: true, verifiedAt: new Date(), rejectionReason: null } });
                try { await sendWhatsApp(cleanPhone, `✅ *KYC Approved!*\n\nHi ${member.firstName}, your identity documents and proof of address have been successfully verified by ${req.org.name}.`); } catch(e){ console.error(e.message); }
            } else {
                const rejectMsg = reason || "Documents were not clear or incomplete";
                await prisma.member.update({ where: { id: member.id }, data: { isIdVerified: false, rejectionReason: rejectMsg } });
                try { await sendWhatsApp(cleanPhone, `❌ *KYC Verification Failed*\n\nHi ${member.firstName}, your recent document upload was rejected by the administrator.\n\n*Reason:* ${rejectMsg}\n\nPlease reply with *3* to generate a new secure link and re-upload your documents.`); } catch(e){ console.error(e.message); }
            }
        }
        res.redirect(`/admin/${req.org.code}/verifications`);
    });;

   // --- 👤 MEMBER PROFILE & KYC REVIEW ---
    router.get('/admin/:code/member/:id', checkSession, async (req, res) => {
        const member = await prisma.member.findUnique({ where: { id: parseInt(req.params.id) } });
        if (!member) return res.send("Not Found");

        // 🛠️ Smarter Decryptor: Ignores legacy plain-text data
        const safeDecrypt = (data) => {
            if (!data) return null;
            // Encrypted data usually contains a colon (iv:encryptedContent)
            if (typeof data === 'string' && data.includes(':') && data.length > 30) {
                try { return decrypt ? decrypt(data) : data; } catch (e) { return data; }
            }
            return data; // Return unencrypted legacy data as-is
        };

        const idNum = safeDecrypt(member.idNumber) || 'Not Provided';
        const address = safeDecrypt(member.address) || 'Not Provided';
        let idPhoto = safeDecrypt(member.idPhotoUrl);
        let addressPhoto = safeDecrypt(member.proofOfAddressUrl);

        // Ensure URLs are HTTPS
        if (idPhoto && idPhoto.startsWith('http:')) idPhoto = idPhoto.replace('http:', 'https:');
        if (addressPhoto && addressPhoto.startsWith('http:')) addressPhoto = addressPhoto.replace('http:', 'https:');

        // Helper to render Docs (Handles PDFs vs Images)
        const renderDoc = (url, title) => {
            if (!url) return `<div style="padding:15px; background:#f9f9f9; border:1px dashed #ccc; text-align:center; color:#999; border-radius:8px; margin-bottom:15px;">No ${title} Uploaded</div>`;
            if (url.endsWith('.pdf')) {
                return `<div style="margin-bottom:15px; background:#eef2f5; padding:15px; border-radius:8px; border:1px solid #ddd;"><strong style="display:block; margin-bottom:10px;">📄 ${title} (PDF)</strong><a href="${url}" target="_blank" class="btn" style="background:#3498db; width:auto;">Open PDF Document</a></div>`;
            }
            return `<div style="margin-bottom:15px;"><strong style="display:block; margin-bottom:5px; color:#2c3e50;">📸 ${title}</strong><a href="${url}" target="_blank"><img src="${url}" style="max-width:100%; border-radius:8px; border:1px solid #ddd; box-shadow:0 2px 5px rgba(0,0,0,0.1);"></a></div>`;
        };

        // ... [KEEP YOUR EXISTING res.send(renderPage(...)) HTML BLOCK HERE] ...

        res.send(renderPage(req.org, 'members', `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <a href="/admin/${req.params.code}/verifications" style="color:#7f8c8d; text-decoration:none; font-weight:bold;">← Back to Queue</a>
                ${member.isIdVerified ? '<span class="badge" style="background:#27ae60; padding:6px 12px; font-size:14px;">✅ Fully Verified</span>' : '<span class="badge" style="background:#f39c12; padding:6px 12px; font-size:14px;">Pending Review</span>'}
            </div>

            <div class="card" style="border-top: 4px solid #00d2d3;">
                <h2 style="margin-top:0;">${member.firstName} ${member.lastName}</h2>
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
                <div style="background:#f8f9fa; padding:15px; border-radius:6px; margin-bottom:20px;">
                    <span style="font-size:11px; color:#7f8c8d; text-transform:uppercase;">Physical Address</span><br>
                    <strong>${address}</strong>
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
                        
                        <label style="color:#b45309;">Rejection Reason (Only sent if rejecting)</label>
                        <textarea name="reason" placeholder="e.g. The photo of your ID is blurry, please retake it in good lighting." style="background:white; border-color:#fcd34d;"></textarea>
                        
                        <div style="display:flex; gap:10px; margin-top:10px;">
                            <button name="action" value="approve" class="btn" style="flex:1; background:#27ae60; padding:15px; font-size:16px;">✅ Approve KYC</button> 
                            <button name="action" value="reject" class="btn" style="flex:1; background:#e74c3c; padding:15px; font-size:16px;">❌ Reject Documents</button>
                        </div>
                    </form>
                </div>
                ` : ''}
            </div>
        `));
    });

    
    // --- 📄 PDF & SETTINGS ---
    router.get('/admin/:code/members/:phone/pdf', checkSession, async (req, res) => {
        const m = await prisma.member.findUnique({ where: { phone: req.params.phone } }); 
        const doc = new PDFDocument({ margin: 50 });
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="Statement_${m.firstName}_${m.lastName}.pdf"`);
        doc.pipe(res);

        try {
            // 🖼️ 1. Try to fetch and stamp the Logo
            // (Assuming your database uses 'logoUrl' or similar. Change this if your DB field is named differently, like 'logo' or 'image')
            if (req.org.logoUrl) { 
                const response = await fetch(req.org.logoUrl);
                const arrayBuffer = await response.arrayBuffer();
                const imageBuffer = Buffer.from(arrayBuffer);
                
                // Stamp it perfectly centered at the top
                doc.image(imageBuffer, (doc.page.width - 100) / 2, 40, { width: 100 });
                doc.moveDown(5); // Push the rest of the text down
            } else {
                // No logo? Fallback to the generic text header
                doc.fontSize(22).text(`${req.org.name}`, { align: 'center' });
                doc.moveDown(1);
            }
        } catch (error) {
            // If the image fails to load, gracefully fallback to text
            console.error("PDF Logo Error:", error.message);
            doc.fontSize(22).text(`${req.org.name}`, { align: 'center' });
            doc.moveDown(1);
        }

        // 📝 2. Print the Statement Details
        doc.fontSize(16).text(`Account Statement`, { align: 'center', underline: true });
        doc.moveDown(1);
        
        doc.fontSize(12).text(`Member: ${m.firstName} ${m.lastName}`);
        doc.text(`Phone: ${m.phone}`);
        doc.text(`ID Number: ${m.idNumber || 'N/A'}`);
        doc.text(`Date Issued: ${new Date().toLocaleDateString()}`);
        
        doc.moveDown(2);
        
        // Draw a simple dividing line
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(1);

        // Print the status
        doc.fontSize(14).text(`Account Status: Confirmed`, { align: 'center' });

        doc.end();
    });
    router.get('/admin/:code/settings', checkSession, (req, res) => res.send(renderPage(req.org, 'settings', `<div class="card"><h3>Settings</h3><p>${req.org.name}</p></div>`)));
    router.get('/admin/:code/ads', checkSession, (req, res) => res.send(renderPage(req.org, 'ads', `<div class="card"><h3>Ads</h3><p>Coming Soon</p></div>`)));
    router.get('/admin/:code/claims', checkSession, (req, res) => res.send(renderPage(req.org, 'claims', `<div class="card"><h3>Claims</h3><p>See Dashboard for Liability.</p></div>`)));
    
    router.get('/admin/:code/logout', (req, res) => {
        res.setHeader('Set-Cookie', `session_${req.params.code}=; Path=/; Max-Age=0`);
        res.redirect(`/admin/${req.params.code}`);
    });
    
    router.get('/admin/:code/logout', (req, res) => {
        res.setHeader('Set-Cookie', `session_${req.params.code}=; Path=/; Max-Age=0`);
        res.redirect(`/admin/${req.params.code}`);
    });

    // ==========================================
    // ✨ API: SUREPOL AI OCR EXTRACTOR
    // ==========================================
    const { analyzeAdminDocument } = require('../services/aiClaimWorker'); 

    router.post('/api/surepol/claims/extract-ocr', checkSession, (req, res, next) => {
        upload.single('document')(req, res, (err) => { 
            if (err) return res.status(400).json({ error: err.message }); 
            next(); 
        });
    }, async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ error: "No document uploaded." });

            // Send the file to Gemini!
            const aiResponse = await analyzeAdminDocument(req.file.path, req.file.mimetype);
            
            res.json(aiResponse);
        } catch (error) {
            res.status(500).json({ error: "AI Processing Failed. Please fill manually." });
        }
    });

    // 👇 IT MUST GO RIGHT ABOVE THIS LINE!
    app.use('/', router);
};
