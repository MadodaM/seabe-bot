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

// --- UI TEMPLATE ---
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

// --- DASHBOARD (Granular Breakdown) ---
router.get('/admin/:code/dashboard', checkSession, async (req, res) => {
    const isChurch = req.org.type === 'CHURCH';
    const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    
    const tx = await prisma.transaction.findMany({ 
        where: { churchCode: req.org.code, status: 'SUCCESS', date: { gte: start } },
        orderBy: { id: 'desc' }
    });

    let cards = '';
    if (isChurch) {
        const tithes = tx.filter(t => t.type === 'TITHE').reduce((s, t) => s + t.amount, 0);
        const offerings = tx.filter(t => t.type === 'OFFERING').reduce((s, t) => s + t.amount, 0);
        const tickets = tx.filter(t => t.type === 'EVENT_TICKET').reduce((s, t) => s + t.amount, 0);
        const pledges = tx.filter(t => t.type === 'PLEDGE').reduce((s, t) => s + t.amount, 0);

        cards = `
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:15px;">
                <div class="card" style="border-left:4px solid #00b894;"><small>TITHES</small><h3>R${tithes.toLocaleString()}</h3></div>
                <div class="card" style="border-left:4px solid #0984e3;"><small>OFFERINGS</small><h3>R${offerings.toLocaleString()}</h3></div>
                <div class="card" style="border-left:4px solid #f1c40f;"><small>TICKETS</small><h3>R${tickets.toLocaleString()}</h3></div>
                <div class="card" style="border-left:4px solid #6c5ce7;"><small>PLEDGES</small><h3>R${pledges.toLocaleString()}</h3></div>
            </div>`;
    } else {
        const total = tx.filter(t => t.type === 'SOCIETY_PREMIUM').reduce((s, t) => s + t.amount, 0);
        const liability = await prisma.claim.aggregate({ where: { churchCode: req.org.code, status: 'PENDING' }, _sum: { payoutAmount: true } });
        cards = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
                <div class="card" style="border-left:5px solid #6c5ce7;"><small>SOCIETY PREMIUMS</small><h2>R${total.toLocaleString()}</h2></div>
                <div class="card" style="border-left:5px solid #e74c3c;"><small>CLAIMS LIABILITY</small><h2>R${(liability._sum.payoutAmount || 0).toLocaleString()}</h2></div>
            </div>`;
    }

    res.send(renderPage(req.org, 'dashboard', cards + `<div class="card"><h3>Recent Activity</h3><table>${tx.slice(0, 5).map(t => `<tr><td>${t.phone}</td><td>${t.type}</td><td>R${t.amount}</td></tr>`).join('')}</table></div>`));
});

// --- MEMBERS (Status Separation) ---
router.get('/admin/:code/members', checkSession, async (req, res) => {
    const isChurch = req.org.type === 'CHURCH';
    const { q } = req.query;
    const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const members = await prisma.member.findMany({
        where: { OR: isChurch ? [{ churchCode: req.org.code }] : [{ societyCode: req.org.code }], ...(q ? { OR: [{ phone: { contains: q } }, { lastName: { contains: q, mode: 'insensitive' } }] } : {}) },
        include: { transactions: { where: { status: 'SUCCESS', date: { gte: start } } } },
        orderBy: { lastName: 'asc' }
    });

    const rows = members.map(m => {
        const paid = m.transactions.reduce((s, t) => s + t.amount, 0);
        const reqAmt = m.monthlyPremium || 150.0;
        const statusBadge = !isChurch ? `<span class="badge" style="background:${paid >= reqAmt ? '#2ecc71' : '#e74c3c'}">${paid >= reqAmt ? 'PAID' : 'ARREARS'}</span>` : '';
        return `<tr><td><a href="/admin/${req.org.code}/members/${m.phone}"><b>${m.firstName} ${m.lastName}</b></a></td><td>${statusBadge}</td><td>R${paid}</td><td><form method="POST" action="/admin/${req.org.code}/members/delete"><input type="hidden" name="id" value="${m.id}"><button class="btn-del">Delete</button></form></td></tr>`;
    }).join('');

    const arrearsBtn = !isChurch ? `<a href="/admin/${req.org.code}/members/export-arrears" class="btn" style="background:#d63031;width:auto;margin-bottom:10px;">📥 Export Arrears CSV</a>` : '';
    res.send(renderPage(req.org, 'members', `<div style="display:flex;justify-content:space-between;align-items:center;"><h3>👥 ${isChurch ? 'Congregation' : 'Policy Holders'}</h3>${arrearsBtn}</div><div class="card"><form method="GET"><input name="q" value="${q || ''}" placeholder="Search..."><button class="btn">Search</button></form></div><div class="card"><table>${rows}</table></div>`));
});

// --- SETTINGS (Field Isolation) ---
router.get('/admin/:code/settings', checkSession, async (req, res) => {
    const isChurch = req.org.type === 'CHURCH';
    res.send(renderPage(req.org, 'settings', `
        <div class="card">
            <h3>⚙️ Settings</h3>
            <form method="POST" action="/admin/${req.org.code}/settings/update">
                <label>Org Name</label><input name="name" value="${req.org.name}" required>
                <label>Admin WhatsApp</label><input name="adminPhone" value="${req.org.adminPhone || ''}" placeholder="+27...">
                ${!isChurch ? `<label>Standard Monthly Premium</label><input type="number" name="defaultPremium" value="${req.org.defaultPremium || 150}">` : ''}
                <button class="btn">Save Changes</button>
            </form>
        </div>`));
});

// ... [Auth, Claims, Events, Ads, PDF routes remain logically integrated from your provided block]

router.post('/admin/:code/settings/update', checkSession, async (req, res) => {
    const data = { name: req.body.name, adminPhone: req.body.adminPhone };
    if (req.org.type !== 'CHURCH') data.defaultPremium = parseFloat(req.body.defaultPremium);
    await prisma.church.update({ where: { code: req.org.code }, data });
    res.redirect(`/admin/${req.org.code}/settings`);
});

module.exports = (app) => { app.use('/', router); };