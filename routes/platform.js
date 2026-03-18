// routes/platform.js
// VERSION: 13.0 (Compliance Resolution UI + Payouts + AI Manual Override + TOTP MFA)
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const sgMail = require('@sendgrid/mail');
const speakeasy = require('speakeasy'); // 🔒 NEW: Bank-Grade MFA Engine
const { sendWhatsApp } = require('../services/whatsapp');
const { processAndImportCoursePDF } = require('../services/courseImporter');
const { extractDataFromImage } = require('../services/visionExtractor');
const { provisionNetCashAccount } = require('../services/netcashProvisioner');
const { generatePaymentQR } = require('../services/paymentQrgen');
const { logAction } = require('../services/audit');
const { sendRemittanceAdvice } = require('../services/remittance');


const upload = multer({ dest: 'uploads/' });

// --- CONFIGURATION ---
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'seabe123';
const COOKIE_NAME = 'seabe_admin_session';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'secret_token_123';

// --- HELPERS ---
function parseCookies(req) {
    const list = {}, rc = req.headers.cookie;
    rc && rc.split(';').forEach(c => { 
        const p = c.split('='); 
        list[p.shift().trim()] = decodeURI(p.join('=')); 
    });
    return list;
}

function isAuthenticated(req) {
    const cookies = parseCookies(req);
    return cookies[COOKIE_NAME] === ADMIN_SECRET;
}

function safeDate(d) {
    if (!d) return new Date();
    return new Date(d);
}

// --- UI RENDERER ---
function renderAdminPage(title, content, error = null) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>${title} | Seabe Platform</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: 'Segoe UI', sans-serif; background: #f4f7f6; margin: 0; display: flex; color: #333; }
                .sidebar { width: 250px; background: #1e272e; color: white; min-height: 100vh; padding: 20px; box-sizing: border-box; position: fixed; overflow-y: auto; }
                .sidebar h2 { color: #00d2d3; margin-top: 0; padding-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.1); }
                .sidebar a { display: block; color: #ccc; text-decoration: none; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05); transition:0.2s; }
                .sidebar a:hover { color: #00d2d3; padding-left: 5px; }
                .main { margin-left: 250px; flex: 1; padding: 40px; }
                h1 { color: #1e272e; border-bottom: 3px solid #00d2d3; display: inline-block; padding-bottom: 5px; margin-bottom: 30px; }
                .error-box { background: #fee; color: #c00; padding: 15px; border-radius: 5px; border: 1px solid #fcc; margin-bottom: 20px; }
                table { width:100%; border-collapse:collapse; background:white; border-radius:8px; overflow:hidden; box-shadow:0 4px 10px rgba(0,0,0,0.05); margin-top: 20px; }
                thead { background:#1e272e; color:white; }
                th { padding:15px; text-align:left; font-weight:600; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; }
                td { padding:12px 15px; border-bottom:1px solid #eee; font-size:14px; }
                tr:hover { background-color: #f9f9f9; }
                .tag { padding:4px 8px; border-radius:4px; font-weight:bold; font-size:11px; text-transform:uppercase; display:inline-block; margin-bottom:2px;}
                .tag-church { background:#eefdf5; color:green; border:1px solid green; }
                .tag-society { background:#eefafc; color:#0984e3; border:1px solid #0984e3; }
                .tag-npo { background:#fff8e1; color:#f39c12; border:1px solid #f39c12; }
                .tag-provider { background:#f5eef8; color:#8e44ad; border:1px solid #8e44ad; }
                .btn { padding: 8px 15px; border-radius: 4px; text-decoration: none; font-size: 13px; font-weight: bold; cursor: pointer; border: none; display: inline-block; transition: 0.2s; }
                .btn-primary { background: #1e272e; color: white; }
                .btn-primary:hover { background: #00d2d3; color: #1e272e; }
                .btn-edit { background: #dfe6e9; color: #2d3436; }
                .btn-save { background: #2ecc71; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-weight: bold; }
                .btn-danger { background: #ffebee; color: #c0392b; }
                .btn-collection { background: #c0392b; color: white; margin-left:5px; }
                .card-form { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.05); margin-bottom: 20px; }
                .form-group { margin-bottom: 20px; }
                .form-group label { display: block; margin-bottom: 8px; font-weight: bold; color: #1e272e; font-size: 12px; text-transform: uppercase; }
                .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; font-family: inherit; }
                .search-bar { display: flex; gap: 10px; margin-bottom: 20px; align-items: center; }
                .ai-result-box { background: #f0fdf4; border: 1px solid #16a34a; padding: 15px; border-radius: 6px; margin-top: 15px; display: none; }
                .ai-loader { display: none; text-align: center; color: #00d2d3; font-weight: bold; margin-top: 10px; }
            </style>
        </head>
        <body>
            <div class="sidebar">
                <h2>SEABE PLATFORM</h2>
                <a href="/admin">📊 Dashboard</a>
                <a href="/admin/global-radar">🌍 Global Radar</a>
                <a href="/admin/churches">🏢 Organizations</a>
                <a href="/admin/pricing">🏷️ Pricing Engine</a> 
                <a href="/admin/fica">🛡️ FICA & KYB</a> 
                <a href="/admin/compliance">⚖️ Compliance & LSO</a>
                <a href="/admin/global-collections">💰 Global Collections</a>
                <a href="/admin/payouts">💸 Church Payouts</a>
                <a href="/admin/course-builder">🤖 AI Course Builder</a>
                <a href="/admin/events">🎟️ Events & Projects</a>
                <a href="/admin/ads">📢 Broadcasts</a>
                <a href="/admin/news">📰 News Feed</a>
                <a href="/admin/users">👥 Member Search</a>
                <br><br>
                <a href="/logout" style="color:#ff7675;">🚪 Sign Out</a>
            </div>
            <div class="main">
                <h1>${title}</h1>
                ${error ? `<div class="error-box"><strong>Error:</strong> ${error}</div>` : ''}
                ${content}
            </div>
        </body>
        </html>
    `;
}

module.exports = function(app, { prisma }) {

    // ============================================================
    // 🔐 AUTHENTICATION (NOW WITH TOTP MFA!)
    // ============================================================
    app.get('/login', (req, res) => {
        res.send(`
            <div style="font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; background:#2d3436;">
                <form action="/login" method="POST" style="background:white; padding:40px; border-radius:10px; text-align:center; width: 300px; box-shadow:0 10px 30px rgba(0,0,0,0.2);">
                    <h2 style="color:#1e272e;">Vault Login</h2>
                    <input name="username" placeholder="Username" required style="padding:15px; width:100%; margin-bottom:10px; box-sizing:border-box; border:1px solid #ddd; border-radius:5px;">
                    <input type="password" name="password" placeholder="Password" required style="padding:15px; width:100%; margin-bottom:10px; box-sizing:border-box; border:1px solid #ddd; border-radius:5px;">
                    <input type="text" name="totp" placeholder="6-Digit Authenticator Code" required autocomplete="off" style="padding:15px; width:100%; margin-bottom:20px; box-sizing:border-box; border:1px solid #ddd; border-radius:5px; font-weight:bold; letter-spacing:2px; text-align:center;">
                    <button style="padding:15px; width:100%; background:#00d2d3; color:#1e272e; font-weight:bold; border:none; border-radius:5px; cursor:pointer;">SECURE LOGIN</button>
                </form>
            </div>
        `);
    });

    app.post('/login', (req, res) => {
        const { username, password, totp } = req.body;

        // 1. Verify Username and Password
        if (username !== ADMIN_USER || password !== ADMIN_PASS) {
            return res.send("<script>alert('Invalid Credentials'); window.location.href='/login';</script>");
        }

        // 2. Fail Fast: Ensure MFA is configured in Environment Variables
        const ADMIN_TOTP_SECRET = process.env.ADMIN_TOTP_SECRET;
        if (!ADMIN_TOTP_SECRET) {
            return res.send("⚠️ CRITICAL SECURITY ERROR: ADMIN_TOTP_SECRET is not set in Environment Variables.");
        }

        // 3. Verify the 6-Digit Code mathematically using Speakeasy
        const isValidMfa = speakeasy.totp.verify({
            secret: ADMIN_TOTP_SECRET,
            encoding: 'base32',
            token: totp,
            window: 1 // Allows 30 seconds of drift in case they type slowly
        });

        if (!isValidMfa) {
            return res.send("<script>alert('Invalid or Expired Authenticator Code'); window.location.href='/login';</script>");
        }

        // 4. Success! Grant Access
        res.setHeader('Set-Cookie', `${COOKIE_NAME}=${ADMIN_SECRET}; HttpOnly; Path=/; Max-Age=3600`);
        res.redirect('/admin');
    });

    app.get('/logout', (req, res) => {
        res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0`);
        res.redirect('/login');
    });

    // ============================================================
    // 📊 DASHBOARD
    // ============================================================
    app.get('/admin', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        
        try {
            const counts = {
                orgs: await prisma.church.count(),
                events: await prisma.event.count().catch(() => 0),
                ads: await prisma.ad.count().catch(() => 0),
                debtRows: await prisma.collection.count().catch(() => 0),
                debtSum: await prisma.collection.aggregate({ _sum: { amount: true } }).catch(() => ({ _sum: { amount: 0 } }))
            };
            const totalDebt = counts.debtSum._sum.amount || 0;

            const content = `
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:20px;">
                    <div style="background:white; padding:30px; border-radius:10px; border-left: 5px solid #00d2d3; box-shadow:0 4px 10px rgba(0,0,0,0.05);">
                        <h3 style="margin:0; font-size:3rem; color:#1e272e;">${counts.orgs}</h3>
                        <p style="color:#636e72; font-weight:bold; margin-top:5px; text-transform:uppercase; font-size:12px;">Total Organizations</p>
                    </div>
                    <div style="background:white; padding:30px; border-radius:10px; border-left: 5px solid #ff7675; box-shadow:0 4px 10px rgba(0,0,0,0.05);">
                        <h3 style="margin:0; font-size:3rem; color:#1e272e;">R${(totalDebt/1000).toFixed(1)}k</h3>
                        <p style="color:#636e72; font-weight:bold; margin-top:5px; text-transform:uppercase; font-size:12px;">Recoverable Debt (${counts.debtRows})</p>
                    </div>
                    <div style="background:white; padding:30px; border-radius:10px; border-left: 5px solid #a29bfe; box-shadow:0 4px 10px rgba(0,0,0,0.05);">
                        <h3 style="margin:0; font-size:3rem; color:#1e272e;">${counts.events}</h3>
                        <p style="color:#636e72; font-weight:bold; margin-top:5px; text-transform:uppercase; font-size:12px;">Active Events</p>
                    </div>
                </div>
            `;
            res.send(renderAdminPage('Platform Overview', content));
        } catch (e) {
            res.send(renderAdminPage('Dashboard', '', `Database Error: ${e.message}`));
        }
    });

    // ============================================================
    // 🏢 ORGANIZATIONS & AI SCANNER
    // ============================================================
    app.get('/admin/churches', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const q = req.query.q || '';
        
        try {
            const items = await prisma.church.findMany({ 
                where: { 
                    OR: [ 
                        { name: { contains: q, mode: 'insensitive' } }, 
                        { code: { contains: q, mode: 'insensitive' } } 
                    ]
                },
                orderBy: { createdAt: 'desc' } 
            });

            const rows = items.map(c => {
                let badgeClass = 'tag-church';
                if (c.type === 'BURIAL_SOCIETY') badgeClass = 'tag-society';
                if (c.type === 'NON_PROFIT') badgeClass = 'tag-npo';
                if (c.type === 'SERVICE_PROVIDER') badgeClass = 'tag-provider';

                return `
                <tr>
                    <td>
                        <strong>${c.name}</strong><br>
                        <span style="font-size:11px; color:#999;">${c.email || 'No Email'}</span>
                    </td>
                    <td><span class="tag ${badgeClass}">${c.type ? c.type.replace('_', ' ') : 'UNKNOWN'}</span></td>
                    <td><code>${c.code}</code></td>
                    <td>${c.subaccountCode ? '✅ Linked' : '<span style="color:orange">Pending</span>'}</td>
                    <td style="text-align:right;">
                        <a href="/admin/churches/edit/${c.code}" class="btn btn-edit">Manage</a>
                        <a href="/admin/${c.code}/collections" target="_blank" class="btn btn-collection">💰 Collections</a>
                    </td>
                </tr>
                `;
            }).join('');

            const content = `
                <div style="display:flex; justify-content:space-between; margin-bottom:20px; align-items:center;">
                    <form action="/admin/churches" class="search-bar" style="margin:0;">
                        <input name="q" value="${q}" placeholder="Search Name, Code..." style="padding:10px; width:300px; border:1px solid #ddd; border-radius:4px;">
                        <button class="btn btn-primary">Search</button>
                    </form>
                    <a href="/admin/churches/add" class="btn btn-primary" style="background:#00d2d3; color:black;">+ New Organization</a>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>Organization</th>
                            <th>Type</th>
                            <th>Code</th>
                            <th>Gateway</th>
                            <th style="text-align:right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.length > 0 ? rows : '<tr><td colspan="5" style="text-align:center; padding:30px;">No results found.</td></tr>'}
                    </tbody>
                </table>
            `;
            res.send(renderAdminPage('Manage Organizations', content));
        } catch (e) { 
            res.send(renderAdminPage('Error', '', e.message)); 
        }
    });

    app.get('/admin/churches/add', (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const content = `
            <form method="POST" class="card-form">
                <div class="form-group">
                    <label>Type</label>
                    <select name="type">
                        <option value="CHURCH">Church</option>
                        <option value="BURIAL_SOCIETY">Society</option>
                        <option value="NON_PROFIT">NGO</option>
                        <option value="SERVICE_PROVIDER">Service Provider</option> 
                    </select>
                </div>
                <div class="form-group"><label>Name</label><input name="name" required></div>
                <div class="form-group"><label>Email</label><input name="email" required></div>
                <div class="form-group"><label>Admin WhatsApp</label><input name="adminPhone" required placeholder="2782..."></div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px;">
                    <div class="form-group"><label>Premium/Fee (R)</label><input type="number" name="defaultPremium" value="150"></div>
                    <div class="form-group"><label>Platform Sub Fee (R)</label><input type="number" name="subscriptionFee" value="0"></div>
                </div>
                <div class="form-group"><label>Gateway/PayNow Code</label><input name="subaccount"></div>
                <button class="btn btn-primary" style="width:100%">Create Organization</button>
            </form>
        `;
        res.send(renderAdminPage('Add New Organization', content));
    });

    app.post('/admin/churches/add', async (req, res) => {
        const prefix = req.body.name.replace(/[^a-zA-Z]/g, '').substring(0,3).toUpperCase();
        const code = prefix + Math.floor(100 + Math.random()*900);
        try {
            await prisma.church.create({ 
                data: { 
                    name: req.body.name, 
                    email: req.body.email, 
                    code: code, 
                    type: req.body.type, 
                    adminPhone: req.body.adminPhone,
                    defaultPremium: parseFloat(req.body.defaultPremium), 
                    subscriptionFee: parseFloat(req.body.subscriptionFee), 
                    subaccountCode: req.body.subaccount || '' 
                } 
            });
            res.redirect('/admin/churches');
        } catch(e) { 
            res.send(renderAdminPage('Error', '', e.message)); 
        }
    });

    // 🚀 EDIT ORGANIZATION (With QR Code Generator & AI Scanner)
    app.get('/admin/churches/edit/:code', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        
        try {
            const c = await prisma.church.findUnique({ where: { code: req.params.code } });
            if (!c) throw new Error("Organization not found.");

            const qrImage = await generatePaymentQR(c.code);

            const content = `
                <div style="display:flex; flex-wrap:wrap; gap:30px; align-items:start;">
                    
                    <!-- LEFT: ORG DETAILS FORM -->
                    <div style="flex:2; min-width:300px;">
                        <form action="/admin/churches/update" method="POST" class="card-form" style="max-width:100%;">
                            <input type="hidden" name="code" value="${c.code}">
                            
                            <div class="form-group">
                                <label>Name (Locked)</label>
                                <input value="${c.name}" disabled style="background:#f0f0f0;">
                            </div>
                            <div class="form-group">
                                <label>Admin Phone</label>
                                <input name="adminPhone" value="${c.adminPhone}">
                            </div>
                            <div class="form-group">
                                <label>Email</label>
                                <input name="email" value="${c.email}">
                            </div>
                            
                            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px;">
                                <div class="form-group">
                                    <label>Premium</label>
                                    <input name="defaultPremium" value="${c.defaultPremium}">
                                </div>
                                <div class="form-group">
                                    <label>Sub Fee</label>
                                    <input name="subscriptionFee" value="${c.subscriptionFee}">
                                </div>
                            </div>
                            
                            <div class="form-group">
                                <label>Gateway Code</label>
                                <input name="subaccount" value="${c.subaccountCode||''}">
                            </div>
                            
                            <button class="btn btn-primary" style="padding:12px; width:100%;">Update Organization Details</button>
                        </form>
						<!-- 🔒 NEW SECURITY & ACCESS CARD -->
                        <div class="card-form" style="border-top: 5px solid #e74c3c; margin-top: 20px; max-width:100%;">
                            <h3 style="margin-top:0; color:#c0392b;">🔒 Security & Access</h3>
                            <p style="font-size:12px; color:#7f8c8d;">Resetting access will wipe the client's current password and MFA, and send them a new WhatsApp onboarding link.</p>
                            <button type="button" onclick="resetClientAccess('${c.code}')" class="btn btn-danger" style="width:100%; padding:12px;">Reset Password & MFA</button>
                        </div>
                    </div>

                    <!-- RIGHT: TOOLS (QR & SCANNERS) -->
                    <div style="flex:1; min-width:300px;">
                        
                        <!-- 📲 QR CODE TOOL -->
                        <div class="card-form" style="text-align:center; margin-bottom: 20px;">
                            <h3 style="margin-top:0; color:#2c3e50;">📲 Scan to Pay</h3>
                            <p style="font-size:12px; color:#95a5a6; margin-bottom:15px;">Official payment portal for <strong>${c.code}</strong></p>
                            
                            <img src="${qrImage}" style="width:100%; max-width:200px; border-radius:8px; border:4px solid #fff; box-shadow:0 2px 10px rgba(0,0,0,0.1); margin:0 auto; display:block;">
                            
                            <div style="margin-top:20px; display:flex; flex-direction:column; gap:10px;">
                                <a href="${qrImage}" download="QR_${c.code}.png" class="btn" style="background:#2d3436; color:white; width:100%; text-align:center; box-sizing:border-box;">⬇️ Download PNG</a>
                                <a href="/link/${c.code}" target="_blank" class="btn" style="background:#ecf0f1; color:#2d3436; width:100%; text-align:center; box-sizing:border-box;">🔗 Test Link</a>
                            </div>
                        </div>

                        <!-- ✨ AI MAGIC SCANNER TOOL -->
                        <div class="card-form" style="border-top: 5px solid #8e44ad;">
                            <h3 style="margin-top:0; color:#8e44ad;">✨ AI Magic Scanner</h3>
                            <p style="font-size:12px; color:#7f8c8d;">Upload a flyer or policy document. Gemini AI will extract plans and events automatically.</p>
                            
                            <input type="file" id="scannerInput" accept="image/*" style="width:100%; padding: 10px; border: 1px dashed #8e44ad; background: #f3e5f5; border-radius: 4px; box-sizing:border-box;">
                            
                            <button onclick="scanImage()" class="btn" style="width:100%; background: #8e44ad; color:white; margin-top:10px; padding:12px;">🔍 Scan Image</button>
                            
                            <div id="aiLoader" class="ai-loader">🔮 Analyzing Image with Gemini...</div>
                            
                            <div id="aiResults" class="ai-result-box"></div>
                        </div>

                    </div>
                </div>

                <script>
				
					async function resetClientAccess(code) {
                        if(!confirm("⚠️ Are you sure? This will lock the client out until they complete the new MFA setup.")) return;
                        try {
                            const res = await fetch('/api/admin/churches/reset-access', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ code: code })
                            });
                            const data = await res.json();
                            if(data.success) {
                                alert("✅ Success! " + data.message);
                            } else {
                                alert("❌ Error: " + data.error);
                            }
                        } catch(e) {
                            alert("Network error.");
                        }
                    }
					
                    async function submitOverriddenEvent(churchCode) {
                        const title = document.getElementById('aiEventTitle').value;
                        const date = document.getElementById('aiEventDate').value;
                        const price = document.getElementById('aiEventPrice').value;
                        
                        saveExtractedEventToDB({ eventName: title, date: date, price: price, churchCode: churchCode });
                    }

                    async function submitOverriddenPolicies(churchCode, count) {
                        const plans = [];
                        for(let i=0; i<count; i++) {
                            const name = document.getElementById('planName_'+i).value;
                            const price = document.getElementById('planPrice_'+i).value;
                            const benefitsStr = document.getElementById('planBenefits_'+i).value;
                            // Convert comma string back to array
                            const benefits = benefitsStr.split(',').map(b => b.trim()).filter(b => b);
                            
                            plans.push({ name, price, benefits });
                        }
                        saveExtractedPolicyToDB(churchCode, plans);
                    }

                    async function saveExtractedEventToDB(aiExtractedData) {
                        const payload = {
                            name: aiExtractedData.eventName, 
                            date: aiExtractedData.date, 
                            price: aiExtractedData.price, 
                            churchCode: aiExtractedData.churchCode 
                        };
                        try {
                            const response = await fetch('/api/admin/vision/save-event', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(payload)
                            });
                            const result = await response.json();
                            if (result.success) {
                                alert(result.message);
                                window.location.href = '/admin/' + payload.churchCode + '/events';
                            } else {
                                alert("❌ " + result.error);
                            }
                        } catch (error) {
                            alert("❌ System Error: Could not connect to database.");
                        }
                    }

                    async function saveExtractedPolicyToDB(churchCode, plans) {
                        const payload = { churchCode: churchCode, plans: plans };
                        try {
                            const response = await fetch('/api/admin/vision/save-policy', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(payload)
                            });
                            const result = await response.json();
                            if (result.success) {
                                alert(result.message);
                                window.location.reload();
                            } else {
                                alert("❌ " + result.error);
                            }
                        } catch (error) {
                            alert("❌ System Error: Could not connect to database.");
                        }
                    }

                    async function scanImage() {
                        const fileInput = document.getElementById('scannerInput');
                        const file = fileInput.files[0];
                        if (!file) return alert("Please select an image first.");

                        document.getElementById('aiLoader').style.display = 'block';
                        document.getElementById('aiResults').style.display = 'none';

                        const formData = new FormData();
                        formData.append('image', file);
                        formData.append('orgCode', '${c.code}');

                        try {
                            const res = await fetch('/api/admin/extract-image-data', { method: 'POST', body: formData });
                            const data = await res.json();
                            
                            document.getElementById('aiLoader').style.display = 'none';
                            const resultBox = document.getElementById('aiResults');
                            resultBox.style.display = 'block';

                            if (data.success && data.result) {
                                const info = data.result;
                                let html = '<strong>🎯 AI Found: ' + info.type + '</strong><br><hr style="border:0; border-top:1px solid #ddd; margin:10px 0;">';
                                
                                if (info.type === 'POLICY' && info.items) {
                                    html += '<p style="font-size:11px; color:#666;">Please review and edit the AI-extracted plans below before saving.</p>';
                                    html += '<form id="policyOverrideForm">';
                                    
                                    info.items.forEach((plan, index) => {
                                        html += '<div style="background:#fff; padding:10px; border:1px solid #eee; border-radius:4px; margin-bottom:10px;">';
                                        html += '<div style="display:grid; grid-template-columns: 2fr 1fr; gap:10px;">';
                                        html += '<div><label style="font-size:10px; color:#999;">Plan Name</label>';
                                        html += '<input type="text" id="planName_' + index + '" value="' + (plan.name || '') + '" style="width:100%; padding:5px; font-size:12px; border:1px solid #ccc; border-radius:3px;"></div>';
                                        html += '<div><label style="font-size:10px; color:#999;">Price (R)</label>';
                                        html += '<input type="number" id="planPrice_' + index + '" value="' + (plan.price || 0) + '" style="width:100%; padding:5px; font-size:12px; border:1px solid #ccc; border-radius:3px;"></div>';
                                        html += '</div>';
                                        html += '<div style="margin-top:5px;"><label style="font-size:10px; color:#999;">Benefits (Comma separated)</label>';
                                        html += '<input type="text" id="planBenefits_' + index + '" value="' + (plan.benefits || []).join(', ') + '" style="width:100%; padding:5px; font-size:11px; border:1px solid #ccc; border-radius:3px; background:#f9f9f9;"></div>';
                                        html += '</div>';
                                    });
                                    
                                    html += '<button type="button" onclick="submitOverriddenPolicies(\\'${c.code}\\', ' + info.items.length + ')" class="btn" style="width:100%; background:#27ae60; color:white; font-size:12px; padding:10px;">💾 Confirm & Save Plans</button>';
                                    html += '</form>';
                                } 
                                else if (info.type === 'EVENT') {
                                    html += '<p style="font-size:11px; color:#666;">Please review the AI-extracted event details.</p>';
                                    const safeTitle = info.title ? info.title.replace(/"/g, '&quot;') : "";
                                    
                                    html += '<form id="eventOverrideForm" style="background:#fff; padding:10px; border:1px solid #eee; border-radius:4px;">';
                                    html += '<div style="margin-bottom:8px;"><label style="font-size:10px; color:#999;">Event Title</label>';
                                    html += '<input type="text" id="aiEventTitle" value="' + safeTitle + '" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:3px; box-sizing:border-box;"></div>';
                                    html += '<div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:10px;">';
                                    html += '<div><label style="font-size:10px; color:#999;">Date (YYYY-MM-DD)</label>';
                                    html += '<input type="text" id="aiEventDate" value="' + (info.date || '') + '" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:3px; box-sizing:border-box;"></div>';
                                    html += '<div><label style="font-size:10px; color:#999;">Ticket Price (R)</label>';
                                    html += '<input type="number" id="aiEventPrice" value="' + (info.price || 0) + '" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:3px; box-sizing:border-box;"></div>';
                                    html += '</div>';
                                    html += '<button type="button" onclick="submitOverriddenEvent(\\'${c.code}\\')" class="btn" style="width:100%; background:#2980b9; color:white; font-size:12px; padding:10px;">📅 Confirm & Create Event</button>';
                                    html += '</form>';
                                }
                                else {
                                    html += '<span style="color:orange">Could not identify structured data. Please try a clearer image.</span>';
                                }
                                resultBox.innerHTML = html;
                            } else {
                                resultBox.innerHTML = '<span style="color:red">AI could not read this image.</span>';
                            }
                        } catch (e) {
                            alert("Scan Error: " + e.message);
                            document.getElementById('aiLoader').style.display = 'none';
                        }
                    }
                </script>
            `;
            res.send(renderAdminPage(`Manage: ${c.name}`, content));
        } catch(e) {
            res.send(renderAdminPage('Error', '', e.message));
        }
    });

    app.post('/admin/churches/update', async (req, res) => {
        try {
            await prisma.church.update({ 
                where: { code: req.body.code }, 
                data: { 
                    email: req.body.email, 
                    adminPhone: req.body.adminPhone, 
                    defaultPremium: parseFloat(req.body.defaultPremium), 
                    subscriptionFee: parseFloat(req.body.subscriptionFee), 
                    subaccountCode: req.body.subaccount 
                } 
            });
            res.redirect('/admin/churches');
        } catch(e) { 
            res.send(renderAdminPage('Error', '', e.message)); 
        }
    });

    // 🚀 NEW API: HANDLE IMAGE EXTRACTION (VISION)
    app.post('/api/admin/extract-image-data', upload.single('image'), async (req, res) => {
        if (!isAuthenticated(req)) return res.status(401).json({ error: "Unauthorized" });
        if (!req.file) return res.status(400).json({ error: "No image uploaded" });

        try {
            const buffer = fs.readFileSync(req.file.path);
            const result = await extractDataFromImage(buffer, req.file.mimetype);
            
            // Cleanup temp file
            try { fs.unlinkSync(req.file.path); } catch(e) {}

            res.json({ success: true, result: result });
        } catch (error) {
            console.error(error);
            res.status(500).json({ success: false, error: error.message });
        }
    });


    // ============================================================
    // 🎓 AI COURSE BUILDER (LMS)
    // ============================================================
    app.get('/admin/course-builder', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');

        try {
            const churches = await prisma.church.findMany({ select: { id: true, name: true } });
            let options = churches.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

            const courses = await prisma.course.findMany({
                include: { 
                    church: true, 
                    _count: { select: { modules: true } } 
                },
                orderBy: { id: 'desc' }
            });

            const courseRows = courses.map(c => `
                <tr>
                    <td>
                        <strong>${c.title}</strong><br>
                        <span style="font-size:11px; color:#95a5a6;">Code: ${c.code || 'N/A'}</span>
                    </td>
                    <td><span class="tag tag-church">${c.church ? c.church.name : 'Global'}</span></td>
                    <td>R${c.price}</td>
                    <td>${c._count.modules} Modules</td>
                    <td><span class="tag" style="${c.status === 'LIVE' ? 'background:#e8f5e9; color:green;' : 'background:#fff3e0; color:orange;'}">${c.status}</span></td>
                    <td style="text-align:right;">
                        <a href="/admin/course-builder/edit/${c.id}" class="btn btn-edit">Edit</a>
                        <form method="POST" action="/admin/course-builder/delete" style="display:inline; margin-left:5px;" onsubmit="return confirm('Are you sure? This cannot be undone.');">
                            <input type="hidden" name="id" value="${c.id}">
                            <button class="btn btn-danger">Del</button>
                        </form>
                    </td>
                </tr>
            `).join('');

            const content = `
                <div style="display:grid; grid-template-columns: 1fr 1.5fr; gap:30px; align-items:start;">
                    
                    <!-- UPLOAD FORM -->
                    <div class="card-form" style="max-width: 100%;">
                        <h3 style="margin-top:0;">🤖 AI Course Generator</h3>
                        <p style="color:#7f8c8d; margin-top:-10px; margin-bottom:20px; font-size:13px;">Upload a PDF curriculum. Gemini AI will convert it into a drip-feed WhatsApp course.</p>
                        
                        <form id="courseUploadForm">
                            <div class="form-group">
                                <label>Organization</label>
                                <select id="orgId" required>${options}</select>
                            </div>
                            <div class="form-group">
                                <label>Course Price (R)</label>
                                <input type="number" id="price" value="0" required>
                            </div>
                            <div class="form-group">
                                <label>Curriculum PDF</label>
                                <input type="file" id="pdfFile" accept=".pdf" required style="padding: 10px; border: 2px dashed #00d2d3; background: #fdfdfd; cursor: pointer;">
                            </div>
                            
                            <div id="statusBox" style="display:none; padding: 15px; border-radius: 5px; margin-top: 15px; font-weight: bold; text-align: center;"></div>

                            <button type="submit" id="submitBtn" class="btn btn-primary" style="width:100%; margin-top: 10px; padding: 15px; font-size: 14px;">
                                Parse & Generate Course
                            </button>
                        </form>
                    </div>

                    <!-- COURSE LIST -->
                    <div>
                        <div class="card-form" style="max-width: 100%;">
                            <h3 style="margin-top:0;">📚 Active Courses</h3>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Course</th>
                                        <th>Org</th>
                                        <th>Price</th>
                                        <th>Content</th>
                                        <th>Status</th>
                                        <th style="text-align:right;">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${courseRows.length > 0 ? courseRows : '<tr><td colspan="6" style="text-align:center; padding:30px; color:#95a5a6;">No courses found. Generate one to get started.</td></tr>'}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <script>
                    document.getElementById('courseUploadForm').addEventListener('submit', async (e) => {
                        e.preventDefault();
                        const btn = document.getElementById('submitBtn');
                        const status = document.getElementById('statusBox');
                        
                        btn.innerText = "⏳ AI is reading the PDF (10-20s)...";
                        btn.disabled = true;
                        btn.style.opacity = "0.7";
                        status.style.display = 'none';

                        const formData = new FormData();
                        formData.append('orgId', document.getElementById('orgId').value);
                        formData.append('price', document.getElementById('price').value);
                        formData.append('coursePdf', document.getElementById('pdfFile').files[0]);

                        try {
                            const res = await fetch('/api/admin/parse-course', { method: 'POST', body: formData });
                            const data = await res.json();
                            
                            if (data.success) {
                                status.style.background = "#e8f5e9";
                                status.style.color = "#27ae60";
                                status.style.border = "1px solid #27ae60";
                                status.innerHTML = "✅ <strong>Success!</strong><br>Course generated.";
                                document.getElementById('courseUploadForm').reset();
                                setTimeout(() => window.location.reload(), 2000);
                            } else {
                                throw new Error(data.error);
                            }
                        } catch (err) {
                            status.style.background = "#ffebee";
                            status.style.color = "#c0392b";
                            status.style.border = "1px solid #c0392b";
                            status.innerText = "❌ Error: " + err.message;
                        } finally {
                            btn.innerText = "Parse & Generate Course";
                            btn.disabled = false;
                            btn.style.opacity = "1";
                            status.style.display = 'block';
                        }
                    });
                </script>
            `;

            res.send(renderAdminPage('AI Course Builder', content));
        } catch (e) {
            res.send(renderAdminPage('AI Course Builder', '', e.message));
        }
    });

    app.get('/admin/course-builder/edit/:id', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        
        try {
            const course = await prisma.course.findUnique({
                where: { id: parseInt(req.params.id) },
                include: { 
                    church: true, 
                    modules: { orderBy: { order: 'asc' } }
                }
            });

            if (!course) throw new Error("Course not found");

            const moduleList = course.modules.map(m => `
                <div style="background:#f8f9fa; padding:10px; margin-bottom:5px; border-left:3px solid #00d2d3; display:flex; justify-content:space-between; align-items:center;">
                    <div style="flex:1;">
                        <span style="font-weight:bold; font-size:12px; color:#95a5a6; display:block;">DAY ${m.order}</span>
                        <span style="font-weight:bold;">${m.title}</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span style="font-size:11px; background:#eee; padding:2px 6px; border-radius:4px;">${m.type}</span>
                        <a href="/admin/course-builder/module/edit/${m.id}" class="btn btn-edit" style="font-size:11px; padding:4px 8px;">Edit Content</a>
                    </div>
                </div>
            `).join('');

            const content = `
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:30px;">
                    <div class="card-form" style="max-width:100%;">
                        <h3>✏️ Edit Course Details</h3>
                        <form action="/admin/course-builder/update" method="POST">
                            <input type="hidden" name="id" value="${course.id}">
                            
                            <div class="form-group">
                                <label>Course Title</label>
                                <input name="title" value="${course.title}" required>
                            </div>
                            
                            <div class="form-group">
                                <label>Description</label>
                                <textarea name="description" rows="4">${course.description || ''}</textarea>
                            </div>

                            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px;">
                                <div class="form-group">
                                    <label>Price (ZAR)</label>
                                    <input type="number" name="price" value="${course.price}" required>
                                </div>
                                <div class="form-group">
                                    <label>Status</label>
                                    <select name="status">
                                        <option value="DRAFT" ${course.status === 'DRAFT' ? 'selected' : ''}>Draft (Hidden)</option>
                                        <option value="LIVE" ${course.status === 'LIVE' ? 'selected' : ''}>Live (Visible)</option>
                                        <option value="ARCHIVED" ${course.status === 'ARCHIVED' ? 'selected' : ''}>Archived</option>
                                    </select>
                                </div>
                            </div>

                            <button class="btn btn-save" style="width:100%; padding:12px;">Save Changes</button>
                            <a href="/admin/course-builder" class="btn" style="background:#ecf0f1; color:#333; width:100%; text-align:center; box-sizing:border-box; margin-top:10px;">Cancel</a>
                        </form>
                    </div>

                    <div class="card-form" style="max-width:100%;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                            <h3 style="margin:0;">📦 Modules (${course.modules.length})</h3>
                        </div>
                        <div style="max-height: 500px; overflow-y: auto;">
                            ${moduleList || '<p style="color:#999; text-align:center;">No modules found.</p>'}
                        </div>
                    </div>
                </div>
            `;

            res.send(renderAdminPage(`Edit: ${course.title}`, content));
        } catch (e) {
            res.send(renderAdminPage('Error', '', e.message));
        }
    });

    app.get('/admin/course-builder/module/edit/:moduleId', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        try {
            const m = await prisma.module.findUnique({ where: { id: parseInt(req.params.moduleId) } });
            if (!m) throw new Error("Module not found");

            const content = `
                <div class="card-form" style="max-width:700px; margin:0 auto;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; border-bottom:1px solid #eee; padding-bottom:15px;">
                        <h3 style="margin:0;">📝 Edit Module: Day ${m.order}</h3>
                        <a href="/admin/course-builder/edit/${m.courseId}" style="color:#7f8c8d; text-decoration:none; font-size:13px; font-weight:bold;">&larr; Back to Course</a>
                    </div>

                    <form action="/admin/course-builder/module/update" method="POST">
                        <input type="hidden" name="id" value="${m.id}">
                        <input type="hidden" name="courseId" value="${m.courseId}">
                        
                        <div style="display:grid; grid-template-columns: 100px 1fr; gap:15px;">
                            <div class="form-group">
                                <label>Day #</label>
                                <input type="number" name="order" value="${m.order}" required>
                            </div>
                            <div class="form-group">
                                <label>Module Title</label>
                                <input name="title" value="${m.title}" required>
                            </div>
                        </div>

                        <div class="form-group">
                            <label>WhatsApp Message Body</label>
                            <p style="font-size:11px; color:#999; margin-top:-5px;">This is the actual text sent to the user on WhatsApp.</p>
                            <textarea name="dailyLessonText" rows="12" style="font-family:monospace; font-size:13px; line-height:1.5; background:#fafafa;">${m.dailyLessonText || m.content || ''}</textarea>
                        </div>

                        <div class="form-group" style="background:#fffbe6; padding:15px; border-radius:6px; border:1px solid #ffe58f; margin-top:20px;">
                            <label style="color:#d48806;">🧠 Quiz (Optional)</label>
                            <div style="margin-top:10px;">
                                <label style="font-size:10px;">Question</label>
                                <input name="quizQuestion" value="${m.quizQuestion || ''}" placeholder="e.g. What is the main takeaway?">
                            </div>
                            <div style="margin-top:10px;">
                                <label style="font-size:10px;">Correct Answer (AI Checked)</label>
                                <textarea name="quizAnswer" rows="2" placeholder="e.g. The main takeaway is...">${m.quizAnswer || ''}</textarea>
                            </div>
                        </div>

                        <div class="form-group" style="background:#f0f9ff; padding:15px; border-radius:6px; border:1px solid #bae6fd; margin-top:20px;">
                            <label style="color:#0284c7;">📎 Media Attachment (Optional)</label>
                            <div style="display:grid; grid-template-columns: 1fr 2fr; gap:15px; margin-top:10px;">
                                <div>
                                    <label style="font-size:10px;">Type</label>
                                    <select name="type">
                                        <option value="TEXT" ${m.type === 'TEXT' ? 'selected' : ''}>Text Only (No Media)</option>
                                        <option value="PDF" ${m.type === 'PDF' ? 'selected' : ''}>PDF Document</option>
                                        <option value="VIDEO" ${m.type === 'VIDEO' ? 'selected' : ''}>Video Link</option>
                                        <option value="IMAGE" ${m.type === 'IMAGE' ? 'selected' : ''}>Image</option>
                                        <option value="AUDIO" ${m.type === 'AUDIO' ? 'selected' : ''}>Audio Note</option>
                                    </select>
                                </div>
                                <div>
                                    <label style="font-size:10px;">URL (Cloudinary / Public Link)</label>
                                    <input name="contentUrl" value="${m.contentUrl || ''}" placeholder="https://...">
                                </div>
                            </div>
                        </div>

                        <div style="display:flex; gap:10px; margin-top:30px;">
                            <button class="btn btn-save" style="flex:1; padding:12px;">Save Changes</button>
                            <button type="button" onclick="deleteModule()" class="btn btn-danger" style="padding:12px;">Delete Module</button>
                        </div>
                    </form>

                    <form id="delForm" action="/admin/course-builder/module/delete" method="POST" style="display:none;">
                        <input type="hidden" name="id" value="${m.id}">
                        <input type="hidden" name="courseId" value="${m.courseId}">
                    </form>

                    <script>
                        function deleteModule() {
                            if(confirm('⚠️ Are you sure? This will delete this specific day/module from the course.')) {
                                document.getElementById('delForm').submit();
                            }
                        }
                    </script>
                </div>
            `;
            res.send(renderAdminPage(`Edit Module`, content));
        } catch (e) {
            res.send(renderAdminPage('Error', '', e.message));
        }
    });

    app.post('/admin/course-builder/update', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        try {
            await prisma.course.update({
                where: { id: parseInt(req.body.id) },
                data: {
                    title: req.body.title,
                    description: req.body.description,
                    price: parseFloat(req.body.price),
                    status: req.body.status
                }
            });
            res.redirect('/admin/course-builder');
        } catch (e) {
            res.send(renderAdminPage('Update Error', '', e.message));
        }
    });

    app.post('/admin/course-builder/delete', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        try {
            await prisma.course.delete({ where: { id: parseInt(req.body.id) } });
            res.redirect('/admin/course-builder');
        } catch (e) {
            res.send(renderAdminPage('Delete Error', '', e.message));
        }
    });

    app.post('/admin/course-builder/module/update', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        try {
            await prisma.module.update({
                where: { id: parseInt(req.body.id) },
                data: {
                    title: req.body.title,
                    order: parseInt(req.body.order),
                    dailyLessonText: req.body.dailyLessonText,
                    content: req.body.dailyLessonText, 
                    quizQuestion: req.body.quizQuestion,
                    quizAnswer: req.body.quizAnswer,
                    type: req.body.type,
                    contentUrl: req.body.contentUrl
                }
            });
            res.redirect(`/admin/course-builder/edit/${req.body.courseId}`);
        } catch (e) {
            res.send(renderAdminPage('Update Error', '', e.message));
        }
    });

    app.post('/admin/course-builder/module/delete', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        try {
            await prisma.module.delete({ where: { id: parseInt(req.body.id) } });
            res.redirect(`/admin/course-builder/edit/${req.body.courseId}`);
        } catch (e) {
            res.send(renderAdminPage('Delete Error', '', e.message));
        }
    });

    app.post('/api/admin/parse-course', upload.single('coursePdf'), async (req, res) => {
        const cookies = parseCookies(req);
        if (cookies[COOKIE_NAME] !== ADMIN_SECRET) return res.status(401).json({ success: false, error: "Unauthorized" });
        if (!req.file) return res.status(400).json({ success: false, error: "No PDF uploaded." });
        
        try {
            const pdfBuffer = fs.readFileSync(req.file.path);
            const result = await processAndImportCoursePDF(pdfBuffer, req.file.mimetype, req.body.orgId, req.body.price);
            
            try { fs.unlinkSync(req.file.path); } catch (e) {}
            
            if (result.success) {
                res.json(result);
            } else {
                res.status(500).json(result);
            }
        } catch (err) {
            res.status(500).json({ success: false, error: "Failed to read file on server." });
        }
    });

    // ============================================================
    // 🛡️ FICA & COMPLIANCE DASHBOARD
    // ============================================================
    app.get('/admin/fica', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');

        try {
            const allChurches = await prisma.church.findMany({ orderBy: { createdAt: 'desc' } });

            const docLink = (url, label) => url 
                ? `<a href="${url}" target="_blank" style="background:#ecf0f1; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:bold; text-decoration:none; color:#2c3e50; margin-right:5px; display:inline-block; margin-bottom:4px;">📄 ${label}</a>` 
                : `<span style="color:#bdc3c7; font-size:11px; margin-right:5px;">No ${label}</span>`;

            const rowsHtml = allChurches.map(c => {
                let actionBtn = '';
                let statusBadge = '';
                
                if (c.ficaStatus === 'LEVEL_1_PENDING') {
                    statusBadge = `<span class="tag" style="background:#fff3e0; color:#e67e22; border:1px solid #e67e22;">Level 1 Pending</span>`;
                    actionBtn = `<button onclick="approveLevel1(${c.id})" class="btn" style="background:#e67e22; color:white; font-size:11px;">Approve L1</button>`;
                } 
                else if (c.ficaStatus === 'AWAITING_LEVEL_2') {
                    statusBadge = `<span class="tag" style="background:#e3f2fd; color:#3498db; border:1px solid #3498db;">Awaiting L2 Docs</span>`;
                    actionBtn = `<span style="font-size:11px; color:#7f8c8d; font-style:italic;">Waiting on Client</span>`;
                }
                else if (c.ficaStatus === 'LEVEL_2_PENDING') {
                    statusBadge = `<span class="tag" style="background:#f3e5f5; color:#8e44ad; border:1px solid #8e44ad;">Level 2 Pending</span>`;
                    actionBtn = `<button onclick="approveFinal(${c.id})" class="btn" style="background:#8e44ad; color:white; font-size:11px;">Approve Final</button>`;
                }
                else if (c.ficaStatus === 'ACTIVE') {
                    statusBadge = `<span class="tag" style="background:#e8f5e9; color:#27ae60; border:1px solid #27ae60;">✅ Active</span>`;
                    actionBtn = `<span style="font-size:12px; color:#27ae60; font-weight:bold;">Verified</span>`;
                } else {
                    statusBadge = `<span class="tag" style="background:#f1f2f6; color:#7f8c8d;">${c.ficaStatus || 'UNKNOWN'}</span>`;
                }

                return `
                <tr>
                    <td>
                        <strong>${c.name}</strong><br>
                        <span style="font-size:11px; color:#7f8c8d;">${c.code} | ${c.officialEmail || c.email || 'No Email'}</span>
                    </td>
                    <td>${statusBadge}</td>
                    <td>
                        <div style="margin-bottom:5px;">
                            <strong style="font-size:10px; color:#95a5a6; text-transform:uppercase;">Level 1:</strong><br>
                            ${docLink(c.pastorIdUrl, 'Pastor ID')}
                            ${docLink(c.proofOfBankUrl, 'Bank Proof')}
                        </div>
                        <div>
                            <strong style="font-size:10px; color:#95a5a6; text-transform:uppercase;">Level 2:</strong><br>
                            ${docLink(c.npcRegUrl, 'NPC Cert')}
                            ${docLink(c.cipcDocUrl, 'CIPC')}
                            ${docLink(c.directorIdsUrl, 'Directors')}
                        </div>
                    </td>
                    <td style="text-align:right;">${actionBtn}</td>
                </tr>`;
            }).join('');

            const content = `
                <p style="color:#7f8c8d; margin-top:-20px; margin-bottom:20px;">Review organizational documents and trigger NetCash KYB onboarding.</p>
                <table>
                    <thead>
                        <tr>
                            <th>Organization</th>
                            <th>FICA Status</th>
                            <th>Vaulted Documents</th>
                            <th style="text-align:right;">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml || '<tr><td colspan="4" style="text-align:center; padding:30px; color:#95a5a6;">No organizations found.</td></tr>'}
                    </tbody>
                </table>

                <script>
                    async function approveLevel1(churchId) {
                        if(!confirm("Approve Level 1 FICA? This will trigger an email asking them for their corporate documents.")) return;
                        try {
                            const res = await fetch('/api/prospect/admin/approve-level-1', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ churchId })
                            });
                            const data = await res.json();
                            if(!res.ok) throw new Error(data.error);
                            alert("✅ " + data.message);
                            window.location.reload();
                        } catch (e) { alert("❌ Error: " + e.message); }
                    }

                    async function approveFinal(churchId) {
                        if(!confirm("Approve Final FICA? This will authorize the NetCash Sub-Account creation.")) return;
                        try {
                            const res = await fetch('/api/prospect/admin/approve-final', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ churchId })
                            });
                            const data = await res.json();
                            if(!res.ok) throw new Error(data.error);
                            alert("🚀 " + data.message + "\\nNetCash ID: " + data.netCashAccountId);
                            window.location.reload();
                        } catch (e) { alert("❌ Error: " + e.message); }
                    }
                </script>
            `;

            res.send(renderAdminPage('FICA Verifications', content));

        } catch (error) {
            res.send(renderAdminPage('FICA Verifications', '', error.message));
        }
    });

	app.post('/api/prospect/admin/approve-level-1', async (req, res) => {
        if (!isAuthenticated(req)) return res.status(401).json({ error: "Unauthorized" });
        
        try {
            // 1. Generate a secure, one-time setup token
            const crypto = require('crypto');
            const token = crypto.randomBytes(20).toString('hex');
            
            // 2. Update the DB
            const org = await prisma.church.update({ 
                where: { id: parseInt(req.body.churchId) }, 
                data: { ficaStatus: 'AWAITING_LEVEL_2', setupToken: token } 
            });

            // 3. Format the setup link
            const setupLink = `https://${req.get('host')}/org/setup/${token}`;
            const msg = `🟢 *Seabe Digital KYC*\n\nCongratulations! ${org.name} has passed Level 1 Compliance.\n\nTo securely access your Customer Admin Dashboard, please click below to set your password and 2FA:\n\n🔗 ${setupLink}`;

            // 4. Clean the phone number and send using your central WhatsApp service
            let cleanPhone = org.adminPhone.replace(/\D/g, '');
            if (cleanPhone.startsWith('0')) cleanPhone = '27' + cleanPhone.substring(1);
            
            await sendWhatsApp(cleanPhone, msg);

            res.json({ message: "Level 1 Approved. Onboarding WhatsApp sent to Customer Admin." });
        } catch (e) { 
            console.error("KYC Approval Error:", e);
            res.status(500).json({ error: e.message }); 
        }
    });

    app.post('/api/prospect/admin/approve-final', async (req, res) => {
        if (!isAuthenticated(req)) return res.status(401).json({ error: "Unauthorized" });
        try {
            const org = await prisma.church.findUnique({ where: { id: parseInt(req.body.churchId) } });
            const netcashData = {
                name: org.name,
                adminName: org.contactPerson || 'Admin',
                email: org.officialEmail || org.email || 'admin@seabe.tech',
                phone: org.adminPhone || org.phone || '0000000000',
                bankName: org.bankName || 'Standard Bank', 
                branchCode: org.branchCode || '051001',
                accountNumber: org.accountNumber || '0000000000'
            };
            const netcash = await provisionNetCashAccount(netcashData);
            
            await prisma.church.update({ 
                where: { id: org.id }, 
                data: { 
                    ficaStatus: 'ACTIVE', 
                    netcashMerchantId: netcash.MerchantId, 
                    netcashPayNowKey: netcash.PayNowKey, 
                    subaccountCode: netcash.PayNowKey 
                } 
            });
            res.json({ message: "KYB Finalized!", netCashAccountId: netcash.MerchantId });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ============================================================
    // 🏷️ PRICING ENGINE
    // ============================================================
    app.get('/admin/pricing', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');

        try {
            const { loadPrices } = require('../services/pricing');
            await loadPrices(); 

            // 👇 1. AUTO-INJECTOR: Force missing variables into the DB so they appear in UI
            const requiredVariables = [
                { code: 'MOD_STANDARD_PERCENTAGE', amount: 0.01 },
                { code: 'MOD_STANDARD_FLAT', amount: 1.00 }
            ];

            for (const item of requiredVariables) {
                const exists = await prisma.servicePrice.findUnique({ where: { code: item.code } });
                if (!exists) {
                    await prisma.servicePrice.create({ data: item });
                }
            }
            // 👆 END AUTO-INJECTOR

            const allPrices = await prisma.servicePrice.findMany({ orderBy: { code: 'asc' } });
            
            const makeRows = (data) => data.map(p => `
                <tr>
                    <td><span class="tag" style="background:#edf2f7; color:#2d3748; font-family:monospace; border:none;">${p.code}</span></td>
                    <td>
                        <form action="/admin/pricing/update" method="POST" style="display:flex; gap:8px; margin:0;">
                            <input type="hidden" name="code" value="${p.code}">
                            <input type="number" step="0.0001" name="amount" value="${Number(p.amount)}" style="width:90px; text-align:right; border:1px solid #cbd5e0; border-radius:4px; padding:4px;">
                            <button type="submit" class="btn btn-primary" style="padding:4px 8px; font-size:11px; background:#1e272e;">Save</button>
                        </form>
                    </td>
                </tr>
            `).join('');

            const platformFees = allPrices.filter(p => !p.code.startsWith('TX_') && !p.code.startsWith('MOD_'));
            const txVars = allPrices.filter(p => p.code.startsWith('TX_') || p.code.startsWith('MOD_'));

            const content = `
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:30px;">
                    <div class="card-form" style="max-width:100%;">
                        <h3 style="margin-top:0;">🛡️ Fixed Service Fees</h3>
                        <table><thead><tr><th>Code</th><th>Amount</th></tr></thead><tbody>${makeRows(platformFees)}</tbody></table>
                    </div>
                    <div class="card-form" style="max-width:100%;">
                        <h3 style="margin-top:0;">💳 Variables</h3>
                        <table><thead><tr><th>Code</th><th>Variable</th></tr></thead><tbody>${makeRows(txVars)}</tbody></table>
                    </div>
                </div>
            `;
            res.send(renderAdminPage('Pricing Engine', content));
        } catch (e) { res.send(renderAdminPage('Pricing Error', '', e.message)); }
    });

    app.post('/admin/pricing/update', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        try {
            // 1. Fetch the OLD value first so we can log it!
            const oldPriceRecord = await prisma.servicePrice.findUnique({ where: { code: req.body.code } });
            const oldAmount = oldPriceRecord ? oldPriceRecord.amount : 0;

            // 2. Update the DB with the NEW value
            await prisma.servicePrice.update({ 
                where: { code: req.body.code }, 
                data: { amount: parseFloat(req.body.amount) } 
            });
            
            // 3. Log the action securely
            await logAction({
                actorId: 'admin', // Only the Super Admin can reach this route
                role: 'SUPER_ADMIN',
                action: 'UPDATE_FEE',
                entity: 'ServicePrice',
                entityId: req.body.code,
                metadata: { oldVal: oldAmount, newVal: parseFloat(req.body.amount) },
                ipAddress: req.ip
            });

            // 4. Finally, redirect the user
            res.redirect('/admin/pricing');
        } catch (e) { 
            res.send(renderAdminPage('Pricing Error', '', e.message)); 
        }
    });

    // ============================================================
    // 6. GLOBAL COLLECTIONS
    // ============================================================
    app.get('/admin/global-collections', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        try {
            const groups = await prisma.collection.groupBy({ 
                by: ['churchCode', 'status'], 
                _sum: { amount: true }, 
                _count: { id: true } 
            });
            const rows = groups.map(g => `
                <tr>
                    <td>${g.churchCode}</td>
                    <td>${g.status}</td>
                    <td>${g._count.id}</td>
                    <td>R${g._sum.amount?.toFixed(2)||0}</td>
                </tr>
            `).join('');

            const content = `
                <div class="card-form" style="max-width:100%;">
                    <h3>Debt Recovery by Organization</h3>
                    <table>
                        <thead><tr><th>Org Code</th><th>Status</th><th>Count</th><th>Total Value</th></tr></thead>
                        <tbody>${rows || '<tr><td colspan="4">No collections yet.</td></tr>'}</tbody>
                    </table>
                </div>
            `;
            res.send(renderAdminPage('Global Debt Stats', content));
        } catch(e) { res.send(renderAdminPage('Error', '', e.message)); }
    });
    
    // ============================================================
    // 💸 PAYOUTS & SETTLEMENTS
    // ============================================================
    app.get('/admin/payouts', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');

        try {
            const pendingPayoutsRaw = await prisma.transaction.groupBy({
                by: ['churchCode'],
                where: { 
                    status: 'SUCCESS', 
                    payoutId: null     
                },
                _sum: {
                    amount: true,        
                    platformFee: true,   
                    netcashFee: true,    
                    netSettlement: true  
                },
                _count: { id: true }
            });

            const pendingPayouts = await Promise.all(pendingPayoutsRaw.map(async (p) => {
                const church = await prisma.church.findUnique({ where: { code: p.churchCode } });
                return { ...p, church };
            }));

            const payoutHistory = await prisma.payoutLog.findMany({
                orderBy: { createdAt: 'desc' },
                take: 20
            });

            const pendingRows = pendingPayouts.map(p => {
                const amountOwed = p._sum.netSettlement || 0;
                if (amountOwed <= 0) return ''; 

                return `
                    <tr>
                        <td>
                            <strong>${p.church?.name || p.churchCode}</strong><br>
                            <span style="font-size:11px; color:#7f8c8d;">Code: ${p.churchCode} | Bank: ${p.church?.bankName || 'Unknown'} (${p.church?.accountNumber || 'N/A'})</span>
                        </td>
                        <td>${p._count.id}</td>
                        <td>
                            R${(p._sum.amount || 0).toFixed(2)}<br>
                            <span style="font-size:10px; color:#c0392b;">- R${(p._sum.platformFee || 0).toFixed(2)} (Seabe)</span><br>
                            <span style="font-size:10px; color:#c0392b;">- R${(p._sum.netcashFee || 0).toFixed(2)} (Netcash)</span>
                        </td>
                        <td style="font-weight:bold; color:#27ae60; font-size:16px;">
                            R${amountOwed.toFixed(2)}
                        </td>
                        <td style="text-align:right;">
                            <form action="/admin/payouts/process" method="POST" onsubmit="return confirm('Confirm you have EFT\\'d exactly R${amountOwed.toFixed(2)} to ${p.churchCode}?');">
                                <input type="hidden" name="churchCode" value="${p.churchCode}">
                                <input type="hidden" name="amount" value="${amountOwed}">
                                <input type="hidden" name="txCount" value="${p._count.id}">
                                <button type="submit" class="btn" style="background:#27ae60; color:white; font-size:11px; padding:6px 12px;">Mark as Paid</button>
                            </form>
                        </td>
                    </tr>
                `;
            }).join('');

            const historyRows = payoutHistory.map(h => `
                <tr>
                    <td>${new Date(h.createdAt).toLocaleDateString()}</td>
                    <td><strong>${h.churchCode}</strong></td>
                    <td>${h.txCount}</td>
                    <td style="font-weight:bold;">R${h.amount.toFixed(2)}</td>
                    <td><span class="tag" style="background:#e8f5e9; color:#27ae60;">${h.status}</span></td>
                    <td><span style="font-size:11px; font-family:monospace; color:#95a5a6;">${h.reference}</span></td>
                </tr>
            `).join('');

            const content = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h2 style="margin:0; color:#2c3e50;">💸 Organization Payouts & Settlements</h2>
                    <span style="font-size:12px; color:#7f8c8d;">PASA Directive 1 (TPPP) Compliant Ledger</span>
                </div>

                <div class="card-form" style="max-width:100%; margin-bottom:30px; border-top:4px solid #27ae60;">
                    <h3 style="margin-top:0;">⏳ Pending Settlements</h3>
                    <p style="font-size:13px; color:#666;">These funds have cleared Netcash and are ready to be transferred to the Organization's bank account.</p>
                    
                    <table>
                        <thead>
                            <tr>
                                <th>Organization</th>
                                <th>Unpaid TXs</th>
                                <th>Gross & Fees</th>
                                <th>Net Payout Owed</th>
                                <th style="text-align:right;">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${pendingRows || '<tr><td colspan="5" style="text-align:center; padding:30px; color:#95a5a6;">No pending payouts. All caught up!</td></tr>'}
                        </tbody>
                    </table>
                </div>

                <div class="card-form" style="max-width:100%;">
                    <h3 style="margin-top:0;">📜 Recent Payout History</h3>
                    <table>
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Org Code</th>
                                <th>TX Count</th>
                                <th>Amount Paid</th>
                                <th>Status</th>
                                <th>Audit Ref</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${historyRows || '<tr><td colspan="6" style="text-align:center; padding:30px; color:#95a5a6;">No payout history found.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            `;

            res.send(renderAdminPage('Church Payouts', content));
        } catch (e) {
            res.send(renderAdminPage('Payouts Error', '', e.message));
        }
    });

    app.post('/admin/payouts/process', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        
        try {
            const { churchCode, amount, txCount } = req.body;
            const payoutAmount = parseFloat(amount);
            const payoutRef = `PAY-${churchCode}-${Date.now().toString().slice(-6)}`;

            const payoutLog = await prisma.payoutLog.create({
                data: {
                    churchCode: churchCode,
                    amount: payoutAmount,
                    txCount: parseInt(txCount),
                    reference: payoutRef,
                    status: 'COMPLETED',
                    adminId: 'admin'
                }
            });

            await prisma.transaction.updateMany({
                where: { 
                    churchCode: churchCode,
                    status: 'SUCCESS',
                    payoutId: null
                },
                data: {
                    payoutId: payoutLog.id
                }
            });

            await logAction({
                actorId: 'admin',
                role: 'SUPER_ADMIN',
                action: 'PROCESS_PAYOUT',
                entity: 'PayoutLog',
                entityId: String(payoutLog.id),
                metadata: { churchCode, amount: payoutAmount, reference: payoutRef },
                ipAddress: req.ip
            });

            // 👉 Trigger WhatsApp Remittance Blast to Treasurer
            sendRemittanceAdvice(payoutLog.id);

            res.redirect('/admin/payouts');
        } catch (e) {
            res.send(renderAdminPage('Payout Processing Error', '', e.message));
        }
    });

    // ============================================================
    // 🌍 GLOBAL RADAR
    // ============================================================
    app.get('/admin/global-radar', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        
        const content = `
            <style>
                .main { padding: 0 !important; }
            </style>
            <iframe 
                src="/crm/global-radar.html" 
                style="width: 100%; height: 100vh; border: none;"
                title="Global Radar">
            </iframe>
        `;
        res.send(renderAdminPage('Global Radar', content));
    });

    // ============================================================
    // ⚖️ REGULATORY COMPLIANCE & LSO DASHBOARD
    // ============================================================
    app.get('/admin/compliance', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');

        try {
            const txStats = await prisma.transaction.aggregate({
                _sum: { amount: true },
                _count: { id: true },
                where: { status: 'SUCCESS' }
            });

            const totalVolume = txStats._sum.amount || 0;
            const totalTx = txStats._count.id || 0;
            const activeMandates = await prisma.member.count({ where: { status: 'ACTIVE_DEBIT_ORDER' } });
            const kybOrgs = await prisma.church.count({ where: { ficaStatus: 'ACTIVE' } });

            const legalValProg = Math.min((totalVolume / 10000000) * 100, 100).toFixed(1);
            const legalCntProg = Math.min((totalTx / 10000) * 100, 100).toFixed(1);
            
            const goalValProg = Math.min((totalVolume / 50000000) * 100, 100).toFixed(1);
            const goalCntProg = Math.min((totalTx / 50000) * 100, 100).toFixed(1);

            const recentTxs = await prisma.transaction.findMany({
                orderBy: { date: 'desc' },
                take: 50,
                include: { complianceLog: true }
            });

            const txRowsHtml = recentTxs.map(t => {
                const riskColor = t.complianceLog?.status === 'FLAGGED' ? '#e74c3c' : (t.complianceLog?.status === 'CLEARED' ? '#27ae60' : (t.complianceLog?.status === 'BLOCKED' ? '#000' : '#f39c12'));
                const riskLabel = t.complianceLog?.status || 'UNCHECKED';

                return `
                    <tr>
                        <td>${t.churchCode}</td>
                        <td>R${t.amount}</td>
                        <td><span class="badge" style="background:${riskColor}; color:white; padding:4px 8px; border-radius:4px; font-size:11px;">${riskLabel}</span></td>
                        <td>${new Date(t.date).toLocaleString()}</td>
                        <td><a href="/admin/compliance/review/${t.id}" class="btn-del" style="background:#3498db; color:white; padding:4px 8px; text-decoration:none; border-radius:4px;">Review</a></td>
                    </tr>
                `;
            }).join('');

            const content = `
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:20px; margin-bottom: 30px;">
                    <div style="background:white; padding:20px; border-radius:8px; border-top: 4px solid #3498db; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
                        <h4 style="margin:0; color:#7f8c8d; font-size:12px; text-transform:uppercase;">Value Processed</h4>
                        <h2 style="margin:10px 0 0 0; color:#2c3e50;">R ${totalVolume.toLocaleString('en-ZA')}</h2>
                    </div>
                    <div style="background:white; padding:20px; border-radius:8px; border-top: 4px solid #2ecc71; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
                        <h4 style="margin:0; color:#7f8c8d; font-size:12px; text-transform:uppercase;">Volume (Tx Count)</h4>
                        <h2 style="margin:10px 0 0 0; color:#2c3e50;">${totalTx.toLocaleString()}</h2>
                    </div>
                    <div style="background:white; padding:20px; border-radius:8px; border-top: 4px solid #f39c12; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
                        <h4 style="margin:0; color:#7f8c8d; font-size:12px; text-transform:uppercase;">Active DebiCheck</h4>
                        <h2 style="margin:10px 0 0 0; color:#2c3e50;">${activeMandates}</h2>
                    </div>
                    <div style="background:white; padding:20px; border-radius:8px; border-top: 4px solid #9b59b6; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
                        <h4 style="margin:0; color:#7f8c8d; font-size:12px; text-transform:uppercase;">Verified Partners</h4>
                        <h2 style="margin:10px 0 0 0; color:#2c3e50;">${kybOrgs}</h2>
                    </div>
                </div>

                <div class="card-form" style="max-width:100%; margin-bottom:30px; border-left: 5px solid #e67e22; background: #fffaf0;">
                    <h3 style="margin-top:0; color:#d35400;">⚠️ Regulatory Compliance (LSO Tripwires)</h3>
                    <p style="color:#7f8c8d; font-size:13px;">Thresholds requiring formal System Operator licensing per PASA Directive 2.</p>
                    
                    <div style="margin-bottom:15px;">
                        <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:bold; margin-bottom:5px;">
                            <span>VALUE (Target: R10M)</span>
                            <span>${legalValProg}%</span>
                        </div>
                        <div style="background:#ddd; border-radius:10px; height:12px; width:100%; overflow:hidden;">
                            <div style="background:#e67e22; width:${legalValProg}%; height:100%; transition:1s;"></div>
                        </div>
                    </div>

                    <div style="margin-bottom:5px;">
                        <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:bold; margin-bottom:5px;">
                            <span>VOLUME (Target: 10,000 tx)</span>
                            <span>${legalCntProg}%</span>
                        </div>
                        <div style="background:#ddd; border-radius:10px; height:12px; width:100%; overflow:hidden;">
                            <div style="background:#d35400; width:${legalCntProg}%; height:100%; transition:1s;"></div>
                        </div>
                    </div>
                </div>
                
                <div class="card-form" style="max-width:100%;">
                    <h3 style="margin-top:0;">🛡️ Recent Transactions (Real-Time Screening)</h3>
                    <table>
                        <thead>
                            <tr>
                                <th>Org Code</th>
                                <th>Amount</th>
                                <th>Risk Status</th>
                                <th>Date</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${txRowsHtml.length > 0 ? txRowsHtml : '<tr><td colspan="5" style="text-align:center;">No recent transactions.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            `;

            res.send(renderAdminPage('Regulatory Compliance', content));
        } catch (error) {
            res.send(renderAdminPage('Regulatory Compliance', '', error.message));
        }
    });

    // ============================================================
    // 🔍 COMPLIANCE REVIEW UI
    // ============================================================
    app.get('/admin/compliance/review/:id', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        
        try {
            const tx = await prisma.transaction.findUnique({
                where: { id: parseInt(req.params.id) },
                include: { complianceLog: true, member: true, church: true }
            });

            if (!tx || !tx.complianceLog) throw new Error("Transaction or Compliance Log not found.");

            const log = tx.complianceLog;
            const isFlagged = log.status === 'FLAGGED';
            
            const content = `
                <div style="max-width: 800px; margin: 0 auto;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                        <h2 style="margin:0; color:#2c3e50;">🔍 Compliance Review</h2>
                        <a href="/admin/compliance" class="btn" style="background:#dfe6e9; color:#2d3436;">&larr; Back to Dashboard</a>
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px; margin-bottom:20px;">
                        <div class="card-form" style="margin:0;">
                            <h3 style="margin-top:0; color:#2c3e50; border-bottom:1px solid #eee; padding-bottom:10px;">🧾 Transaction Info</h3>
                            <p><strong>ID:</strong> #${tx.id}</p>
                            <p><strong>Ref:</strong> ${tx.reference}</p>
                            <p><strong>Amount:</strong> R${tx.amount.toFixed(2)}</p>
                            <p><strong>Date:</strong> ${new Date(tx.date).toLocaleString()}</p>
                            <p><strong>Organization:</strong> ${tx.church?.name || tx.churchCode}</p>
                        </div>
                        <div class="card-form" style="margin:0;">
                            <h3 style="margin-top:0; color:#2c3e50; border-bottom:1px solid #eee; padding-bottom:10px;">👤 Payer Info</h3>
                            <p><strong>Phone:</strong> ${tx.phone}</p>
                            <p><strong>Name:</strong> ${tx.member ? tx.member.firstName + ' ' + tx.member.lastName : 'Unregistered / Walk-in'}</p>
                            <p><strong>ID Number:</strong> ${tx.member?.idNumber || 'N/A'}</p>
                        </div>
                    </div>

                    <div class="card-form" style="border-left: 5px solid ${log.status === 'CLEARED' ? '#27ae60' : (log.status === 'BLOCKED' ? '#c0392b' : '#e67e22')};">
                        <h3 style="margin-top:0;">🛡️ Risk Engine Report</h3>
                        <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px; margin-bottom:20px;">
                            <div style="background:#f8f9fa; padding:15px; border-radius:6px; text-align:center;">
                                <div style="font-size:11px; color:#7f8c8d; text-transform:uppercase;">Risk Score</div>
                                <div style="font-size:24px; font-weight:bold; color:#2c3e50;">${(log.riskScore * 100).toFixed(0)}%</div>
                            </div>
                            <div style="background:#f8f9fa; padding:15px; border-radius:6px; text-align:center;">
                                <div style="font-size:11px; color:#7f8c8d; text-transform:uppercase;">PEP Hit</div>
                                <div style="font-size:16px; font-weight:bold; color:${log.isPepFound ? '#c0392b' : '#27ae60'}; margin-top:5px;">${log.isPepFound ? 'YES' : 'NO'}</div>
                            </div>
                            <div style="background:#f8f9fa; padding:15px; border-radius:6px; text-align:center;">
                                <div style="font-size:11px; color:#7f8c8d; text-transform:uppercase;">Sanction Hit</div>
                                <div style="font-size:16px; font-weight:bold; color:${log.isSanctionHit ? '#c0392b' : '#27ae60'}; margin-top:5px;">${log.isSanctionHit ? 'YES' : 'NO'}</div>
                            </div>
                        </div>
                        <p><strong>Current Status:</strong> <span class="tag" style="background:#eee; color:#333;">${log.status}</span></p>
                        <p><strong>System Flags:</strong> ${log.adminNotes || 'None'}</p>
                    </div>

                    ${isFlagged ? `
                    <div class="card-form" style="background:#fffaf0; border:1px solid #ffe58f;">
                        <h3 style="margin-top:0; color:#d48806;">⚖️ Admin Resolution</h3>
                        <p style="font-size:13px; color:#666;">This transaction requires manual review. Please verify the user's identity and determine if this is a false positive or a true risk.</p>
                        <form action="/admin/compliance/resolve" method="POST">
                            <input type="hidden" name="logId" value="${log.id}">
                            <input type="hidden" name="transactionId" value="${tx.id}">
                            <div class="form-group">
                                <label>Resolution Notes (Required for Audit)</label>
                                <textarea name="resolutionNotes" rows="3" required placeholder="e.g. Verified ID matches different person, false positive."></textarea>
                            </div>
                            <div style="display:flex; gap:15px;">
                                <button type="submit" name="decision" value="CLEARED" class="btn btn-save" style="flex:1;">✅ Clear (False Positive)</button>
                                <button type="submit" name="decision" value="BLOCKED" class="btn btn-danger" style="flex:1; padding:10px 20px; font-weight:bold; border-radius:4px; border:none; cursor:pointer;">🛑 Block (Confirm Risk)</button>
                            </div>
                        </form>
                    </div>
                    ` : `
                    <div class="card-form" style="background:#f0fdf4; border:1px solid #bbf7d0; text-align:center;">
                        <h3 style="color:#166534; margin:0;">Resolution Complete</h3>
                        <p style="font-size:13px; color:#15803d; margin-bottom:0;">This transaction has been processed and is marked as <strong>${log.status}</strong>.</p>
                    </div>
                    `}
                </div>
            `;
            res.send(renderAdminPage(`Review TX #${tx.id}`, content));
        } catch (e) {
            res.send(renderAdminPage('Error', '', e.message));
        }
    });

    app.post('/admin/compliance/resolve', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        
        try {
            const { logId, transactionId, decision, resolutionNotes } = req.body;
            
            const log = await prisma.complianceLog.findUnique({ where: { id: parseInt(logId) } });
            
            const updatedNotes = log.adminNotes 
                ? `${log.adminNotes} | Admin Resolved: ${resolutionNotes}`
                : `Admin Resolved: ${resolutionNotes}`;

            await prisma.complianceLog.update({
                where: { id: parseInt(logId) },
                data: {
                    status: decision,
                    adminNotes: updatedNotes
                }
            });

            if (decision === 'BLOCKED') {
                await prisma.transaction.update({
                    where: { id: parseInt(transactionId) },
                    data: { status: 'BLOCKED_FICA' }
                });
            }

            await logAction({
                actorId: 'admin', 
                role: 'SUPER_ADMIN',
                action: decision === 'CLEARED' ? 'CLEAR_TRANSACTION' : 'BLOCK_TRANSACTION',
                entity: 'ComplianceLog',
                entityId: logId,
                metadata: {
                    transactionId: parseInt(transactionId),
                    notes: resolutionNotes,
                    previousStatus: log.status
                },
                ipAddress: req.ip
            });

            res.redirect(`/admin/compliance/review/${transactionId}`);
        } catch (e) {
            res.send(renderAdminPage('Error', '', e.message));
        }
    });

    // ============================================================
    // 2. EVENTS
    // ============================================================
    app.get('/admin/events', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        try {
            const events = await prisma.event.findMany({ include: { church: true }, orderBy: { id: 'desc' } });
            const rows = events.map(e => `
                <tr>
                    <td>${e.name}</td>
                    <td>R${e.price}</td>
                    <td>${e.church ? e.church.name : 'Unknown'}</td>
                    <td>${e.status}</td>
                    <td>
                        <form method="POST" action="/admin/events/delete" style="display:inline;">
                            <input type="hidden" name="id" value="${e.id}">
                            <button class="btn btn-danger">Del</button>
                        </form>
                    </td>
                </tr>
            `).join('');

            const content = `
                <div style="text-align:right; margin-bottom:20px;">
                    <a href="/admin/events/add" class="btn btn-primary">+ Add Event</a>
                </div>
                <table>
                    <thead><tr><th>Event</th><th>Price</th><th>Org</th><th>Status</th><th>Action</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            `;
            res.send(renderAdminPage('Manage Events', content));
        } catch(e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    app.get('/admin/events/add', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const churches = await prisma.church.findMany();
        const opts = churches.map(c => `<option value="${c.code}">${c.name}</option>`).join('');
        
        const content = `
            <form method="POST" class="card-form">
                <div class="form-group"><label>Event Name</label><input name="name" required></div>
                <div class="form-group"><label>Date/Time Text</label><input name="date" required></div>
                <div class="form-group"><label>Ticket Price (R)</label><input type="number" name="price" required></div>
                <div class="form-group"><label>Organization</label><select name="churchCode">${opts}</select></div>
                <div class="form-group"><label>Expiry Date</label><input type="date" name="expiryDate" required></div>
                <button class="btn btn-primary" style="width:100%;">Create Event</button>
            </form>
        `;
        res.send(renderAdminPage('Add Event', content));
    });

    app.post('/admin/events/add', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        await prisma.event.create({ 
            data: { 
                name: req.body.name, 
                date: req.body.date, 
                price: parseFloat(req.body.price), 
                churchCode: req.body.churchCode, 
                status: 'Active', 
                expiryDate: safeDate(req.body.expiryDate) 
            } 
        });
        res.redirect('/admin/events');
    });

    app.post('/admin/events/delete', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        await prisma.event.delete({ where: { id: parseInt(req.body.id) } });
        res.redirect('/admin/events');
    });

    // ============================================================
    // 3. ADS & BROADCASTS
    // ============================================================
    app.get('/admin/ads', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        try {
            const ads = await prisma.ad.findMany({ include: { church: true }, orderBy: { id: 'desc' } });
            const rows = ads.map(a => `
                <tr>
                    <td>${a.content}</td>
                    <td>${a.church ? a.church.name : 'Unknown'}</td>
                    <td>${a.views}</td>
                    <td>${a.status}</td>
                    <td>
                        <form method="POST" action="/admin/ads/delete">
                            <input type="hidden" name="id" value="${a.id}">
                            <button class="btn btn-danger">Del</button>
                        </form>
                    </td>
                </tr>
            `).join('');

            const content = `
                <div style="text-align:right; margin-bottom:20px;">
                    <a href="/admin/ads/add" class="btn btn-primary">+ New Broadcast Ad</a>
                </div>
                <table>
                    <thead><tr><th>Content</th><th>Org</th><th>Views</th><th>Status</th><th>Action</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            `;
            res.send(renderAdminPage('Manage Ads', content));
        } catch(e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    app.get('/admin/ads/add', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const churches = await prisma.church.findMany();
        const opts = churches.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        
        const content = `
            <form method="POST" class="card-form">
                <div class="form-group"><label>Ad Content</label><textarea name="content" required rows="4"></textarea></div>
                <div class="form-group"><label>Organization</label><select name="churchId">${opts}</select></div>
                <div class="form-group"><label>Expiry Date</label><input type="date" name="expiryDate" required></div>
                <button class="btn btn-primary" style="width:100%;">Save Ad</button>
            </form>
        `;
        res.send(renderAdminPage('New Ad', content));
    });

    app.post('/admin/ads/add', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        await prisma.ad.create({ 
            data: { 
                content: req.body.content, 
                churchId: parseInt(req.body.churchId), 
                status: 'Active', 
                expiryDate: safeDate(req.body.expiryDate) 
            } 
        });
        res.redirect('/admin/ads');
    });

    app.post('/admin/ads/delete', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        await prisma.ad.delete({ where: { id: parseInt(req.body.id) } });
        res.redirect('/admin/ads');
    });

    // ============================================================
    // 4. NEWS
    // ============================================================
    app.get('/admin/news', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        try {
            const news = await prisma.news.findMany({ include: { church: true }, orderBy: { id: 'desc' } });
            const rows = news.map(n => `
                <tr>
                    <td>${n.headline}</td>
                    <td>${n.church ? n.church.name : 'Unknown'}</td>
                    <td>${n.status}</td>
                    <td>
                        <form method="POST" action="/admin/news/delete">
                            <input type="hidden" name="id" value="${n.id}">
                            <button class="btn btn-danger">Del</button>
                        </form>
                    </td>
                </tr>
            `).join('');

            const content = `
                <div style="text-align:right; margin-bottom:20px;">
                    <a href="/admin/news/add" class="btn btn-primary">+ Add News Article</a>
                </div>
                <table>
                    <thead><tr><th>Headline</th><th>Org</th><th>Status</th><th>Action</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            `;
            res.send(renderAdminPage('Manage News', content));
        } catch(e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    app.get('/admin/news/add', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const churches = await prisma.church.findMany();
        const opts = churches.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        
        const content = `
            <form method="POST" class="card-form">
                <div class="form-group"><label>Headline</label><input name="headline" required></div>
                <div class="form-group"><label>Body Text</label><textarea name="body" rows="6"></textarea></div>
                <div class="form-group"><label>Organization</label><select name="churchId">${opts}</select></div>
                <div class="form-group"><label>Expiry Date</label><input type="date" name="expiryDate" required></div>
                <button class="btn btn-primary" style="width:100%;">Publish News</button>
            </form>
        `;
        res.send(renderAdminPage('Add News', content));
    });

    app.post('/admin/news/add', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        await prisma.news.create({ 
            data: { 
                headline: req.body.headline, 
                body: req.body.body, 
                churchId: parseInt(req.body.churchId), 
                status: 'Active', 
                expiryDate: safeDate(req.body.expiryDate) 
            } 
        });
        res.redirect('/admin/news');
    });

    app.post('/admin/news/delete', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        await prisma.news.delete({ where: { id: parseInt(req.body.id) } });
        res.redirect('/admin/news');
    });

    // ============================================================
    // 5. USERS
    // ============================================================
    app.get('/admin/users', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const q = req.query.q || '';
        try {
            const members = await prisma.member.findMany({ 
                where: { 
                    OR: [
                        { phone: { contains: q } }, 
                        { churchCode: { contains: q, mode: 'insensitive' } }
                    ] 
                }, 
                take: 50, 
                orderBy: { id: 'desc' } 
            });

            const rows = members.map(m => `
                <tr>
                    <td>${m.phone}</td>
                    <td><span class="tag tag-church">${m.churchCode}</span></td>
                    <td>${m.firstName || 'Unknown'}</td>
                </tr>
            `).join('');

            const content = `
                <form class="search-bar">
                    <input name="q" value="${q}" placeholder="Search Phone or Code..." style="padding:10px; width:300px; border:1px solid #ddd; border-radius:4px;">
                    <button class="btn btn-primary">Search</button>
                </form>
                <table>
                    <thead><tr><th>Phone</th><th>Org Code</th><th>Name</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            `;
            res.send(renderAdminPage('Manage Users', content));
        } catch(e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    // ============================================================
    // 💾 API: SAVE AI-SCANNED EVENT
    // ============================================================
    app.post('/api/admin/vision/save-event', express.json(), async (req, res) => {
        try {
            const { name, date, price, churchCode } = req.body;
            if (!name || !churchCode) return res.status(400).json({ success: false, error: "Missing event name or org code." });

            const org = await prisma.church.findUnique({ where: { code: churchCode.toUpperCase() } });
            if (!org) return res.status(404).json({ success: false, error: "Organization not found" });

            // Parse Date and calculate expiry (Event Date + 1 Day)
            const eventDate = date && !isNaN(Date.parse(date)) ? new Date(date) : new Date();
            const calculatedExpiry = new Date(eventDate);
            calculatedExpiry.setDate(calculatedExpiry.getDate() + 1);

            const newEvent = await prisma.event.create({
                data: {
                    name: name,
                    date: date || "TBD",
                    price: parseFloat(price) || 0,
                    churchCode: org.code,
                    status: 'Active',
                    expiryDate: calculatedExpiry
                }
            });

            res.json({ success: true, message: "✅ Event successfully saved to database!", event: newEvent });
        } catch (error) {
            console.error("AI Event Save Error:", error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ============================================================
    // 💾 API: SAVE AI-SCANNED POLICIES/PLANS
    // ============================================================
    app.post('/api/admin/vision/save-policy', express.json(), async (req, res) => {
        try {
            const { churchCode, plans } = req.body;
            if (!churchCode || !plans || plans.length === 0) return res.status(400).json({ success: false, error: "Missing policy data." });

            const org = await prisma.church.findUnique({ where: { code: churchCode.toUpperCase() } });
            if (!org) return res.status(404).json({ success: false, error: "Organization not found" });

            // Loop through the AI-extracted plans and create them in the DB
            for (const plan of plans) {
                await prisma.policyPlan.create({
                    data: {
                        name: plan.name,
                        price: parseFloat(plan.price) || 0,
                        churchId: org.id,
                        benefits: plan.benefits ? plan.benefits.join(', ') : '' 
                    }
                });
            }

            res.json({ success: true, message: `✅ Successfully saved ${plans.length} policy plans!` });
        } catch (error) {
            console.error("AI Policy Save Error:", error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
	
	// ============================================================
    // 🔒 API: RESET CLIENT PASSWORD & MFA
    // ============================================================
    app.post('/api/admin/churches/reset-access', express.json(), async (req, res) => {
        if (!isAuthenticated(req)) return res.status(401).json({ error: "Unauthorized" });

        try {
            const { code } = req.body;
            const org = await prisma.church.findUnique({ where: { code } });
            if (!org) return res.status(404).json({ success: false, error: "Organization not found" });

            // 1. Generate new setup token
            const crypto = require('crypto');
            const token = crypto.randomBytes(20).toString('hex');

            // 2. Wipe old credentials and lock them out until they setup again
            await prisma.church.update({
                where: { code },
                data: {
                    password: null,
                    mfaSecret: null,
                    setupToken: token
                }
            });

            // 3. Send WhatsApp onboarding blast
            const setupLink = `https://${req.get('host')}/org/setup/${token}`;
            const msg = `⚠️ *Seabe Digital Security Alert*\n\nYour Admin access for ${org.name} has been reset by the Super Admin.\n\nPlease click below to set up a new password and re-link your Google Authenticator 2FA:\n\n🔗 ${setupLink}`;

            if (org.adminPhone) {
                let cleanPhone = org.adminPhone.replace(/\D/g, '');
                if (cleanPhone.startsWith('0')) cleanPhone = '27' + cleanPhone.substring(1);
                await sendWhatsApp(cleanPhone, msg);
            }

            res.json({ success: true, message: "Access wiped. New setup link sent via WhatsApp!" });
        } catch (error) {
            console.error("Reset Access Error:", error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

};