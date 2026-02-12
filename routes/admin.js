const express = require('express');
const router = express.Router();
const { sendWhatsApp } = require('../services/whatsapp');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const twilio = require('twilio');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const crypto = require('crypto');
const PDFDocument = require('pdfkit'); // ✅ Required: npm install pdfkit

const upload = multer({ dest: 'uploads/' });
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
    const isChurch = org.type === 'CHURCH';
    const navStyle = (tab) => `padding: 10px 15px; text-decoration: none; color: ${activeTab === tab ? '#000' : '#888'}; border-bottom: ${activeTab === tab ? '3px solid #00d2d3' : 'none'}; font-weight: bold; font-size: 14px;`;
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>${org.name} | Admin</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: -apple-system, sans-serif; background: #f4f7f6; margin: 0; padding-bottom: 50px; }
            .header { background: white; padding: 20px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
            .nav { background: white; padding: 0 20px; border-bottom: 1px solid #ddd; overflow-x: auto; white-space: nowrap; display: flex; }
            .container { padding: 20px; max-width: 800px; margin: 0 auto; }
            .card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); margin-bottom: 20px; }
            .btn { display: inline-block; padding: 12px 20px; background: #1e272e; color: white; text-decoration: none; border-radius: 8px; border: none; font-weight: bold; font-size: 14px; width: 100%; text-align: center; cursor: pointer; }
            .btn-del { background: #ffebeb; color: #d63031; padding: 5px 10px; font-size: 11px; width: auto; border-radius: 4px; border:none; }
            input, select, textarea { width: 100%; padding: 12px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; }
            label { display: block; margin-bottom: 5px; font-weight: bold; font-size: 12px; color: #555; text-transform: uppercase; }
            table { width: 100%; border-collapse: collapse; }
            td, th { padding: 12px 8px; border-bottom: 1px solid #eee; font-size: 14px; text-align: left; }
            .badge { padding: 4px 8px; border-radius: 4px; font-size: 10px; color: white; font-weight: bold; }
            a { color: #0984e3; text-decoration: none; }
        </style>
    </head>
    <body>
        <div class="header"><b>${org.name}</b><a href="/admin/${org.code}/logout" style="font-size:12px; color:red; text-decoration:none;">Logout</a></div>
        <div class="nav">
            <a href="/admin/${org.code}/dashboard" style="${navStyle('dashboard')}">📊 Dashboard</a>
            <a href="/admin/${org.code}/members" style="${navStyle('members')}">👥 Members</a>
            <a href="/admin/${org.code}/claims" style="${navStyle('claims')}">📑 Claims</a>
            ${isChurch ? `<a href="/admin/${org.code}/events" style="${navStyle('events')}">📅 Events</a>` : ''}
            <a href="/admin/${org.code}/ads" style="${navStyle('ads')}">📢 Ads</a>
            <a href="/admin/${org.code}/settings" style="${navStyle('settings')}">⚙️ Settings</a>
        </div>
        <div class="container">${content}</div>
    </body></html>`;
};

// --- SECURE CRON SYNC ---
router.get('/admin/:code/sync-payments', async (req, res) => {
    const { key } = req.query;
    if (!key || !process.env.CRON_SECRET) return res.status(401).send("Unauthorized");
    try {
        const isMatch = crypto.timingSafeEqual(Buffer.from(key), Buffer.from(process.env.CRON_SECRET));
        if (!isMatch) return res.status(401).send("Unauthorized");
        res.status(200).send("Sync Complete");
    } catch (e) { res.status(401).send("Unauthorized"); }
});

// --- MIDDLEWARE ---
const checkSession = async (req, res, next) => {
    const { code } = req.params;
    const cookies = parseCookies(req);
    if (!cookies[`session_${code}`]) return res.redirect(`/admin/${code}`);
    req.org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
    if (!req.org) return res.send("Not Found");
    next();
};

// --- AUTH ---
router.get('/admin/:code', async (req, res) => {
    const { code } = req.params;
    const org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
    if (!org) return res.send("Not Found");
    const otp = generateOTP();
    await prisma.church.update({ where: { code: code.toUpperCase() }, data: { otp, otpExpires: new Date(Date.now() + 5 * 60000) } });
    if (org.adminPhone) await sendWhatsApp(org.adminPhone, `🔐 *${org.name} Admin*\n\nLogin OTP: *${otp}*`);
    res.send(`<html><body style="font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; background:#f4f7f6; margin:0;"><form action="/admin/${code}/verify" method="POST" style="background:white; padding:30px; border-radius:10px; width:300px; box-shadow:0 10px 25px rgba(0,0,0,0.1);"><h3 style="text-align:center;">🔐 ${org.name}</h3><input name="otp" placeholder="0000" maxlength="4" style="font-size:24px; text-align:center; width:100%; padding:10px; margin-bottom:15px;" required><button style="width:100%; padding:15px; background:#1e272e; color:white; border:none; border-radius:5px; font-weight:bold; cursor:pointer;">Login</button></form></body></html>`);
});

router.post('/admin/:code/verify', async (req, res) => {
    const { code } = req.params;
    const org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
    if (!org || org.otp !== req.body.otp) return res.send("Invalid OTP");
    res.setHeader('Set-Cookie', `session_${code}=active; HttpOnly; Path=/; Max-Age=3600`);
    res.redirect(`/admin/${code}/dashboard`);
});

// --- DASHBOARD ---
router.get('/admin/:code/dashboard', checkSession, async (req, res) => {
    const isChurch = req.org.type === 'CHURCH';
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const [transactions, claims] = await Promise.all([
        prisma.transaction.findMany({ where: { churchCode: req.org.code, status: 'SUCCESS', date: { gte: startOfMonth } }, orderBy: { id: 'desc' } }),
        prisma.claim.findMany({ where: { churchCode: req.org.code, status: 'PENDING' } })
    ]);
    const titheTotal = transactions.filter(tx => ['TITHE', 'OFFERING'].includes(tx.type)).reduce((s, tx) => s + tx.amount, 0);
    const premiumTotal = transactions.filter(tx => tx.type === 'SOCIETY_PREMIUM').reduce((s, tx) => s + tx.amount, 0);
    const liabilityTotal = claims.reduce((s, c) => s + c.payoutAmount, 0);

    let cards = isChurch 
        ? `<div class="card" style="border-left:5px solid #00b894;"><small>TITHES</small><h2>R${titheTotal.toLocaleString()}</h2></div><div class="card" style="border-left:5px solid #6c5ce7;"><small>PREMIUMS</small><h2>R${premiumTotal.toLocaleString()}</h2></div><div class="card" style="border-left:5px solid #e67e22;"><small>CLAIMS LIABILITY</small><h2>R${liabilityTotal.toLocaleString()}</h2></div>`
        : `<div class="card" style="border-left:5px solid #6c5ce7;"><small>COLLECTIONS</small><h2>R${premiumTotal.toLocaleString()}</h2></div><div class="card" style="border-left:5px solid #e74c3c;"><small>CLAIMS LIABILITY</small><h2>R${liabilityTotal.toLocaleString()}</h2></div><div class="card" style="border-left:5px solid #0984e3;"><small>ACTIVE CLAIMS</small><h2>${claims.length}</h2></div>`;

    res.send(renderPage(req.org, 'dashboard', `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;margin-bottom:20px;">${cards}</div><div class="card"><h3>📈 Recent Activity</h3><table>${transactions.slice(0, 5).map(tx => `<tr><td>${tx.phone}</td><td>${isChurch ? tx.type : 'PREMIUM'}</td><td><strong>R${tx.amount}</strong></td></tr>`).join('')}</table></div>`));
});

// --- MEMBERS ---
router.get('/admin/:code/members', checkSession, async (req, res) => {
    const { q } = req.query;
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const members = await prisma.member.findMany({
        where: { OR: [{ churchCode: req.org.code }, { societyCode: req.org.code }], ...(q ? { OR: [{ phone: { contains: q } }, { lastName: { contains: q, mode: 'insensitive' } }, { firstName: { contains: q, mode: 'insensitive' } }] } : {}) },
        include: { transactions: { where: { status: 'SUCCESS', type: 'SOCIETY_PREMIUM', date: { gte: startOfMonth } } } },
        orderBy: { lastName: 'asc' }
    });
    const rows = members.map(m => {
        const paid = m.transactions.reduce((s, tx) => s + tx.amount, 0);
        const reqAmt = m.monthlyPremium || 150.0;
        const color = paid >= reqAmt ? '#2ecc71' : (paid > 0 ? '#f1c40f' : '#e74c3c');
        return `<tr><td><a href="/admin/${req.org.code}/members/${m.phone}"><b>${m.firstName} ${m.lastName}</b></a><br><small>${m.phone}</small></td><td><span class="badge" style="background:${color}">${paid >= reqAmt ? 'PAID' : (paid > 0 ? 'PARTIAL' : 'OUTSTANDING')}</span><div style="font-size:10px;">R${paid} / R${reqAmt}</div></td><td><form method="POST" action="/admin/${req.org.code}/members/delete"><input type="hidden" name="id" value="${m.id}"><button class="btn-del">Delete</button></form></td></tr>`;
    }).join('');
    res.send(renderPage(req.org, 'members', `<div class="card" style="background:#1e272e; color:white; display:flex; justify-content:space-between; align-items:center;"><h3>📊 Cycle Summary</h3><a href="/admin/${req.org.code}/members/export-arrears" class="btn" style="background:#d63031; width:auto; font-size:12px;">📥 Export Arrears</a></div><div class="card"><form method="GET"><input name="q" value="${q || ''}" placeholder="Search..."><button class="btn">Search</button></form><form method="POST" action="/admin/${req.org.code}/members/upload" enctype="multipart/form-data" style="margin-top:15px; border-top:1px solid #eee; padding-top:15px;"><label>Import CSV</label><input type="file" name="file" accept=".csv" required><button class="btn" style="background:#0984e3;">Upload</button></form></div><div class="card"><table>${rows}</table></div>`));
});

// --- MEMBER DETAIL & PDF ---
router.get('/admin/:code/members/:phone', checkSession, async (req, res) => {
    const member = await prisma.member.findUnique({ where: { phone: req.params.phone }, include: { transactions: { orderBy: { date: 'desc' } }, claims: { orderBy: { createdAt: 'desc' } } } });
    if (!member) return res.send("Member not found");
    const txRows = member.transactions.map(t => `<tr><td>${t.date.toLocaleDateString()}</td><td>${t.type}</td><td>R${t.amount}</td><td>${t.status}</td></tr>`).join('');
    const claimRows = member.claims.map(c => `<tr><td>${c.createdAt.toLocaleDateString()}</td><td>${c.beneficiaryName}</td><td>R${c.payoutAmount}</td><td>${c.status}</td></tr>`).join('');
    res.send(renderPage(req.org, 'members', `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <a href="/admin/${req.org.code}/members">← Back</a>
        <a href="/admin/${req.org.code}/members/${member.phone}/pdf" class="btn" style="background:#2ecc71; width:auto; font-size:12px;">📄 Download Statement</a>
    </div><div class="card"><h3>👤 ${member.firstName} ${member.lastName}</h3><p>Phone: ${member.phone}<br>Monthly: R${member.monthlyPremium || 150}</p></div><div class="card"><h4>💳 Transactions</h4><table>${txRows || '<tr><td>No records</td></tr>'}</table></div><div class="card"><h4>📑 Claims</h4><table>${claimRows || '<tr><td>No records</td></tr>'}</table></div>`));
});

router.get('/admin/:code/members/:phone/pdf', checkSession, async (req, res) => {
    const member = await prisma.member.findUnique({ where: { phone: req.params.phone }, include: { transactions: true, claims: true } });
    if (!member) return res.status(404).send("Member not found");

    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Statement_${member.phone}.pdf`);
    doc.pipe(res);

    doc.fontSize(20).text(`${req.org.name} - Member Statement`, { align: 'center' });
    doc.moveDown().fontSize(12).text(`Member: ${member.firstName} ${member.lastName}`);
    doc.text(`Phone: ${member.phone}`);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`);
    doc.moveDown().fontSize(14).text('--- Payment History ---');
    member.transactions.forEach(t => doc.fontSize(10).text(`${t.date.toLocaleDateString()} | ${t.type} | R${t.amount} | ${t.status}`));
    doc.moveDown().fontSize(14).text('--- Claims History ---');
    member.claims.forEach(c => doc.fontSize(10).text(`${c.createdAt.toLocaleDateString()} | ${c.beneficiaryName} | R${c.payoutAmount} | ${c.status}`));
    
    doc.end();
});

// --- CLAIMS, EVENTS, ADS, SETTINGS, LOGOUT ---
router.get('/admin/:code/claims', checkSession, async (req, res) => {
    const claims = await prisma.claim.findMany({ where: { churchCode: req.org.code }, include: { member: true }, orderBy: { createdAt: 'desc' } });
    const rows = claims.map(c => `<tr><td><b>${c.beneficiaryName}</b><br><small>${c.member ? c.member.firstName : c.memberPhone}</small></td><td>R${c.payoutAmount}</td><td>${c.status}</td><td><form method="POST" action="/admin/${req.org.code}/claims/update"><input type="hidden" name="id" value="${c.id}"><select name="status" onchange="this.form.submit()"><option value="">Edit...</option><option value="PAID">Paid</option><option value="DECLINED">Declined</option></select></form></td></tr>`).join('');
    res.send(renderPage(req.org, 'claims', `<div class="card"><h3>Log Claim</h3><form method="POST" action="/admin/${req.org.code}/claims/add"><input name="memberPhone" placeholder="Member Phone" required><input type="number" name="amount" placeholder="Amount" required><input name="beneficiaryName" placeholder="Beneficiary" required><button class="btn">Submit</button></form></div><div class="card"><table>${rows}</table></div>`));
});

router.get('/admin/:code/events', checkSession, async (req, res) => {
    if (req.org.type !== 'CHURCH') return res.redirect(`/admin/${req.org.code}/dashboard`);
    const events = await prisma.event.findMany({ where: { churchCode: req.org.code }, orderBy: { id: 'desc' } });
    const rows = events.map(e => `<div class="card" style="display:flex; justify-content:space-between;"><div><b>${e.name}</b><br><small>${e.date}</small></div><form method="POST" action="/admin/${req.org.code}/events/delete"><input type="hidden" name="id" value="${e.id}"><button class="btn-del">Delete</button></form></div>`).join('');
    res.send(renderPage(req.org, 'events', `<div class="card"><h3>New Event</h3><form method="POST" action="/admin/${req.org.code}/events/add"><input name="name" placeholder="Name" required><input name="date" placeholder="Date" required><input type="number" name="price" value="0"><input type="date" name="expiryDate" required><button class="btn">Create</button></form></div>${rows}`));
});

router.get('/admin/:code/ads', checkSession, async (req, res) => {
    const ads = await prisma.ad.findMany({ where: { churchId: req.org.id }, orderBy: { id: 'desc' } });
    const rows = ads.map(a => `<div class="card"><p>${a.content}</p><form method="POST" action="/admin/${req.org.code}/ads/delete"><input type="hidden" name="id" value="${a.id}"><button class="btn-del">Delete</button></form></div>`).join('');
    res.send(renderPage(req.org, 'ads', `<div class="card"><h3>Broadcast</h3><form method="POST" action="/admin/${req.org.code}/ads/add"><textarea name="content" required></textarea><button class="btn">Send WhatsApp</button></form></div>${rows}`));
});

router.get('/admin/:code/settings', checkSession, async (req, res) => {
    res.send(renderPage(req.org, 'settings', `<div class="card"><h3>Settings</h3><form method="POST" action="/admin/${req.org.code}/settings/update"><label>Name</label><input name="name" value="${req.org.name}"><label>Phone</label><input name="adminPhone" value="${req.org.adminPhone || ''}"><label>Premium</label><input type="number" name="defaultPremium" value="${req.org.defaultPremium || 150}"><button class="btn">Save</button></form></div>`));
});

// --- POST HANDLERS ---
router.post('/admin/:code/claims/add', checkSession, async (req, res) => {
    const member = await prisma.member.findUnique({ where: { phone: req.body.memberPhone } });
    if (!member) return res.send("Member not found");
    await prisma.claim.create({ data: { churchCode: req.org.code, memberPhone: req.body.memberPhone, beneficiaryName: req.body.beneficiaryName, payoutAmount: parseFloat(req.body.amount) } });
    res.redirect(`/admin/${req.org.code}/claims`);
});

router.post('/admin/:code/claims/update', checkSession, async (req, res) => {
    await prisma.claim.update({ where: { id: parseInt(req.body.id) }, data: { status: req.body.status } });
    res.redirect(`/admin/${req.org.code}/claims`);
});

router.post('/admin/:code/events/add', checkSession, async (req, res) => {
    await prisma.event.create({ data: { ...req.body, price: parseFloat(req.body.price), churchCode: req.org.code, expiryDate: safeDate(req.body.expiryDate), status: 'Active' } });
    res.redirect(`/admin/${req.org.code}/events`);
});

router.post('/admin/:code/ads/add', checkSession, async (req, res) => {
    await prisma.ad.create({ data: { content: req.body.content, churchId: req.org.id, expiryDate: new Date(Date.now() + 30 * 86400000) } });
    const members = await prisma.member.findMany({ where: { OR: [{ churchCode: req.org.code }, { societyCode: req.org.code }] } });
    members.forEach(m => client.messages.create({ from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`, to: `whatsapp:${m.phone}`, body: `📢 *${req.org.name}*\n\n${req.body.content}` }).catch(e => console.error(e)));
    res.redirect(`/admin/${req.org.code}/ads`);
});

router.post('/admin/:code/settings/update', checkSession, async (req, res) => {
    await prisma.church.update({ where: { code: req.org.code }, data: { name: req.body.name, adminPhone: req.body.adminPhone, defaultPremium: parseFloat(req.body.defaultPremium) } });
    res.redirect(`/admin/${req.org.code}/settings`);
});

router.post('/admin/:code/members/upload', checkSession, upload.single('file'), async (req, res) => {
    const results = [];
    fs.createReadStream(req.file.path).pipe(csv()).on('data', (d) => results.push(d)).on('end', async () => {
        for (const r of results) {
            try { await prisma.member.upsert({ where: { phone: r.phone }, update: { firstName: r.firstName, lastName: r.lastName, monthlyPremium: parseFloat(r.monthlyPremium) || 150.0 }, create: { firstName: r.firstName, lastName: r.lastName, phone: r.phone, monthlyPremium: parseFloat(r.monthlyPremium) || 150.0, churchCode: req.org.code, status: 'ACTIVE' } }); } catch (e) { console.error(e.message); }
        }
        fs.unlinkSync(req.file.path);
        res.redirect(`/admin/${req.org.code}/members`);
    });
});

router.post('/admin/:code/members/delete', checkSession, async (req, res) => {
    await prisma.member.delete({ where: { id: parseInt(req.body.id) } });
    res.redirect(`/admin/${req.org.code}/members`);
});

router.post('/admin/:code/events/delete', checkSession, async (req, res) => {
    await prisma.event.delete({ where: { id: parseInt(req.body.id) } });
    res.redirect(`/admin/${req.org.code}/events`);
});

router.post('/admin/:code/ads/delete', checkSession, async (req, res) => {
    await prisma.ad.delete({ where: { id: parseInt(req.body.id) } });
    res.redirect(`/admin/${req.org.code}/ads`);
});

router.get('/admin/:code/members/export-arrears', checkSession, async (req, res) => {
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const members = await prisma.member.findMany({ where: { OR: [{ churchCode: req.org.code }, { societyCode: req.org.code }] }, include: { transactions: { where: { status: 'SUCCESS', type: 'SOCIETY_PREMIUM', date: { gte: startOfMonth } } } } });
    const outstanding = members.filter(m => m.transactions.reduce((s, t) => s + t.amount, 0) < (m.monthlyPremium || 150.0));
    let csvStr = "Name,Phone,Required,Paid,Balance\n";
    outstanding.forEach(m => {
        const paid = m.transactions.reduce((s, t) => s + t.amount, 0);
        const prem = m.monthlyPremium || 150.0;
        csvStr += `${m.firstName} ${m.lastName},${m.phone},${prem},${paid},${prem - paid}\n`;
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=Arrears.csv`);
    res.send(csvStr);
});

router.get('/admin/:code/logout', (req, res) => {
    res.setHeader('Set-Cookie', `session_${req.params.code}=; Path=/; Max-Age=0`);
    res.redirect(`/admin/${req.params.code}`);
});

module.exports = (app) => { app.use('/', router); };