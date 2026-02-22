const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const cloudinary = require('cloudinary').v2;
const { sendWhatsApp } = require('../services/whatsapp'); 

// 🛡️ Cloudinary Config
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// 🛡️ Upload Config
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.includes('csv') || file.originalname.endsWith('.csv')) cb(null, true);
        else cb(new Error('❌ Invalid File Type. CSV only.'));
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
        const content = `
            <div class="card" style="background:#1e272e; color:white;">
                <h2 style="margin:0; color:#00d2d3;">Surepol Burial Administration</h2>
                <p style="margin:5px 0 0 0; font-size:13px; color:#b2bec3;">Manage policyholders, dependents, and verify 6-month waiting periods.</p>
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
                        
                        <div id="dependentsContainer">
                            </div>

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
                        <label>ID Number of Deceased</label>
                        <input type="text" id="claimIdNumber" placeholder="13-Digit SA ID" required style="width:100%; padding:10px; margin-bottom:15px;">

                        <label>Date of Death</label>
                        <input type="date" id="claimDate" required style="width:100%; padding:10px; margin-bottom:15px;">

                        <label>Cause of Death</label>
                        <select id="claimCause" style="width:100%; padding:10px; margin-bottom:15px;">
                            <option value="NATURAL">Natural Causes (6-Month Rule Applies)</option>
                            <option value="UNNATURAL">Accidental / Unnatural Causes (No Waiting Period)</option>
                        </select>
                        
                        <label>Claimant Phone (Family Contact)</label>
                        <input type="text" id="claimantPhone" placeholder="082..." required style="width:100%; padding:10px; margin-bottom:15px;">

                        <div id="claimErrorMsg" style="color:#d63031; margin-bottom:10px; font-weight:bold; display:none;"></div>

                        <button type="submit" id="saveClaimBtn" class="btn" style="background:#e74c3c; width:100%;">Verify & Submit Claim</button>
                    </form>
                </div>
            </div>
            <script>
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
												'<button class="btn" style="flex:1; background:#2ecc71; padding:8px 15px;" onclick="openPaymentModal(\'' + data.memberData.phone + '\', \'' + data.memberData.firstName + '\')">💰 Log Payment</button>' +
												'<button class="btn" style="flex:1; background:#e74c3c; padding:8px 15px;" onclick="document.getElementById(\'logClaimModal\').style.display=\'flex\'">📑 Log Death Claim</button>' +
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
                // Helper function called by the green button to open the modal
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

                        // Success! Close modal and reset
                        document.getElementById('logPaymentModal').style.display = 'none';
                        document.getElementById('paymentForm').reset();
                        
                        // Let the admin know it worked, and click the search button again to refresh the policy status
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
                let depCount = 0;

                // 1. Logic to add a new dependent row
                document.getElementById('addDependentBtn').addEventListener('click', () => {
                    const div = document.createElement('div');
                    div.style.cssText = "display:flex; gap:5px; margin-bottom:10px; background:#f8f9fa; padding:10px; border-radius:5px;";
                    div.innerHTML = 
                        '<input type="text" class="dep-fname" placeholder="First Name" required style="margin:0; flex:1; padding:8px;">' +
                        '<input type="text" class="dep-lname" placeholder="Surname" required style="margin:0; flex:1; padding:8px;">' +
                        '<input type="text" class="dep-id" placeholder="ID Number" required style="margin:0; flex:1; padding:8px;">' +
                        '<select class="dep-rel" style="margin:0; flex:1; padding:8px;">' +
                            '<option value="SPOUSE">Spouse</option>' +
                            '<option value="CHILD">Child</option>' +
                            '<option value="EXTENDED">Extended Family</option>' +
                        '</select>' +
                        '<button type="button" onclick="this.parentElement.remove()" style="background:#ff7675; color:white; border:none; border-radius:4px; cursor:pointer; padding:0 10px;">X</button>';
                    depsContainer.appendChild(div);
                });

                // 2. Logic to submit the entire form
                document.getElementById('newPolicyForm').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const btn = document.getElementById('savePolicyBtn');
                    const errorBox = document.getElementById('formErrorMsg');
                    
                    btn.innerText = "Saving...";
                    errorBox.style.display = "none";

                    // Gather Dependents
                    const dependents = [];
                    const depRows = depsContainer.children;
                    for (let i = 0; i < depRows.length; i++) {
                        dependents.push({
                            firstName: depRows[i].querySelector('.dep-fname').value.trim(),
                            lastName: depRows[i].querySelector('.dep-lname').value.trim(),
                            idNumber: depRows[i].querySelector('.dep-id').value.trim(),
                            relation: depRows[i].querySelector('.dep-rel').value
                        });
                    }

                    // Build Payload
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

                        // Success! Close modal, clear form, and alert user
                        document.getElementById('addPolicyModal').style.display = 'none';
                        document.getElementById('newPolicyForm').reset();
                        depsContainer.innerHTML = ''; // clear dependents
                        alert("✅ Policy created successfully! 6-Month waiting period has begun.");

                    } catch (error) {
                        errorBox.innerText = error.message;
                        errorBox.style.display = "block";
                    } finally {
                        btn.innerText = "Save Policy & Start Waiting Period";
                    }
                });
				
				// --- LOG DEATH CLAIM LOGIC ---
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
                        
                        // If the backend 6-month math rejects it, it throws an error here!
                        if (!response.ok) throw new Error(data.error || "Failed to log claim.");

                        // Success!
                        document.getElementById('logClaimModal').style.display = 'none';
                        document.getElementById('claimForm').reset();
                        
                        alert("⚠️ Claim logged successfully. Awaiting official Home Affairs documentation (DHA-1663).");
                        document.getElementById('searchMemberBtn').click(); // Refresh to show DECEASED status

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
        const allMembers = await prisma.member.findMany({ where: { churchCode: req.params.code.toUpperCase() } });
        const queue = allMembers.filter(m => (m.idPhotoUrl && m.idPhotoUrl.length > 5) || (m.idNumber && m.idNumber.length > 5));
        res.send(renderPage(req.org, 'verifications', `<div class="card"><h3>📂 Verification Queue (${queue.length})</h3><table><thead><tr><th>Name</th><th>Status</th><th>Action</th></tr></thead><tbody>${queue.length > 0 ? queue.map(m => `<tr><td>${m.firstName}</td><td>${(m.idPhotoUrl && m.idPhotoUrl.length > 5) ? '📷 Photo' : '📝 Data'}</td><td><a href="/admin/${req.params.code}/member/${m.id}" class="btn" style="width:auto;padding:5px 10px;">View</a></td></tr>`).join('') : '<tr><td colspan="3">No items found.</td></tr>'}</tbody></table></div>`));
    });

    router.post('/admin/:code/verifications/action', checkSession, async (req, res) => {
        const { memberId, action, reason } = req.body;
        const member = await prisma.member.findUnique({ where: { id: parseInt(memberId) } });
        if (member) {
            if (action === 'approve') {
                await prisma.member.update({ where: { id: member.id }, data: { isIdVerified: true, verifiedAt: new Date(), rejectionReason: null } });
                try { await sendWhatsApp(member.phone, `✅ *Verification Approved*\n\nHi ${member.firstName}, your documents have been accepted.`); } catch(e){}
            } else {
                await prisma.member.update({ where: { id: member.id }, data: { isIdVerified: false, rejectionReason: reason || "Docs unclear" } });
                try { await sendWhatsApp(member.phone, `❌ *Verification Rejected*\n\nReason: ${reason || "Documents were not clear"}.\nPlease reply '3' to re-upload.`); } catch(e){}
            }
        }
        res.redirect(`/admin/${req.org.code}/verifications`);
    });

    // --- 👤 MEMBER PROFILE ---
    router.get('/admin/:code/member/:id', checkSession, async (req, res) => {
        const member = await prisma.member.findUnique({ where: { id: parseInt(req.params.id) } });
        if (!member) return res.send("Not Found");
        let photoUrl = member.idPhotoUrl || ""; 
        if (photoUrl.startsWith('http:')) photoUrl = photoUrl.replace('http:', 'https:');
        res.send(`<html><head><title>Profile</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:sans-serif;padding:20px;max-width:600px;margin:0 auto;background:#f4f4f9}.card{background:white;padding:20px;border-radius:8px;}</style></head><body>
            <div class="card"><a href="/admin/${req.params.code}/verifications">Back</a><h2>${member.firstName} ${member.lastName}</h2><p>ID: ${member.idNumber || 'N/A'}</p><hr>${photoUrl.length > 5 ? `<a href="${photoUrl}"><img src="${photoUrl}" style="max-width:100%;border-radius:5px;"></a>` : '<p style="color:red">No Photo</p>'}<br><br><div style="background:#f0f2f5;padding:15px;"><h4>Action</h4><form action="/admin/${req.params.code}/verifications/action" method="POST"><input type="hidden" name="memberId" value="${member.id}"><button name="action" value="approve" style="background:#2ecc71;color:white;padding:10px;border:none;cursor:pointer;">✅ Approve</button> <button name="action" value="reject" style="background:#e74c3c;color:white;padding:10px;border:none;cursor:pointer;">❌ Reject</button></form></div><br><a href="/admin/${req.params.code}/members/${member.phone}/pdf" style="display:block;margin-top:10px;">📄 Download Statement (PDF)</a></div></body></html>`);
    });

    // --- 📄 PDF & SETTINGS ---
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

    app.use('/', router);
};