// routes/platform.js
// VERSION: 10.0 (Complete Admin Suite + AI Course Builder CRUD)
require('dotenv').config();

const { extractDataFromImage } = require('../services/visionExtractor');
const fs = require('fs');
const { processAndImportCoursePDF } = require('../services/courseImporter');
const express = require('express');
const { provisionNetCashAccount } = require('../services/netcashProvisioner');
const { generatePaymentQR } = require('../services/paymentQrgen');
const sgMail = require('@sendgrid/mail');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

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
                .sidebar { width: 250px; background: #1e272e; color: white; min-height: 100vh; padding: 20px; box-sizing: border-box; position: fixed; }
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
                .tag { padding:4px 8px; border-radius:4px; font-weight:bold; font-size:11px; text-transform:uppercase; display:inline-block; margin-bottom:2px; }
                .tag-church { background:#eefdf5; color:green; border:1px solid green; }
                .tag-society { background:#eefafc; color:#0984e3; border:1px solid #0984e3; }
                .tag-npo { background:#fff8e1; color:#f39c12; border:1px solid #f39c12; }
                .tag-provider { background:#f5eef8; color:#8e44ad; border:1px solid #8e44ad; }
                .btn { padding: 8px 15px; border-radius: 4px; text-decoration: none; font-size: 13px; font-weight: bold; cursor: pointer; border: none; display: inline-block; transition: 0.2s; }
                .btn-primary { background: #1e272e; color: white; }
                .btn-primary:hover { background: #00d2d3; color: #1e272e; }
                .btn-edit { background: #dfe6e9; color: #2d3436; }
                .btn-save { background: #2ecc71; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; }
                .btn-danger { background: #ffebee; color: #c0392b; }
                .btn-collection { background: #c0392b; color: white; margin-left:5px; }
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
                <a href="/admin/global-radar">🌍 Global Radar</a>
                <a href="/admin/churches">🏢 Organizations</a>
                <a href="/admin/pricing">🏷️ Pricing Engine</a> 
                <a href="/admin/fica">🛡️ FICA & KYB</a> 
                <a href="/admin/compliance">⚖️ Compliance & LSO</a>
                <a href="/admin/global-collections">💰 Global Collections</a>
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



    // ============================================================
    // 🏷️ PRICING ENGINE (Simulator + Tables + Reset)
    // ============================================================
    app.get('/admin/pricing', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');

        try {
            // 1. FORCE SYNC: Ensure DB has all keys
            const { loadPrices } = require('../services/pricing');
            await loadPrices(); 

            // 2. Fetch all prices
            const allPrices = await prisma.servicePrice.findMany({ orderBy: { code: 'asc' } });
            
            // 3. Group them
            const platformFees = allPrices.filter(p => !p.code.startsWith('TX_') && !p.code.startsWith('MOD_'));
            const txVars = allPrices.filter(p => p.code.startsWith('TX_') || p.code.startsWith('MOD_'));

            // 4. Helper for Table Rows
            const makeRows = (data) => data.map(p => `
                <tr>
                    <td><span class="tag" style="background:#edf2f7; color:#2d3748; font-family:monospace; border:none;">${p.code}</span></td>
                    <td>
                        <form action="/admin/pricing/update" method="POST" style="display:flex; gap:8px; margin:0;">
                            <input type="hidden" name="code" value="${p.code}">
                            <input type="number" step="0.0001" name="amount" class="price-input" 
                                   value="${Number(p.amount)}" 
                                   style="width:90px; text-align:right; border:1px solid #cbd5e0; border-radius:4px; padding:4px;">
                            <button type="submit" class="btn btn-primary" style="padding:4px 8px; font-size:11px; background:#1e272e;">Save</button>
                        </form>
                    </td>
                </tr>
            `).join('');

            // --- COMPONENT 1: The Simulator ---
            const simulatorSection = `
                <div class="card-form" style="max-width:100%; margin-bottom:30px; border-top: 5px solid #00d2d3;">
                    <h3 style="margin-top:0;">📈 Profit Margin Simulator</h3>
                    <p style="font-size:12px; color:#718096; margin-top:-10px;">Test your pricing strategy before committing changes.</p>
                    
                    <div style="display:grid; grid-template-columns: 1fr 1fr 1.5fr; gap:20px; align-items: end;">
                        <div class="form-group" style="margin:0;">
                            <label>Premium Amount (R)</label>
                            <input type="number" id="simPremium" value="150" oninput="runSim()">
                        </div>
                        <div class="form-group" style="margin:0;">
                            <label>Payment Method</label>
                            <select id="simMethod" onchange="runSim()">
                                <option value="CAPITEC">Capitec Pay / EFT</option>
                                <option value="CARD">Credit/Debit Card</option>
                                <option value="RETAIL">Retail Cash (Store)</option>
                            </select>
                        </div>
                        <div id="simResult" style="background:#f8fafc; padding:15px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; border:1px solid #e2e8f0;">
                            <div>
                                <div style="font-size:10px; color:#64748b; text-transform:uppercase; font-weight:bold;">Seabe Net Profit</div>
                                <div id="simProfit" style="font-size:24px; font-weight:bold; color:#10b981;">R 0.00</div>
                            </div>
                            <div style="text-align:right; font-size:12px; color:#475569;">
                                <div>Retail Fee: <span id="simRetail">R0.00</span></div>
                                <div>Wholesale: <span id="simWholesale">R0.00</span></div>
                            </div>
                        </div>
                    </div>
                </div>

                <script>
                    function runSim() {
                        const amount = parseFloat(document.getElementById('simPremium').value) || 0;
                        const method = document.getElementById('simMethod').value;
                        
                        const getVal = (code) => {
                            const input = document.querySelector('input[name="code"][value="'+code+'"]');
                            return input ? parseFloat(input.parentElement.querySelector('input[name="amount"]').value) : 0;
                        };

                        const whPct = getVal('TX_' + method + '_WH_PCT');
                        const whFlat = getVal('TX_' + method + '_WH_FLAT');
                        const rtPct = getVal('TX_' + method + '_RT_PCT');
                        const rtFlat = getVal('TX_' + method + '_RT_FLAT');

                        const whCost = (amount * whPct) + whFlat;
                        const rtFee = (amount * rtPct) + rtFlat;
                        const profit = rtFee - whCost;

                        document.getElementById('simProfit').innerText = 'R ' + profit.toFixed(2);
                        document.getElementById('simRetail').innerText = 'R ' + rtFee.toFixed(2);
                        document.getElementById('simWholesale').innerText = 'R ' + whCost.toFixed(2);
                        document.getElementById('simProfit').style.color = profit >= 1 ? '#10b981' : '#ef4444';
                    }
                    window.onload = runSim;
                </script>
            `;

            // --- COMPONENT 2: The Tables ---
            const tablesSection = `
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:30px;">
                    <div class="card-form" style="max-width:100%;">
                        <h3 style="margin-top:0;">🛡️ Fixed Service Fees (ZAR)</h3>
                        <table>
                            <thead><tr><th>Code</th><th>Amount</th></tr></thead>
                            <tbody>${makeRows(platformFees)}</tbody>
                        </table>
                    </div>
                    <div class="card-form" style="max-width:100%;">
                        <h3>💳 Transaction & Module Variables</h3>
                        <table>
                            <thead><tr><th>Code</th><th>Variable</th></tr></thead>
                            <tbody>${makeRows(txVars)}</tbody>
                        </table>
                    </div>
                </div>
            `;

            // --- COMPONENT 3: The Danger Zone ---
            const resetSection = `
                <div style="margin-top:50px; border-top:1px solid #e2e8f0; padding-top:20px; text-align:right;">
                    <h4 style="color:#e53e3e; margin:0;">🚨 Danger Zone</h4>
                    <p style="font-size:12px; color:#718096; margin-bottom:10px;">
                        Messed up the pricing? Click below to revert all fees to the system defaults defined in code.
                    </p>
                    <form action="/admin/pricing/reset" method="POST" onsubmit="return confirm('⚠️ Are you sure? This will overwrite all custom pricing with the system defaults.');">
                        <button class="btn btn-danger" style="background:#e53e3e; padding:8px 15px;">Reset All to Defaults</button>
                    </form>
                </div>
            `;

            // Combine everything into one unique variable
            const fullPageContent = simulatorSection + tablesSection + resetSection;

            res.send(renderAdminPage('Pricing Engine', fullPageContent));

        } catch (e) {
            res.send(renderAdminPage('Pricing Error', '', e.message));
        }
    });

    // POST: Update Price
    app.post('/admin/pricing/update', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        try {
            const { code, amount } = req.body;
            await prisma.servicePrice.update({
                where: { code: code },
                data: { amount: parseFloat(amount) }
            });
            res.redirect('/admin/pricing');
        } catch (e) {
            res.send(renderAdminPage('Pricing Error', '', e.message));
        }
    });

    // POST: Emergency Reset to Defaults
    app.post('/admin/pricing/reset', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        
        // Import the master defaults
        const { DEFAULT_PRICES } = require('../services/pricing');

        try {
            console.log("⚠️ [ADMIN] Resetting Pricing to Defaults...");
            
            // Loop through defaults and force update the DB
            for (const [code, amount] of Object.entries(DEFAULT_PRICES)) {
                await prisma.servicePrice.upsert({
                    where: { code: code },
                    update: { amount: amount },
                    create: { code, amount, description: `Auto-generated price for ${code}` }
                });
            }
            res.redirect('/admin/pricing');
        } catch (e) {
            res.send(renderAdminPage('Reset Error', '', e.message));
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
    // ⚖️ ENHANCED: REGULATORY COMPLIANCE & LSO DASHBOARD
    // ============================================================
    app.get('/admin/compliance', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');

        try {
            // 1. Fetch Live Regulatory Metrics
            const txStats = await prisma.transaction.aggregate({
                _sum: { amount: true },
                _count: { id: true },
                where: { status: 'SUCCESS' }
            });

            const totalVolume = txStats._sum.amount || 0;
            const totalTx = txStats._count.id || 0;
            const activeMandates = await prisma.member.count({ where: { status: 'ACTIVE_DEBIT_ORDER' } });
            const kybOrgs = await prisma.church.count({ where: { ficaStatus: 'ACTIVE' } });

            // 2. Regulatory Thresholds (PASA Directive 2)
            const legalValueThreshold = 10000000; // R10M
            const legalCountThreshold = 10000;    // 10k Transactions
            const goalValueThreshold  = 50000000; // R50M
            const goalCountThreshold  = 50000;    // 50k Transactions

            // 3. Calculate Progress Percentages
            const legalValProg = Math.min((totalVolume / legalValueThreshold) * 100, 100).toFixed(1);
            const legalCntProg = Math.min((totalTx / legalCountThreshold) * 100, 100).toFixed(1);
            
            const goalValProg = Math.min((totalVolume / goalValueThreshold) * 100, 100).toFixed(1);
            const goalCntProg = Math.min((totalTx / goalCountThreshold) * 100, 100).toFixed(1);

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

                <div class="card-form" style="max-width:100%; margin-bottom:30px; border-left: 5px solid #2ecc71;">
                    <h3 style="margin-top:0; color:#27ae60;">🚀 Business Scale Milestone (Series A Goal)</h3>
                    <p style="color:#7f8c8d; font-size:13px;">Trajectory toward R50 Million/month for wholesale pricing and direct bank clearing.</p>
                    
                    <div style="margin-bottom:15px;">
                        <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:bold; margin-bottom:5px;">
                            <span>VALUE (Goal: R50M)</span>
                            <span>${goalValProg}%</span>
                        </div>
                        <div style="background:#ecf0f1; border-radius:10px; height:12px; width:100%; overflow:hidden; border:1px solid #ddd;">
                            <div style="background:#2ecc71; width:${goalValProg}%; height:100%; transition:1.5s;"></div>
                        </div>
                    </div>

                    <div style="margin-bottom:5px;">
                        <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:bold; margin-bottom:5px;">
                            <span>VOLUME (Goal: 50,000 tx)</span>
                            <span>${goalCntProg}%</span>
                        </div>
                        <div style="background:#ecf0f1; border-radius:10px; height:12px; width:100%; overflow:hidden; border:1px solid #ddd;">
                            <div style="background:#27ae60; width:${goalCntProg}%; height:100%; transition:1.5s;"></div>
                        </div>
                    </div>
                </div>
            `;

            res.send(renderAdminPage('Regulatory Compliance', content));
        } catch (error) {
            res.send(renderAdminPage('Regulatory Compliance', '', error.message));
        }
    });

    // ============================================================
    // 🎓 AI COURSE BUILDER (LMS)
    // ============================================================
    
    // 1. DASHBOARD: UPLOAD + LIST
    app.get('/admin/course-builder', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');

        try {
            // Upload Form Options
            const churches = await prisma.church.findMany({ select: { id: true, name: true } });
            let options = churches.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

            // Course List
            const courses = await prisma.course.findMany({
                include: { church: true, _count: { select: { modules: true } } },
                orderBy: { id: 'desc' }
            });

            // Table Rows
            const courseRows = courses.map(c => `
                <tr>
                    <td><strong>${c.title}</strong><br><span style="font-size:11px; color:#95a5a6;">${c.code || 'N/A'}</span></td>
                    <td><span class="tag tag-church">${c.church ? c.church.name : 'Global'}</span></td>
                    <td>R${c.price}</td>
                    <td>${c._count.modules} Modules</td>
                    <td><span class="tag" style="${c.status==='LIVE'?'background:#e8f5e9; color:green;':'background:#fff3e0; color:orange;'}">${c.status}</span></td>
                    <td style="text-align:right;">
                        <a href="/admin/course-builder/edit/${c.id}" class="btn btn-edit">Edit</a>
                        <form method="POST" action="/admin/course-builder/delete" style="display:inline; margin-left:5px;" onsubmit="return confirm('Delete?');">
                            <input type="hidden" name="id" value="${c.id}">
                            <button class="btn btn-danger">Del</button>
                        </form>
                    </td>
                </tr>
            `).join('');

            const content = `
                <div style="display:grid; grid-template-columns: 1fr 1.5fr; gap:30px; align-items:start;">
                    <div class="card-form" style="max-width: 100%;">
                        <h3 style="margin-top:0;">🤖 AI Generator</h3>
                        <p style="color:#7f8c8d; margin-top:-10px; margin-bottom:20px; font-size:13px;">Upload a PDF to create a WhatsApp course.</p>
                        <form id="courseUploadForm">
                            <div class="form-group"><label>Organization</label><select id="orgId" required>${options}</select></div>
                            <div class="form-group"><label>Price (R)</label><input type="number" id="price" value="0" required></div>
                            <div class="form-group"><label>PDF</label><input type="file" id="pdfFile" accept=".pdf" required style="padding:10px; border:2px dashed #00d2d3; background:#fdfdfd;"></div>
                            <div id="statusBox" style="display:none; padding:15px; border-radius:5px; margin-top:15px; font-weight:bold; text-align:center;"></div>
                            <button type="submit" id="submitBtn" class="btn btn-primary" style="width:100%; margin-top:10px;">Generate</button>
                        </form>
                    </div>

                    <div class="card-form" style="max-width: 100%;">
                        <h3 style="margin-top:0;">📚 Courses</h3>
                        <table>
                            <thead><tr><th>Title</th><th>Org</th><th>Price</th><th>Size</th><th>Status</th><th>Action</th></tr></thead>
                            <tbody>${courseRows.length > 0 ? courseRows : '<tr><td colspan="6" style="text-align:center;">No courses.</td></tr>'}</tbody>
                        </table>
                    </div>
                </div>
                <script>
                    document.getElementById('courseUploadForm').addEventListener('submit', async (e) => {
                        e.preventDefault();
                        const btn = document.getElementById('submitBtn');
                        const status = document.getElementById('statusBox');
                        btn.innerText = "⏳ Processing PDF..."; btn.disabled = true; status.style.display = 'none';
                        const formData = new FormData();
                        formData.append('orgId', document.getElementById('orgId').value);
                        formData.append('price', document.getElementById('price').value);
                        formData.append('coursePdf', document.getElementById('pdfFile').files[0]);
                        try {
                            const res = await fetch('/api/admin/parse-course', { method: 'POST', body: formData });
                            const data = await res.json();
                            if (data.success) {
                                status.style.background = "#e8f5e9"; status.style.color = "#27ae60"; status.innerHTML = "✅ Success!";
                                setTimeout(() => window.location.reload(), 2000);
                            } else throw new Error(data.error);
                        } catch (err) {
                            status.style.display = 'block'; status.style.background = "#ffebee"; status.style.color = "#c0392b"; status.innerText = "❌ " + err.message;
                            btn.innerText = "Generate"; btn.disabled = false;
                        }
                    });
                </script>
            `;
            res.send(renderAdminPage('AI Course Builder', content));
        } catch (e) {
            res.send(renderAdminPage('Error', '', e.message));
        }
    });

	// ==========================================
    // 🚀 NEW: MODULE EDITOR LOGIC
    // ==========================================

    // 2. VIEW & EDIT COURSE (Updated with Module Edit Buttons)
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

            // 🚀 UPDATED: Module List now has an "Edit" button
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
                            <button class="btn btn-primary" style="font-size:11px; opacity:0.5; cursor:not-allowed;">+ Add Module (Coming Soon)</button>
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

    // 🚀 NEW ROUTE: MODULE EDITOR FORM (Fixed to show AI Text)
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

    // 🚀 NEW ROUTE: UPDATE MODULE DB (Saves to both fields)
    app.post('/admin/course-builder/module/update', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        try {
            await prisma.module.update({
                where: { id: parseInt(req.body.id) },
                data: {
                    title: req.body.title,
                    order: parseInt(req.body.order),
                    
                    // 🛠️ FIX: Save to both fields to keep them in sync
                    dailyLessonText: req.body.dailyLessonText,
                    content: req.body.dailyLessonText, 
                    
                    // 🛠️ FIX: Save Quiz Data
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

    // 🚀 NEW ROUTE: DELETE MODULE DB
    app.post('/admin/course-builder/module/delete', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        try {
            await prisma.module.delete({ where: { id: parseInt(req.body.id) } });
            res.redirect(`/admin/course-builder/edit/${req.body.courseId}`);
        } catch (e) {
            res.send(renderAdminPage('Delete Error', '', e.message));
        }
    });
    // 3. POST ACTIONS (Update/Delete/Parse)
    app.post('/admin/course-builder/update', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        await prisma.course.update({ where: { id: parseInt(req.body.id) }, data: { title: req.body.title, description: req.body.description, price: parseFloat(req.body.price), status: req.body.status } });
        res.redirect('/admin/course-builder');
    });

    app.post('/admin/course-builder/delete', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        await prisma.course.delete({ where: { id: parseInt(req.body.id) } });
        res.redirect('/admin/course-builder');
    });

    app.post('/api/admin/parse-course', upload.single('coursePdf'), async (req, res) => {
        const cookies = parseCookies(req);
        if (cookies[COOKIE_NAME] !== ADMIN_SECRET) return res.status(401).json({ success: false, error: "Unauthorized" });
        if (!req.file) return res.status(400).json({ success: false, error: "No PDF uploaded." });
        try {
            const pdfBuffer = fs.readFileSync(req.file.path);
            const result = await processAndImportCoursePDF(pdfBuffer, req.file.mimetype, req.body.orgId, req.body.price);
            try { fs.unlinkSync(req.file.path); } catch (e) {}
            if (result.success) res.json(result); else res.status(500).json(result);
        } catch (err) { res.status(500).json({ success: false, error: "Failed to read file." }); }
    });


    // ============================================================
    // 🛡️ FICA & KYB COMPLIANCE DASHBOARD
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

            // 2. Email client linking to the Secure FICA Portal
            if (org.email || org.officialEmail) {
                const targetEmail = org.officialEmail || org.email;
                const host = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
                const portalLink = `${host}/crm/fica-portal.html?code=${org.code}`;
                
                await sgMail.send({
                    to: targetEmail,
                    from: process.env.EMAIL_FROM || 'admin@seabe.tech',
                    subject: `Action Required: FICA Level 1 Approved for ${org.name}`,
                    text: `Great news! Your Level 1 FICA is approved.\n\nTo activate your NetCash merchant account, please upload your Level 2 corporate documents securely via your dedicated portal:\n\n👉 Click here to upload: ${portalLink}\n\nDocuments required:\n- NPC Certificate / Constitution\n- CIPC Registration\n- Director IDs`
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

            // 1. Map data for NetCash API
            const netcashData = {
                name: org.name,
                adminName: org.contactPerson || 'Admin',
                email: org.officialEmail || org.email || 'admin@seabe.tech',
                phone: org.adminPhone || org.phone || '0000000000',
                bankName: org.bankName || 'Standard Bank', 
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
                        subaccountCode: netcashResponse.PayNowKey 
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
    // 1. ORGANIZATIONS (With AI Vision Feature)
    // ============================================================
    app.get('/admin/churches', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const q = req.query.q || '';
        
        try {
            const items = await prisma.church.findMany({ 
                where: { OR: [ {name:{contains:q, mode:'insensitive'}}, {code:{contains:q, mode:'insensitive'}} ]},
                orderBy: { createdAt: 'desc' } 
            });

            const rows = items.map(c => `
                <tr>
                    <td><strong>${c.name}</strong><br><span style="font-size:11px; color:#999;">${c.code}</span></td>
                    <td>${c.type}</td>
                    <td><a href="/admin/churches/edit/${c.code}" class="btn btn-edit">Manage</a></td>
                </tr>
            `).join('');

            res.send(renderAdminPage('Manage Organizations', `
                <div style="display:flex; justify-content:space-between; margin-bottom:20px; align-items:center;">
                    <form action="/admin/churches" class="search-bar" style="margin:0;">
                        <input name="q" value="${q}" placeholder="Search Name, Code..." style="padding:10px; width:300px; border:1px solid #ddd; border-radius:4px;">
                        <button class="btn btn-primary">Search</button>
                    </form>
                    <a href="/admin/churches/add" class="btn btn-primary" style="background:#00d2d3; color:black;">+ New Organization</a>
                </div>
                <table>
                    <thead><tr><th>Organization</th><th>Type</th><th>Actions</th></tr></thead>
                    <tbody>${rows.length > 0 ? rows : '<tr><td colspan="3">No results.</td></tr>'}</tbody>
                </table>
            `));
        } catch (e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    // 🚀 EDIT ORGANIZATION (Updated with AI Vision Scanner)
    app.get('/admin/churches/edit/:code', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        
        try {
            const c = await prisma.church.findUnique({ where: { code: req.params.code } });
            const qrImage = await generatePaymentQR(c.code);

            res.send(renderAdminPage('Edit Organization', `
                <div style="display:flex; flex-wrap:wrap; gap:30px; align-items:start;">
                    
                    <div style="flex:2; min-width:300px;">
                        <form action="/admin/churches/update" method="POST" class="card-form" style="max-width:100%;">
                            <input type="hidden" name="code" value="${c.code}">
                            <div class="form-group"><label>Name (Locked)</label><input value="${c.name}" disabled style="background:#f0f0f0;"></div>
                            <div class="form-group"><label>Admin Phone</label><input name="adminPhone" value="${c.adminPhone}"></div>
                            <div class="form-group"><label>Email</label><input name="email" value="${c.email}"></div>
                            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px;">
                                <div class="form-group"><label>Premium</label><input name="defaultPremium" value="${c.defaultPremium}"></div>
                                <div class="form-group"><label>Sub Fee</label><input name="subscriptionFee" value="${c.subscriptionFee}"></div>
                            </div>
                            <div class="form-group"><label>Gateway Code</label><input name="subaccount" value="${c.subaccountCode||''}"></div>
                            <button class="btn btn-primary">Update Organization</button>
                        </form>
                    </div>

                    <div style="flex:1; min-width:250px;">
                        
                        <div class="card-form" style="text-align:center; margin-bottom: 20px;">
                            <h3 style="margin-top:0; color:#2c3e50;">📲 Scan to Pay</h3>
                            <img src="${qrImage}" style="width:100%; max-width:150px; border-radius:8px; border:4px solid #fff; box-shadow:0 2px 10px rgba(0,0,0,0.1); margin:0 auto; display:block;">
                            <a href="${qrImage}" download="QR_${c.code}.png" class="btn" style="background:#2d3436; color:white; width:100%; margin-top:10px; display:block; box-sizing:border-box;">⬇️ Download</a>
                        </div>

                        <div class="card-form" style="border-top: 5px solid #8e44ad;">
                            <h3 style="margin-top:0; color:#8e44ad;">✨ AI Magic Scanner</h3>
                            <p style="font-size:12px; color:#7f8c8d;">Upload a flyer or policy document. AI will extract plans and events automatically.</p>
                            
                            <input type="file" id="scannerInput" accept="image/*" style="width:100%; padding: 10px; border: 1px dashed #8e44ad; background: #f3e5f5; border-radius: 4px;">
                            <button onclick="scanImage()" class="btn" style="width:100%; background: #8e44ad; color:white; margin-top:10px;">🔍 Scan Image</button>
                            
                            <div id="aiLoader" class="ai-loader">🔮 Analyzing Image...</div>
                            
                            <div id="aiResults" class="ai-result-box"></div>
                        </div>

                    </div>
                </div>

                <script>
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
                                let html = '<strong>Found: ' + info.type + '</strong><br><hr style="border:0; border-top:1px solid #ddd; margin:5px 0;">';
                                
                                if (info.type === 'POLICY' && info.items) {
                                    info.items.forEach(plan => {
                                        html += '<div style="margin-bottom:10px; font-size:12px;">';
                                        html += '<strong>' + plan.name + '</strong> (R' + plan.price + ')<br>';
                                        html += '<span style="color:#666;">' + plan.benefits.length + ' Benefits detected.</span>';
                                        html += '</div>';
                                    });
                                    html += '<button onclick="savePlans()" class="btn" style="width:100%; background:#27ae60; color:white; font-size:11px;">💾 Save Plans to DB</button>';
                                } 
                                else if (info.type === 'EVENT') {
                                    html += '<div style="font-size:12px;">';
                                    html += '<strong>' + info.title + '</strong><br>';
                                    html += '📅 ' + info.date + '<br>📍 ' + info.location;
                                    html += '</div>';
                                    html += '<button onclick="saveEvent()" class="btn" style="width:100%; background:#2980b9; color:white; font-size:11px; margin-top:10px;">📅 Create Event</button>';
                                }
                                else {
                                    html += '<span style="color:orange">Could not identify clear data.</span>';
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

                    function savePlans() { alert("Simulated: Plans saved to database!"); }
                    function saveEvent() { alert("Simulated: Event created!"); }
                </script>
            `));
        } catch(e) {
            res.send(renderAdminPage('Error', '', e.message));
        }
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

    // 🚀 NEW API: HANDLE IMAGE EXTRACTION
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