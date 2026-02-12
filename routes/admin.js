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

// --- UI TEMPLATE (Updated for Type Separation) ---
const renderPage = (org, activeTab, content) => {
    const isChurch = org.type === 'CHURCH'; // 👈 Check Org Type

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
        </style>
    </head>
    <body>
        <div class="header"><b>${org.name}</b><a href="/admin/${org.code}/logout" style="font-size:12px; color:red; text-decoration:none;">Logout</a></div>
        <div class="nav">
            <a href="/admin/${org.code}/dashboard" style="${navStyle('dashboard')}">📊 Dashboard</a>
            <a href="/admin/${org.code}/members" style="${navStyle('members')}">👥 Members</a>
            <a href="/admin/${org.code}/claims" style="${navStyle('claims')}">📑 Claims</a>
            ${isChurch ? `<a href="/admin/${org.code}/events" style="${navStyle('events')}">📅 Events</a>` : ''} <a href="/admin/${org.code}/ads" style="${navStyle('ads')}">📢 Ads</a>
            <a href="/admin/${org.code}/settings" style="${navStyle('settings')}">⚙️ Settings</a>
        </div>
        <div class="container">${content}</div>
    </body></html>`;
};

// --- ⚙️ SECURE CRON SYNC ---
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

// --- DASHBOARD (Updated for Type Separation) ---
router.get('/admin/:code/dashboard', checkSession, async (req, res) => {
    const isChurch = req.org.type === 'CHURCH';
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    
    const transactions = await prisma.transaction.findMany({ 
        where: { churchCode: req.org.code, status: 'SUCCESS', date: { gte: startOfMonth } }, 
        orderBy: { id: 'desc' } 
    });

    const titheTotal = transactions.filter(tx => ['TITHE', 'OFFERING'].includes(tx.type)).reduce((s, tx) => s + tx.amount, 0);
    const premiumTotal = transactions.filter(tx => tx.type === 'SOCIETY_PREMIUM').reduce((s, tx) => s + tx.amount, 0);

    // 🟢 Build Dashboard Content Based on Type
    let dashboardCards = '';
    
    if (isChurch) {
        dashboardCards = `
            <div class="card" style="border-left:5px solid #00b894;"><small>CHURCH TITHES</small><h2>R${titheTotal.toLocaleString()}</h2></div>
            <div class="card" style="border-left:5px solid #6c5ce7;"><small>SOCIETY PREMIUMS</small><h2>R${premiumTotal.toLocaleString()}</h2></div>
        `;
    } else {
        dashboardCards = `
            <div class="card" style="border-left:5px solid #6c5ce7;"><small>SOCIETY COLLECTIONS</small><h2>R${premiumTotal.toLocaleString()}</h2></div>
            <div class="card" style="border-left:5px solid #0984e3;"><small>MEMBERS PAID</small><h2>${transactions.length}</h2></div>
        `;
    }

    res.send(renderPage(req.org, 'dashboard', `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;margin-bottom:20px;">
            ${dashboardCards}
        </div>
        <div class="card">
            <h3>📈 Recent Activity</h3>
            <table>
                ${transactions.slice(0, 10).map(tx => `
                    <tr>
                        <td>${tx.phone}</td>
                        <td>${isChurch ? tx.type : 'PREMIUM'}</td> <td>R${tx.amount}</td>
                    </tr>`).join('')}
            </table>
        </div>
    `));
});

// ... [Rest of the handlers: Members, Claims, Events, Ads, Settings remain the same]

module.exports = (app) => { app.use('/', router); };