const express = require('express');
const router = express.Router();
const { sendWhatsApp } = require('../services/whatsapp');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const twilio = require('twilio');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');

// Setup Multer for CSV Uploads
const upload = multer({ dest: 'uploads/' });

// Initialize Twilio Client
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

// --- HELPERS ---
const generateOTP = () => Math.floor(1000 + Math.random() * 9000).toString();
const safeDate = (d) => (d ? new Date(d) : new Date());

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
    const navStyle = (tab) => `
        padding: 10px 15px; 
        text-decoration: none; 
        color: ${activeTab === tab ? '#000' : '#888'}; 
        border-bottom: ${activeTab === tab ? '3px solid #00d2d3' : 'none'};
        font-weight: bold; font-size: 14px;
    `;

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>${org.name} | Admin</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: -apple-system, sans-serif; background: #f4f7f6; margin: 0; padding-bottom: 50px; }
            .header { background: white; padding: 20px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
            .nav { background: white; padding: 0 20px; border-bottom: 1px solid #ddd; overflow-x: auto; white-space: nowrap; }
            .container { padding: 20px; max-width: 800px; margin: 0 auto; }
            .card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); margin-bottom: 20px; }
            .btn { display: inline-block; padding: 12px 20px; background: #1e272e; color: white; text-decoration: none; border-radius: 8px; border: none; font-weight: bold; font-size: 14px; width: 100%; text-align: center; cursor: pointer; }
            .btn-del { background: #ffebeb; color: #d63031; padding: 5px 10px; font-size: 11px; width: auto; border-radius: 4px; border:none; }
            input, select, textarea { width: 100%; padding: 12px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; }
            label { display: block; margin-bottom: 5px; font-weight: bold; font-size: 12px; color: #555; text-transform: uppercase; }
            table { width: 100%; border-collapse: collapse; }
            td, th { padding: 12px 8px; border-bottom: 1px solid #eee; font-size: 14px; text-align: left; }
            .badge { padding: 4px 8px; border-radius: 4px; font-size: 10px; color: white; font-weight: bold; }
        </style>
    </head>
    <body>
        <div class="header">
            <div style="font-weight:bold; font-size:18px;">${org.name}</div>
            <a href="/admin/${org.code}/logout" style="font-size:12px; color:red; text-decoration:none;">Logout</a>
        </div>
        <div class="nav">
            <a href="/admin/${org.code}/dashboard" style="${navStyle('dashboard')}">📊 Dashboard</a>
            <a href="/admin/${org.code}/members" style="${navStyle('members')}">👥 Members</a>
            <a href="/admin/${org.code}/claims" style="${navStyle('claims')}">📑 Claims</a>
            <a href="/admin/${org.code}/events" style="${navStyle('events')}">📅 Events</a>
            <a href="/admin/${org.code}/ads" style="${navStyle('ads')}">📢 Ads</a>
            <a href="/admin/${org.code}/settings" style="${navStyle('settings')}">⚙️ Settings</a>
        </div>
        <div class="container">${content}</div>
    </body>
    </html>`;
};

// --- ⚙️ UNPROTECTED CRON SYNC ROUTE ---
router.get('/admin/:code/sync-payments', async (req, res) => {
    const { code } = req.params;
    const { key } = req.query;
    if (!key || key !== process.env.CRON_SECRET) {
        return res.status(401).send("Unauthorized");
    }
    try {
        console.log(`[Cron] Syncing payments for ${code}`);
        res.status(200).send("Sync Complete");
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// --- MIDDLEWARE ---
const checkSession = async (req, res, next) => {
    const { code } = req.params;
    const cookies = parseCookies(req);
    if (!cookies[`session_${code}`]) return res.redirect(`/admin/${code}`);
    req.org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
    if (!req.org) return res.send("Organization not found");
    next();
};

// --- LOGIN ROUTES ---
router.get('/admin/:code', async (req, res) => {
    const { code } = req.params;
    const org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
    if (!org) return res.send("<h3>Organization not found.</h3>");
    const otp = generateOTP();
    await prisma.church.update({ 
        where: { code: code.toUpperCase() }, 
        data: { otp, otpExpires: new Date(Date.now() + 5 * 60000) } 
    });
    if (org.adminPhone) await sendWhatsApp(org.adminPhone, `🔐 *${org.name} Admin*\n\nLogin OTP: *${otp}*`);
    res.send(`
        <html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; background:#f4f7f6; margin:0;">
            <form action="/admin/${code}/verify" method="POST" style="background:white; padding:30px; border-radius:10px; width:300px; box-shadow:0 10px 25px rgba(0,0,0,0.1);">
                <h3 style="text-align:center;">🔐 ${org.name}</h3>
                <input name="otp" placeholder="0000" maxlength="4" style="font-size:24px; text-align:center; width:100%; padding:10px; margin-bottom:15px;" required>
                <button style="width:100%; padding:15px; background:#1e272e; color:white; border:none; border-radius:5px; font-weight:bold; cursor:pointer;">Login</button>
            </form>
        </body></html>
    `);
});

router.post('/admin/:code/verify', async (req, res) => {
    const { code } = req.params;
    const org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
    if (!org || org.otp !== req.body.otp) return res.send("<h3>❌ Invalid OTP</h3>");
    res.setHeader('Set-Cookie', `session_${code}=active; HttpOnly; Path=/; Max-Age=3600`);
    res.redirect(`/admin/${code}/dashboard`);
});

router.get('/admin/:code/logout', (req, res) => {
    res.setHeader('Set-Cookie', `session_${req.params.code}=; Path=/; Max-Age=0`);
    res.redirect(`/admin/${req.params.code}`);
});

// --- DASHBOARD ---
router.get('/admin/:code/dashboard', checkSession, async (req, res) => {
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const transactions = await prisma.transaction.findMany({
        where: { churchCode: req.org.code, status: 'SUCCESS', date: { gte: startOfMonth } },
        orderBy: { id: 'desc' }
    });
    const titheTotal = transactions.filter(tx => ['OFFERING', 'TITHE'].includes(tx.type)).reduce((sum, tx) => sum + tx.amount, 0);
    const premiumTotal = transactions.filter(tx => tx.type === 'SOCIETY_PREMIUM').reduce((sum, tx) => sum + tx.amount, 0);

    res.send(renderPage(req.org, 'dashboard', `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px;">
            <div class="card" style="border-left: 5px solid #00b894;"><small>COLLECTIONS</small><h2>R${(titheTotal + premiumTotal).toLocaleString()}</h2></div>
            <div class="card" style="border-left: 5px solid #0984e3;"><small>TITHES</small><h2>R${titheTotal.toLocaleString()}</h2></div>
            <div class="card" style="border-left: 5px solid #6c5ce7;"><small>PREMIUMS</small><h2>R${premiumTotal.toLocaleString()}</h2></div>
        </div>
        <div class="card"><h3>📈 Recent Activity</h3>
            <table>${transactions.slice(0, 10).map(tx => `<tr><td>${tx.phone}</td><td><span style="background:#eee; padding:2px 5px; font-size:10px;">${tx.type}</span></td><td><strong>R${tx.amount}</strong></td></tr>`).join('')}</table>
        </div>
    `));
});

// --- 👥 MEMBERS PAGE ---
router.get('/admin/:code/members', checkSession, async (req, res) => {
    const { q } = req.query;
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const members = await prisma.member.findMany({
        where: {
            OR: [{ churchCode: req.org.code }, { societyCode: req.org.code }],
            ...(q ? { OR: [{ phone: { contains: q } }, { lastName: { contains: q, mode: 'insensitive' } }, { firstName: { contains: q, mode: 'insensitive' } }] } : {})
        },
        include: { transactions: { where: { status: 'SUCCESS', type: 'SOCIETY_PREMIUM', date: { gte: startOfMonth } } } },
        orderBy: { lastName: 'asc' }
    });

    const rows = members.map(m => {
        const paid = m.transactions.reduce((s, tx) => s + tx.amount, 0);
        const reqAmt = m.monthlyPremium || 150.0;
        const color = paid >= reqAmt ? '#2ecc71' : (paid > 0 ? '#f1c40f' : '#e74c3c');
        return `<tr><td><b>${m.firstName} ${m.lastName}</b><br><small>${m.phone}</small></td><td><span class="badge" style="background:${color}">${paid >= reqAmt ? 'PAID' : (paid > 0 ? 'PARTIAL' : 'OUTSTANDING')}</span><div style="font-size:10px;">R${paid} / R${reqAmt}</div></td><td><form method="POST" action="/admin/${req.org.code}/members/delete"><input type="hidden" name="id" value="${m.id}"><button class="btn-del">Delete</button></form></td></tr>`;
    }).join('');

    res.send(renderPage(req.org, 'members', `<div class="card" style="background:#1e272e; color:white;"><h3>📊 Collection Cycle</h3><a href="/admin/${req.org.code}/members/export-arrears" class="btn" style="background:#d63031; width:auto; font-size:12px;">📥 Export Arrears CSV</a></div><div class="card"><form method="GET"><input name="q" value="${q || ''}" placeholder="Search..."><button class="btn">Search</button></form></div><div class="card"><table>${rows}</table></div>`));
});

// --- 📄 EXPORT ARREARS ---
router.get('/admin/:code/members/export-arrears', checkSession, async (req, res) => {
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const members = await prisma.member.findMany({
        where: { OR: [{ churchCode: req.org.code }, { societyCode: req.org.code }] },
        include: { transactions: { where: { status: 'SUCCESS', type: 'SOCIETY_PREMIUM', date: { gte: startOfMonth } } } }
    });
    const outstanding = members.filter(m => m.transactions.reduce((s, t) => s + t.amount, 0) < (m.monthlyPremium || 150.0));
    let csv = "Name,Phone,Required,Paid,Balance\n";
    outstanding.forEach(m => {
        const paid = m.transactions.reduce((s, t) => s + t.amount, 0);
        const prem = m.monthlyPremium || 150.0;
        csv += `${m.firstName} ${m.lastName},${m.phone},${prem},${paid},${prem - paid}\n`;
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=Arrears_${req.org.code}.csv`);
    res.send(csv);
});

// --- 📑 CLAIMS MANAGEMENT (UPDATED FOR MEMBER RELATION) ---
router.get('/admin/:code/claims', checkSession, async (req, res) => {
    const claims = await prisma.claim.findMany({
        where: { churchCode: req.org.code },
        include: { member: true }, // ✅ NEW: Fetch member names from relation
        orderBy: { createdAt: 'desc' }
    });

    const rows = claims.map(c => {
        const colors = { PENDING: '#f1c40f', APPROVED: '#0984e3', PAID: '#27ae60', DECLINED: '#d63031' };
        return `<tr><td><b>${c.beneficiaryName}</b><br><small>Policy: ${c.member ? c.member.firstName + ' ' + c.member.lastName : c.memberPhone}</small></td><td>R${c.payoutAmount}</td><td><span class="badge" style="background:${colors[c.status] || '#eee'}">${c.status}</span></td><td><form method="POST" action="/admin/${req.org.code}/claims/update"><input type="hidden" name="id" value="${c.id}"><select name="status" onchange="this.form.submit()"><option value="">Update...</option><option value="APPROVED">Approve</option><option value="PAID">Mark Paid</option><option value="DECLINED">Decline</option></select></form></td></tr>`;
    }).join('');

    res.send(renderPage(req.org, 'claims', `<div class="card"><h3>📑 Log New Claim</h3><form method="POST" action="/admin/${req.org.code}/claims/add"><input name="memberPhone" placeholder="Member Phone (e.g. +2783...)" required><input type="number" name="amount" placeholder="Claim Amount" required><input name="beneficiaryName" placeholder="Beneficiary Name" required><button class="btn">Submit Claim</button></form></div><div class="card"><table><thead><tr style="background:#f8f9fa;"><th>Details</th><th>Payout</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div>`));
});

router.post('/admin/:code/claims/add', checkSession, async (req, res) => {
    const { memberPhone, amount, beneficiaryName } = req.body;
    try {
        // ✅ NEW: Safety check to ensure member exists (Required for DB Relation)
        const member = await prisma.member.findUnique({ where: { phone: memberPhone } });
        if (!member) return res.send("<h3>❌ Error: No registered member found with that phone number.</h3><a href='javascript:history.back()'>Go Back</a>");

        await prisma.claim.create({
            data: { churchCode: req.org.code, memberPhone, beneficiaryName, payoutAmount: parseFloat(amount), status: 'PENDING' }
        });
        res.redirect(`/admin/${req.org.code}/claims`);
    } catch (e) { res.status(500).send(e.message); }
});

router.post('/admin/:code/claims/update', checkSession, async (req, res) => {
    await prisma.claim.update({ where: { id: parseInt(req.body.id) }, data: { status: req.body.status } });
    res.redirect(`/admin/${req.org.code}/claims`);
});

// --- ⚙️ SETTINGS ---
router.get('/admin/:code/settings', checkSession, async (req, res) => {
    res.send(renderPage(req.org, 'settings', `<div class="card"><h3>⚙️ Settings</h3><form method="POST" action="/admin/${req.org.code}/settings/update"><label>Org Name</label><input name="name" value="${req.org.name}"><label>Admin Phone</label><input name="adminPhone" value="${req.org.adminPhone || ''}"><label>Premium (R)</label><input type="number" name="defaultPremium" value="${req.org.defaultPremium || 150}"><button class="btn">Save Settings</button></form></div>`));
});

router.post('/admin/:code/settings/update', checkSession, async (req, res) => {
    await prisma.church.update({ where: { code: req.org.code }, data: { name: req.body.name, adminPhone: req.body.adminPhone, defaultPremium: parseFloat(req.body.defaultPremium) } });
    res.redirect(`/admin/${req.org.code}/settings`);
});

// Member CSV Upload & Others
router.post('/admin/:code/members/upload', checkSession, upload.single('file'), async (req, res) => {
    const results = [];
    fs.createReadStream(req.file.path).pipe(csv()).on('data', (d) => results.push(d)).on('end', async () => {
        for (const r of results) {
            try {
                await prisma.member.upsert({
                    where: { phone: r.phone },
                    update: { firstName: r.firstName, lastName: r.lastName, monthlyPremium: parseFloat(r.monthlyPremium) || 150.0 },
                    create: { firstName: r.firstName, lastName: r.lastName, phone: r.phone, monthlyPremium: parseFloat(r.monthlyPremium) || 150.0, churchCode: req.org.code, status: 'ACTIVE' }
                });
            } catch (e) { console.error(e.message); }
        }
        fs.unlinkSync(req.file.path);
        res.redirect(`/admin/${req.org.code}/members`);
    });
});

// (Events & Ads remain the same as your previous logic)

module.exports = (app) => { app.use('/', router); };