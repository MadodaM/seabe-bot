// routes/platform.js
// VERSION: 8.0 (Added SuperAdmin FICA & KYB Dashboard)
require('dotenv').config();

const express = require('express');
const { provisionNetCashAccount } = require('../services/netcashProvisioner');
const sgMail = require('@sendgrid/mail');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'seabe123';
const COOKIE_NAME = 'seabe_admin_session';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'secret_token_123';

// --- AUTH HELPERS ---
function parseCookies(req) {
    const list = {}, rc = req.headers.cookie;
    rc && rc.split(';').forEach(c => { const p = c.split('='); list[p.shift().trim()] = decodeURI(p.join('=')); });
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

// --- UI LAYOUT ---
function renderAdminPage(title, content, error = null) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>${title} | Seabe Platform</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: 'Segoe UI', sans-serif; background: #f4f7f6; margin: 0; display: flex; color: #333; }
                
                /* Sidebar */
                .sidebar { width: 250px; background: #1e272e; color: white; min-height: 100vh; padding: 20px; box-sizing: border-box; position: fixed; }
                .sidebar h2 { color: #00d2d3; margin-top: 0; padding-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.1); }
                .sidebar a { display: block; color: #ccc; text-decoration: none; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05); transition:0.2s; }
                .sidebar a:hover { color: #00d2d3; padding-left: 5px; }
                
                /* Main Area */
                .main { margin-left: 250px; flex: 1; padding: 40px; }
                h1 { color: #1e272e; border-bottom: 3px solid #00d2d3; display: inline-block; padding-bottom: 5px; margin-bottom: 30px; }
                
                /* Components */
                .error-box { background: #fee; color: #c00; padding: 15px; border-radius: 5px; border: 1px solid #fcc; margin-bottom: 20px; }
                table { width:100%; border-collapse:collapse; background:white; border-radius:8px; overflow:hidden; box-shadow:0 4px 10px rgba(0,0,0,0.05); margin-top: 20px; }
                thead { background:#1e272e; color:white; }
                th { padding:15px; text-align:left; font-weight:600; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; }
                td { padding:12px 15px; border-bottom:1px solid #eee; font-size:14px; }
                tr:hover { background-color: #f9f9f9; }
                
                /* Tags */
                .tag { padding:4px 8px; border-radius:4px; font-weight:bold; font-size:11px; text-transform:uppercase; display:inline-block; margin-bottom:2px; }
                .tag-church { background:#eefdf5; color:green; border:1px solid green; }
                .tag-society { background:#eefafc; color:#0984e3; border:1px solid #0984e3; }
                .tag-npo { background:#fff8e1; color:#f39c12; border:1px solid #f39c12; }
                .tag-provider { background:#f5eef8; color:#8e44ad; border:1px solid #8e44ad; }
                
                /* Buttons */
                .btn { padding: 8px 15px; border-radius: 4px; text-decoration: none; font-size: 13px; font-weight: bold; cursor: pointer; border: none; display: inline-block; transition: 0.2s; }
                .btn-primary { background: #1e272e; color: white; }
                .btn-primary:hover { background: #00d2d3; color: #1e272e; }
                .btn-edit { background: #dfe6e9; color: #2d3436; }
                .btn-danger { background: #ffebee; color: #c0392b; }
                .btn-collection { background: #c0392b; color: white; margin-left:5px; }
                .btn-collection:hover { background: #e74c3c; }
                
                /* Forms */
                .card-form { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.05); max-width: 600px; }
                .form-group { margin-bottom: 20px; }
                .form-group label { display: block; margin-bottom: 8px; font-weight: bold; color: #1e272e; font-size: 12px; text-transform: uppercase; }
                .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; font-family: inherit; }
                .search-bar { display: flex; gap: 10px; margin-bottom: 20px; align-items: center; }
            </style>
        </head>
        <body>
            <div class="sidebar">
                <h2>SEABE PLATFORM</h2>
                <a href="/admin">📊 Dashboard</a>
                <a href="/admin/global-radar">🌍 Global Radar</a> <a href="/admin/churches">🏢 Organizations</a>
                <a href="/admin/churches">🏢 Organizations</a>
                <a href="/admin/fica">🛡️ FICA & KYB</a> <a href="/admin/global-collections">💰 Global Collections</a>
                <a href="/admin/events">🎟️ Events & Projects</a>
                <a href="/admin/ads">📢 Advertising</a>
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

    // --- AUTHENTICATION ---
    app.get('/login', (req, res) => {
        res.send(`
            <div style="font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; background:#2d3436;">
                <form action="/login" method="POST" style="background:white; padding:40px; border-radius:10px; text-align:center; width: 300px; box-shadow:0 10px 30px rgba(0,0,0,0.2);">
                    <h2 style="color:#1e272e;">Super Admin</h2>
                    <input name="username" placeholder="Username" style="padding:15px; width:100%; margin-bottom:10px; box-sizing:border-box; border:1px solid #ddd; border-radius:5px;">
                    <input type="password" name="password" placeholder="Password" style="padding:15px; width:100%; margin-bottom:20px; box-sizing:border-box; border:1px solid #ddd; border-radius:5px;">
                    <button style="padding:15px; width:100%; background:#00d2d3; color:#1e272e; font-weight:bold; border:none; border-radius:5px; cursor:pointer;">SECURE LOGIN</button>
                </form>
            </div>
        `);
    });

    app.post('/login', (req, res) => {
        if (req.body.username === ADMIN_USER && req.body.password === ADMIN_PASS) {
            res.setHeader('Set-Cookie', `${COOKIE_NAME}=${ADMIN_SECRET}; HttpOnly; Path=/; Max-Age=3600`);
            res.redirect('/admin');
        } else {
            res.redirect('/login');
        }
    });

    app.get('/logout', (req, res) => {
        res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0`);
        res.redirect('/login');
    });

    // --- DASHBOARD ---
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

            res.send(renderAdminPage('Platform Overview', `
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
            `));
        } catch (e) {
            res.send(renderAdminPage('Dashboard', '', `Database Error: ${e.message}`));
        }
    });

	// --- GLOBAL FRAUD & CLAIMS RADAR (IFRAME) ---
    app.get('/admin/global-radar', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        
        const content = `
            <style>
                .main { padding: 0 !important; } /* Removes legacy padding to let Tailwind take over */
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
    // 🛡️ NEW: FICA & KYB COMPLIANCE DASHBOARD
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
                    actionBtn = `<button onclick="approveLevel1(${c.id})" class="btn" style="background:#e67e22; color:white; font-size:11px;">Approve L1 (Email)</button>`;
                } 
                else if (c.ficaStatus === 'AWAITING_LEVEL_2') {
                    statusBadge = `<span class="tag" style="background:#e3f2fd; color:#3498db; border:1px solid #3498db;">Awaiting L2 Docs</span>`;
                    actionBtn = `<span style="font-size:11px; color:#7f8c8d; font-style:italic;">Waiting on Client</span>`;
                }
                else if (c.ficaStatus === 'LEVEL_2_PENDING') {
                    statusBadge = `<span class="tag" style="background:#f3e5f5; color:#8e44ad; border:1px solid #8e44ad;">Level 2 Pending</span>`;
                    actionBtn = `<button onclick="approveFinal(${c.id})" class="btn" style="background:#8e44ad; color:white; font-size:11px;">Approve Final (NetCash)</button>`;
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
	
	// ============================================================
    // ⚙️ API: FICA LEVEL 1 APPROVAL
    // ============================================================
    app.post('/api/prospect/admin/approve-level-1', async (req, res) => {
        if (!isAuthenticated(req)) return res.status(401).json({ error: "Unauthorized" });
        
        try {
            const org = await prisma.church.findUnique({ where: { id: parseInt(req.body.churchId) } });
            if (!org) return res.status(404).json({ error: "Organization not found" });

            // 1. Update status to Awaiting Level 2
            await prisma.church.update({
                where: { id: org.id },
                data: { ficaStatus: 'AWAITING_LEVEL_2' }
            });

            // 2. Email client asking for Corporate Docs
            if (org.email || org.officialEmail) {
                const targetEmail = org.officialEmail || org.email;
                await sgMail.send({
                    to: targetEmail,
                    from: process.env.EMAIL_FROM || 'admin@seabe.tech',
                    subject: `Action Required: FICA Level 1 Approved for ${org.name}`,
                    text: `Great news! Your Level 1 FICA is approved.\n\nTo activate your NetCash merchant account, please reply to this email with your Level 2 corporate documents:\n- NPC Certificate / Constitution\n- CIPC Registration\n- Director IDs`
                }).catch(e => console.error("Email error:", e));
            }

            res.json({ message: "Level 1 Approved. Email sent to client requesting Level 2 docs." });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: error.message });
        }
    });

    // ============================================================
    // ⚙️ API: FINAL APPROVAL & NETCASH PROVISIONING
    // ============================================================
    app.post('/api/prospect/admin/approve-final', async (req, res) => {
        if (!isAuthenticated(req)) return res.status(401).json({ error: "Unauthorized" });
        
        try {
            const org = await prisma.church.findUnique({ where: { id: parseInt(req.body.churchId) } });
            if (!org) return res.status(404).json({ error: "Organization not found" });

            console.log(`🏦 Provisioning NetCash account for ${org.name}...`);

            // 1. Map data for NetCash API (using fallbacks to prevent crashes if fields are missing)
            const netcashData = {
                name: org.name,
                adminName: org.contactPerson || 'Admin',
                email: org.officialEmail || org.email || 'admin@seabe.tech',
                phone: org.adminPhone || org.phone || '0000000000',
                bankName: org.bankName || 'Standard Bank', // Ensure these fields exist in your Prisma schema!
                branchCode: org.branchCode || '051001',
                accountNumber: org.accountNumber || '0000000000'
            };

            // 2. Fire the Payload
            const netcashResponse = await provisionNetCashAccount(netcashData);

            if (netcashResponse && netcashResponse.MerchantId) {
                
                // 3. Save the new keys and mark as ACTIVE
                await prisma.church.update({
                    where: { id: org.id },
                    data: {
                        ficaStatus: 'ACTIVE',
                        netcashMerchantId: netcashResponse.MerchantId,
                        netcashPayNowKey: netcashResponse.PayNowKey,
                        subaccountCode: netcashResponse.PayNowKey // Maps to your dashboard UI
                    }
                });

                // 4. Send the "You are Live!" Email
                if (org.email || org.officialEmail) {
                    const targetEmail = org.officialEmail || org.email;
                    await sgMail.send({
                        to: targetEmail,
                        from: process.env.EMAIL_FROM || 'admin@seabe.tech',
                        subject: `🎉 ${org.name} FICA Approved! Merchant Account Live.`,
                        text: `Your KYB is fully approved and your merchant account has been created!\n\nNetCash Merchant ID: ${netcashResponse.MerchantId}\nPay Now Key: ${netcashResponse.PayNowKey}\n\nYour members can now pay securely via Seabe Pay on WhatsApp.`
                    }).catch(e => console.error("Email error:", e));
                }

                res.json({ message: "KYB Finalized & NetCash Account Created!", netCashAccountId: netcashResponse.MerchantId });
            } else {
                res.status(500).json({ error: "NetCash API failed to return keys. Check Partner ID." });
            }
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: error.message });
        }
    });

    // ============================================================
    // 1. ORGANIZATIONS (Churches, Societies, NPOs)
    // ============================================================
    app.get('/admin/churches', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const q = req.query.q || '';
        
        try {
            const items = await prisma.church.findMany({ 
                where: { OR: [ {name:{contains:q, mode:'insensitive'}}, {code:{contains:q, mode:'insensitive'}} ]},
                orderBy: { createdAt: 'desc' } 
            });

            const rows = items.map(c => {
                let badgeClass = 'tag-church';
                if (c.type === 'BURIAL_SOCIETY') badgeClass = 'tag-society';
                if (c.type === 'NON_PROFIT') badgeClass = 'tag-npo';
                if (c.type === 'SERVICE_PROVIDER') badgeClass = 'tag-provider';

                return `
                <tr>
                    <td><strong>${c.name}</strong><br><span style="font-size:11px; color:#999;">${c.email || 'No Email'}</span></td>
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

            res.send(renderAdminPage('Manage Organizations', `
                <div style="display:flex; justify-content:space-between; margin-bottom:20px; align-items:center;">
                    <form action="/admin/churches" class="search-bar" style="margin:0;">
                        <input name="q" value="${q}" placeholder="Search Name, Code..." style="padding:10px; width:300px; border:1px solid #ddd; border-radius:4px;">
                        <button class="btn btn-primary">Search</button>
                    </form>
                    <a href="/admin/churches/add" class="btn btn-primary" style="background:#00d2d3; color:black;">+ New Organization</a>
                </div>
                <table>
                    <thead><tr><th>Organization</th><th>Type</th><th>Code</th><th>Paystack</th><th style="text-align:right;">Actions</th></tr></thead>
                    <tbody>${rows.length > 0 ? rows : '<tr><td colspan="5" style="text-align:center; padding:30px;">No results found.</td></tr>'}</tbody>
                </table>
            `));
        } catch (e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    // 2. ADD ORGANIZATION FORM
    app.get('/admin/churches/add', (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        res.send(renderAdminPage('Add New Organization', `
            <form method="POST" class="card-form">
                <div class="form-group">
                    <label>Type</label>
                    <select name="type">
                        <option value="CHURCH">Church</option>
                        <option value="BURIAL_SOCIETY">Society</option>
                        <option value="NON_PROFIT">NGO</option>
                        <option value="SERVICE_PROVIDER">Service Provider 💼</option> </select>
                </div>
                <div class="form-group"><label>Name</label><input name="name" required></div>
                <div class="form-group"><label>Email</label><input name="email" required></div>
                <div class="form-group"><label>Admin WhatsApp</label><input name="adminPhone" required placeholder="2782..."></div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px;">
                    <div class="form-group"><label>Premium/Fee (R)</label><input type="number" name="defaultPremium" value="150"></div>
                    <div class="form-group"><label>Platform Sub Fee (R)</label><input type="number" name="subscriptionFee" value="0"></div>
                </div>
                <div class="form-group"><label>Paystack Code</label><input name="subaccount"></div>
                <button class="btn btn-primary" style="width:100%">Create Organization</button>
            </form>
        `));
    });

    app.post('/admin/churches/add', async (req, res) => {
        const prefix = req.body.name.replace(/[^a-zA-Z]/g, '').substring(0,3).toUpperCase();
        const code = prefix + Math.floor(100 + Math.random()*900);
        try {
            await prisma.church.create({ 
                data: { 
                    name: req.body.name, email: req.body.email, code: code, type: req.body.type, adminPhone: req.body.adminPhone,
                    defaultPremium: parseFloat(req.body.defaultPremium), subscriptionFee: parseFloat(req.body.subscriptionFee), subaccountCode: req.body.subaccount || '' 
                } 
            });
            res.redirect('/admin/churches');
        } catch(e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    app.get('/admin/churches/edit/:code', async (req, res) => {
        const c = await prisma.church.findUnique({ where: { code: req.params.code } });
        res.send(renderAdminPage('Edit Organization', `
            <form action="/admin/churches/update" method="POST" class="card-form">
                <input type="hidden" name="code" value="${c.code}">
                <div class="form-group"><label>Name (Locked)</label><input value="${c.name}" disabled style="background:#f0f0f0;"></div>
                <div class="form-group"><label>Admin Phone</label><input name="adminPhone" value="${c.adminPhone}"></div>
                <div class="form-group"><label>Email</label><input name="email" value="${c.email}"></div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px;">
                    <div class="form-group"><label>Premium</label><input name="defaultPremium" value="${c.defaultPremium}"></div>
                    <div class="form-group"><label>Sub Fee</label><input name="subscriptionFee" value="${c.subscriptionFee}"></div>
                </div>
                <div class="form-group"><label>Paystack</label><input name="subaccount" value="${c.subaccountCode||''}"></div>
                <button class="btn btn-primary">Update Organization</button>
            </form>
        `));
    });

    app.post('/admin/churches/update', async (req, res) => {
        try {
            await prisma.church.update({ 
                where: { code: req.body.code }, 
                data: { email: req.body.email, adminPhone: req.body.adminPhone, defaultPremium: parseFloat(req.body.defaultPremium), subscriptionFee: parseFloat(req.body.subscriptionFee), subaccountCode: req.body.subaccount } 
            });
            res.redirect('/admin/churches');
        } catch(e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    // --- GLOBAL COLLECTIONS ---
    app.get('/admin/global-collections', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        try {
            const groups = await prisma.collection.groupBy({ by: ['churchCode', 'status'], _sum: { amount: true }, _count: { id: true } });
            const rows = groups.map(g => `<tr><td>${g.churchCode}</td><td>${g.status}</td><td>${g._count.id}</td><td>R${g._sum.amount?.toFixed(2)||0}</td></tr>`).join('');
            res.send(renderAdminPage('Global Debt Stats', `
                <div class="card-form" style="max-width:100%;">
                    <h3>Debt Recovery by Organization</h3>
                    <table><thead><tr><th>Org Code</th><th>Status</th><th>Count</th><th>Total Value</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No collections yet.</td></tr>'}</tbody></table>
                </div>
            `));
        } catch(e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    // ============================================================
    // 2. EVENTS
    // ============================================================
    app.get('/admin/events', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const events = await prisma.event.findMany({ include: { church: true }, orderBy: { id: 'desc' } });
        const rows = events.map(e => `
            <tr><td>${e.name}</td><td>R${e.price}</td><td>${e.church ? e.church.name : 'Unknown'}</td><td>${e.status}</td>
            <td><form method="POST" action="/admin/events/delete" style="display:inline;"><input type="hidden" name="id" value="${e.id}"><button class="btn btn-danger">Del</button></form></td></tr>`).join('');
        res.send(renderAdminPage('Manage Events', `<div style="text-align:right; margin-bottom:20px;"><a href="/admin/events/add" class="btn btn-primary">+ Add Event</a></div><table><thead><tr><th>Event</th><th>Price</th><th>Org</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>`));
    });

    app.get('/admin/events/add', async (req, res) => {
        const opts = (await prisma.church.findMany()).map(c => `<option value="${c.code}">${c.name}</option>`).join('');
        res.send(renderAdminPage('Add Event', `<form method="POST" class="card-form"><div class="form-group"><label>Name</label><input name="name" required></div><div class="form-group"><label>Date Text</label><input name="date" required></div><div class="form-group"><label>Price</label><input type="number" name="price" required></div><div class="form-group"><label>Org</label><select name="churchCode">${opts}</select></div><div class="form-group"><label>Expiry</label><input type="date" name="expiryDate" required></div><button class="btn btn-primary">Create</button></form>`));
    });

    app.post('/admin/events/add', async (req, res) => {
        await prisma.event.create({ data: { name: req.body.name, date: req.body.date, price: parseFloat(req.body.price), churchCode: req.body.churchCode, status: 'Active', expiryDate: safeDate(req.body.expiryDate) } });
        res.redirect('/admin/events');
    });

    app.post('/admin/events/delete', async (req, res) => {
        await prisma.event.delete({ where: { id: parseInt(req.body.id) } });
        res.redirect('/admin/events');
    });

    // ============================================================
    // 3. ADS
    // ============================================================
    app.get('/admin/ads', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const ads = await prisma.ad.findMany({ include: { church: true }, orderBy: { id: 'desc' } });
        const rows = ads.map(a => `<tr><td>${a.content}</td><td>${a.church ? a.church.name : 'Unknown'}</td><td>${a.views}</td><td>${a.status}</td><td><form method="POST" action="/admin/ads/delete"><input type="hidden" name="id" value="${a.id}"><button class="btn btn-danger">Del</button></form></td></tr>`).join('');
        res.send(renderAdminPage('Manage Ads', `<div style="text-align:right; margin-bottom:20px;"><a href="/admin/ads/add" class="btn btn-primary">+ New Ad</a></div><table><thead><tr><th>Content</th><th>Org</th><th>Views</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>`));
    });

    app.get('/admin/ads/add', async (req, res) => {
        const opts = (await prisma.church.findMany()).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        res.send(renderAdminPage('New Ad', `<form method="POST" class="card-form"><div class="form-group"><label>Content</label><textarea name="content" required></textarea></div><div class="form-group"><label>Org</label><select name="churchId">${opts}</select></div><div class="form-group"><label>Expiry</label><input type="date" name="expiryDate" required></div><button class="btn btn-primary">Save Ad</button></form>`));
    });

    app.post('/admin/ads/add', async (req, res) => {
        await prisma.ad.create({ data: { content: req.body.content, churchId: parseInt(req.body.churchId), status: 'Active', expiryDate: safeDate(req.body.expiryDate) } });
        res.redirect('/admin/ads');
    });

    app.post('/admin/ads/delete', async (req, res) => {
        await prisma.ad.delete({ where: { id: parseInt(req.body.id) } });
        res.redirect('/admin/ads');
    });

    // ============================================================
    // 4. NEWS
    // ============================================================
    app.get('/admin/news', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const news = await prisma.news.findMany({ include: { church: true }, orderBy: { id: 'desc' } });
        const rows = news.map(n => `<tr><td>${n.headline}</td><td>${n.church ? n.church.name : 'Unknown'}</td><td>${n.status}</td><td><form method="POST" action="/admin/news/delete"><input type="hidden" name="id" value="${n.id}"><button class="btn btn-danger">Del</button></form></td></tr>`).join('');
        res.send(renderAdminPage('Manage News', `<div style="text-align:right; margin-bottom:20px;"><a href="/admin/news/add" class="btn btn-primary">+ Add News</a></div><table><thead><tr><th>Headline</th><th>Org</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>`));
    });

    app.get('/admin/news/add', async (req, res) => {
        const opts = (await prisma.church.findMany()).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        res.send(renderAdminPage('Add News', `<form method="POST" class="card-form"><div class="form-group"><label>Headline</label><input name="headline" required></div><div class="form-group"><label>Body</label><textarea name="body"></textarea></div><div class="form-group"><label>Org</label><select name="churchId">${opts}</select></div><div class="form-group"><label>Expiry</label><input type="date" name="expiryDate" required></div><button class="btn btn-primary">Publish</button></form>`));
    });

    app.post('/admin/news/add', async (req, res) => {
        await prisma.news.create({ data: { headline: req.body.headline, body: req.body.body, churchId: parseInt(req.body.churchId), status: 'Active', expiryDate: safeDate(req.body.expiryDate) } });
        res.redirect('/admin/news');
    });

    app.post('/admin/news/delete', async (req, res) => {
        await prisma.news.delete({ where: { id: parseInt(req.body.id) } });
        res.redirect('/admin/news');
    });

    // ============================================================
    // 5. USERS
    // ============================================================
    app.get('/admin/users', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const q = req.query.q || '';
        const members = await prisma.member.findMany({ where: { OR: [{ phone: { contains: q } }, { churchCode: { contains: q, mode: 'insensitive' } }] }, take: 50, orderBy: { id: 'desc' } });
        const rows = members.map(m => `<tr><td>${m.phone}</td><td><span class="tag tag-church">${m.churchCode}</span></td><td>${m.firstName}</td></tr>`).join('');
        res.send(renderAdminPage('Manage Users', `<form class="search-bar"><input name="q" value="${q}" placeholder="Search Phone or Code..." style="padding:10px; width:300px; border:1px solid #ddd; border-radius:4px;"><button class="btn btn-primary">Search</button></form><table><thead><tr><th>Phone</th><th>Org Code</th><th>Name</th></tr></thead><tbody>${rows}</tbody></table>`));
    });
};