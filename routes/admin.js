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
const PDFDocument = require('pdfkit');

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

// --- UI TEMPLATE (Strict Isolation) ---
const renderPage = (org, activeTab, content) => {
    const isChurch = org.type === 'CHURCH';
    const navStyle = (tab) => `padding: 10px 15px; text-decoration: none; color: ${activeTab === tab ? '#000' : '#888'}; border-bottom: ${activeTab === tab ? '3px solid #00d2d3' : 'none'}; font-weight: bold; font-size: 14px;`;
    return `<!DOCTYPE html><html><head><title>${org.name}</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:-apple-system,sans-serif;background:#f4f7f6;margin:0;padding-bottom:50px;}.header{background:white;padding:20px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;}.nav{background:white;padding:0 20px;border-bottom:1px solid #ddd;overflow-x:auto;white-space:nowrap;display:flex;}.container{padding:20px;max-width:800px;margin:0 auto;}.card{background:white;padding:20px;border-radius:10px;box-shadow:0 2px 5px rgba(0,0,0,0.05);margin-bottom:20px;}.btn{display:inline-block;padding:12px 20px;background:#1e272e;color:white;text-decoration:none;border-radius:8px;border:none;font-weight:bold;font-size:14px;width:100%;text-align:center;cursor:pointer;}.btn-del{background:#ffebeb;color:#d63031;padding:5px 10px;font-size:11px;width:auto;border-radius:4px;border:none;}input,select,textarea{width:100%;padding:12px;margin-bottom:15px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;}label{display:block;margin-bottom:5px;font-weight:bold;font-size:12px;color:#555;text-transform:uppercase;}table{width:100%;border-collapse:collapse;}td,th{padding:12px 8px;border-bottom:1px solid #eee;font-size:14px;text-align:left;}.badge{padding:4px 8px;border-radius:4px;font-size:10px;color:white;font-weight:bold;}a{color:#0984e3;text-decoration:none;}</style></head>
    <body><div class="header"><b>${org.name} (${org.type})</b><a href="/admin/${org.code}/logout" style="color:red;font-size:12px;">Logout</a></div><div class="nav"><a href="/admin/${org.code}/dashboard" style="${navStyle('dashboard')}">📊 Dashboard</a><a href="/admin/${org.code}/members" style="${navStyle('members')}">👥 Members</a>${!isChurch ? `<a href="/admin/${org.code}/claims" style="${navStyle('claims')}">📑 Claims</a>` : ''}${isChurch ? `<a href="/admin/${org.code}/events" style="${navStyle('events')}">📅 Events</a>` : ''}<a href="/admin/${org.code}/ads" style="${navStyle('ads')}">📢 Ads</a><a href="/admin/${org.code}/settings" style="${navStyle('settings')}">⚙️ Settings</a></div><div class="container">${content}</div></body></html>`;
};

// --- MIDDLEWARE ---
const checkSession = async (req, res, next) => {
    const { code } = req.params;
    const cookies = parseCookies(req);
    if (!cookies[`session_${code}`]) return res.redirect(`/admin/${code}`);
    req.org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
    if (!req.org) return res.send("Not Found");
    next();
};

// --- ROUTES ---
router.get('/admin/:code', async (req, res) => {
    const org = await prisma.church.findUnique({ where: { code: req.params.code.toUpperCase() } });
    if (!org) return res.send("Not Found");
    const otp = generateOTP();
    await prisma.church.update({ where: { id: org.id }, data: { otp, otpExpires: new Date(Date.now() + 300000) } });
    if (org.adminPhone) await sendWhatsApp(org.adminPhone, `🔐 *${org.name} Admin*\nOTP: *${otp}*`);
    res.send(`<html><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#f4f7f6;margin:0;"><form action="/admin/${org.code}/verify" method="POST" style="background:white;padding:30px;border-radius:10px;width:300px;box-shadow:0 10px 25px rgba(0,0,0,0.1);"><h3 style="text-align:center;">🔐 Login</h3><input name="otp" placeholder="0000" maxlength="4" style="font-size:24px;text-align:center;width:100%;padding:10px;margin-bottom:15px;" required><button style="width:100%;padding:15px;background:#1e272e;color:white;border:none;border-radius:5px;font-weight:bold;cursor:pointer;">Enter</button></form></body></html>`);
});

router.post('/admin/:code/verify', async (req, res) => {
    const org = await prisma.church.findUnique({ where: { code: req.params.code.toUpperCase() } });
    if (!org || org.otp !== req.body.otp) return res.send("Invalid OTP");
    res.setHeader('Set-Cookie', `session_${org.code}=active; HttpOnly; Path=/; Max-Age=3600`);
    res.redirect(`/admin/${org.code}/dashboard`);
});

router.get('/admin/:code/dashboard', checkSession, async (req, res) => {
    const isChurch = req.org.type === 'CHURCH';
    const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const [tx, cl] = await Promise.all([
        prisma.transaction.findMany({ where: { churchCode: req.org.code, status: 'SUCCESS', date: { gte: start }, type: isChurch ? { in: ['TITHE', 'OFFERING'] } : 'SOCIETY_PREMIUM' }, orderBy: { id: 'desc' } }),
        !isChurch ? prisma.claim.findMany({ where: { churchCode: req.org.code, status: 'PENDING' } }) : []
    ]);
    const total = tx.reduce((s, t) => s + t.amount, 0);
    const liability = cl.reduce((s, c) => s + c.payoutAmount, 0);
    const cards = isChurch ? `<div class="card" style="border-left:5px solid #00b894;"><small>CHURCH COLLECTIONS</small><h2>R${total.toLocaleString()}</h2></div>` : `<div class="card" style="border-left:5px solid #6c5ce7;"><small>SOCIETY PREMIUMS</small><h2>R${total.toLocaleString()}</h2></div><div class="card" style="border-left:5px solid #e74c3c;"><small>CLAIMS LIABILITY</small><h2>R${liability.toLocaleString()}</h2></div>`;
    res.send(renderPage(req.org, 'dashboard', `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;margin-bottom:20px;">${cards}</div><div class="card"><h3>Recent Activity</h3><table>${tx.slice(0, 5).map(t => `<tr><td>${t.phone}</td><td>${t.type}</td><td>R${t.amount}</td></tr>`).join('')}</table></div>`));
});

router.get('/admin/:code/members', checkSession, async (req, res) => {
    const isChurch = req.org.type === 'CHURCH';
    const { q } = req.query;
    const members = await prisma.member.findMany({
        where: { OR: isChurch ? [{ churchCode: req.org.code }] : [{ societyCode: req.org.code }], ...(q ? { OR: [{ phone: { contains: q } }, { lastName: { contains: q, mode: 'insensitive' } }] } : {}) },
        include: { transactions: { where: { status: 'SUCCESS', type: isChurch ? { in: ['TITHE', 'OFFERING'] } : 'SOCIETY_PREMIUM' } } },
        orderBy: { lastName: 'asc' }
    });
    const rows = members.map(m => `<tr><td><a href="/admin/${req.org.code}/members/${m.phone}"><b>${m.firstName} ${m.lastName}</b></a></td><td>${m.phone}</td><td>R${m.transactions.reduce((s,t)=>s+t.amount,0)}</td><td><form method="POST" action="/admin/${req.org.code}/members/delete"><input type="hidden" name="id" value="${m.id}"><button class="btn-del">Delete</button></form></td></tr>`).join('');
    res.send(renderPage(req.org, 'members', `<div class="card"><h3>👥 ${isChurch ? 'Church' : 'Society'} Members</h3><form method="GET"><input name="q" value="${q || ''}" placeholder="Search..."><button class="btn">Search</button></form><form method="POST" action="/admin/${req.org.code}/members/upload" enctype="multipart/form-data" style="margin-top:10px;"><input type="file" name="file" accept=".csv" required><button class="btn">Upload CSV</button></form></div><div class="card"><table>${rows}</table></div>`));
});

router.get('/admin/:code/members/:phone', checkSession, async (req, res) => {
    const m = await prisma.member.findUnique({ where: { phone: req.params.phone }, include: { transactions: { orderBy: { date: 'desc' } }, claims: true } });
    if (!m) return res.send("Not Found");
    res.send(renderPage(req.org, 'members', `<div style="display:flex;justify-content:space-between;margin-bottom:20px;"><a href="/admin/${req.org.code}/members">← Back</a><a href="/admin/${req.org.code}/members/${m.phone}/pdf" class="btn" style="background:#2ecc71;width:auto;">📄 Statement</a></div><div class="card"><h3>👤 ${m.firstName} ${m.lastName}</h3><p>${m.phone}</p></div><div class="card"><h4>💳 Transactions</h4><table>${m.transactions.map(t=>`<tr><td>${t.date.toLocaleDateString()}</td><td>${t.type}</td><td>R${t.amount}</td></tr>`).join('')}</table></div>`));
});

router.get('/admin/:code/members/:phone/pdf', checkSession, async (req, res) => {
    const m = await prisma.member.findUnique({ where: { phone: req.params.phone }, include: { transactions: true } });
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);
    doc.fontSize(20).text(`Statement: ${m.firstName} ${m.lastName}`, { align: 'center' });
    m.transactions.forEach(t => doc.fontSize(10).text(`${t.date.toLocaleDateString()} | ${t.type} | R${t.amount}`));
    doc.end();
});

router.get('/admin/:code/claims', checkSession, async (req, res) => {
    if (req.org.type === 'CHURCH') return res.redirect(`/admin/${req.org.code}/dashboard`);
    const claims = await prisma.claim.findMany({ where: { churchCode: req.org.code }, include: { member: true }, orderBy: { createdAt: 'desc' } });
    const rows = claims.map(c => `<tr><td><b>${c.beneficiaryName}</b></td><td>R${c.payoutAmount}</td><td>${c.status}</td><td><form method="POST" action="/admin/${req.org.code}/claims/update"><input type="hidden" name="id" value="${c.id}"><select name="status" onchange="this.form.submit()"><option value="">Edit...</option><option value="PAID">Paid</option></select></form></td></tr>`).join('');
    res.send(renderPage(req.org, 'claims', `<div class="card"><h3>📑 Claims</h3><form method="POST" action="/admin/${req.org.code}/claims/add"><input name="memberPhone" placeholder="Phone" required><input type="number" name="amount" placeholder="R" required><input name="beneficiaryName" placeholder="Name" required><button class="btn">Log Claim</button></form></div><div class="card"><table>${rows}</table></div>`));
});

router.get('/admin/:code/events', checkSession, async (req, res) => {
    if (req.org.type !== 'CHURCH') return res.redirect(`/admin/${req.org.code}/dashboard`);
    const events = await prisma.event.findMany({ where: { churchCode: req.org.code }, orderBy: { id: 'desc' } });
    res.send(renderPage(req.org, 'events', `<div class="card"><h3>📅 Events</h3><form method="POST" action="/admin/${req.org.code}/events/add"><input name="name" placeholder="Event" required><input name="date" placeholder="Date" required><input type="number" name="price" value="0"><input type="date" name="expiryDate" required><button class="btn">Create</button></form></div>${events.map(e=>`<div class="card"><b>${e.name}</b><br>${e.date}</div>`).join('')}`));
});

// --- BROADCAST, SETTINGS & POSTS ---
router.get('/admin/:code/ads', checkSession, async (req, res) => {
    const ads = await prisma.ad.findMany({ where: { churchId: req.org.id }, orderBy: { id: 'desc' } });
    res.send(renderPage(req.org, 'ads', `<div class="card"><h3>📢 Broadcast</h3><form method="POST" action="/admin/${req.org.code}/ads/add"><textarea name="content" required></textarea><button class="btn">Send</button></form></div>${ads.map(a=>`<div class="card">${a.content}</div>`).join('')}`));
});

router.get('/admin/:code/settings', checkSession, async (req, res) => {
    res.send(renderPage(req.org, 'settings', `<div class="card"><h3>⚙️ Settings</h3><form method="POST" action="/admin/${req.org.code}/settings/update"><label>Name</label><input name="name" value="${req.org.name}"><label>Premium</label><input type="number" name="defaultPremium" value="${req.org.defaultPremium || 150}"><button class="btn">Save</button></form></div>`));
});

router.post('/admin/:code/settings/update', checkSession, async (req, res) => {
    await prisma.church.update({ where: { code: req.org.code }, data: { name: req.body.name, defaultPremium: parseFloat(req.body.defaultPremium) } });
    res.redirect(`/admin/${req.org.code}/settings`);
});

router.get('/admin/:code/logout', (req, res) => {
    res.setHeader('Set-Cookie', `session_${req.params.code}=; Path=/; Max-Age=0`);
    res.redirect(`/admin/${req.params.code}`);
});

module.exports = (app) => { app.use('/', router); };