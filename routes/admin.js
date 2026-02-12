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

// UI Template
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
            .badge { background: #eee; padding: 2px 6px; border-radius: 4px; font-size: 11px; }
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
            <a href="/admin/${org.code}/events" style="${navStyle('events')}">📅 Events</a>
            <a href="/admin/${org.code}/ads" style="${navStyle('ads')}">📢 Ads</a>
        </div>
        <div class="container">${content}</div>
    </body>
    </html>`;
};

// --- MIDDLEWARE ---
const checkSession = async (req, res, next) => {
    const { code } = req.params;
    const cookies = parseCookies(req);
    if (!cookies[`session_${code}`]) return res.redirect(`/admin/${code}`);
    
    req.org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
    if (!req.org) return res.send("Organization not found");
    next();
};

// --- ROUTES ---

// (Login, Verify, Logout routes remain unchanged...)
router.get('/admin/:code', async (req, res) => {
    const { code } = req.params;
    const org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
    if (!org) return res.send("<h3>Organization not found.</h3>");

    const otp = generateOTP();
    await prisma.church.update({ 
        where: { code: code.toUpperCase() }, 
        data: { otp: otp, otpExpires: new Date(Date.now() + 5 * 60000) } 
    });

    if (org.adminPhone) await sendWhatsApp(org.adminPhone, `🔐 *${org.name} Admin*\n\nLogin OTP: *${otp}*`);
    
    res.send(`
        <html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; background:#f4f7f6; margin:0;">
            <form action="/admin/${code}/verify" method="POST" style="background:white; padding:30px; border-radius:10px; width:300px; box-shadow:0 10px 25px rgba(0,0,0,0.1);">
                <h3 style="text-align:center;">🔐 ${org.name}</h3>
                <p style="text-align:center; font-size:14px;">Enter OTP sent to ...${org.adminPhone ? org.adminPhone.slice(-4) : '????'}</p>
                <input name="otp" placeholder="0000" maxlength="4" style="font-size:24px; text-align:center; width:100%; padding:10px; margin-bottom:15px;" required>
                <button style="width:100%; padding:15px; background:#1e272e; color:white; border:none; border-radius:5px; font-weight:bold; cursor:pointer;">Login</button>
            </form>
        </body></html>
    `);
});

router.post('/admin/:code/verify', async (req, res) => {
    const { code } = req.params;
    const org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
    if (!org || org.otp !== req.body.otp) return res.send("<h3>❌ Invalid OTP</h3><a href='javascript:history.back()'>Try Again</a>");
    res.setHeader('Set-Cookie', `session_${code}=active; HttpOnly; Path=/; Max-Age=3600`);
    res.redirect(`/admin/${code}/dashboard`);
});

router.get('/admin/:code/logout', (req, res) => {
    res.setHeader('Set-Cookie', `session_${req.params.code}=; Path=/; Max-Age=0`);
    res.redirect(`/admin/${req.params.code}`);
});

// --- DASHBOARD ---
router.get('/admin/:code/dashboard', checkSession, async (req, res) => {
    const orgCode = req.org.code;
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const transactions = await prisma.transaction.findMany({
        where: { churchCode: orgCode, status: 'SUCCESS', date: { gte: startOfMonth } },
        orderBy: { id: 'desc' }
    });
    const titheTotal = transactions.filter(tx => ['OFFERING', 'TITHE'].includes(tx.type)).reduce((sum, tx) => sum + tx.amount, 0);
    const premiumTotal = transactions.filter(tx => tx.type === 'SOCIETY_PREMIUM').reduce((sum, tx) => sum + tx.amount, 0);

    res.send(renderPage(req.org, 'dashboard', `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px;">
            <div class="card" style="border-left: 5px solid #00b894;">
                <small>TOTAL COLLECTIONS</small>
                <h2>R${(titheTotal + premiumTotal).toLocaleString()}</h2>
            </div>
            <div class="card" style="border-left: 5px solid #0984e3;">
                <small>CHURCH TITHES</small>
                <h2>R${titheTotal.toLocaleString()}</h2>
            </div>
            <div class="card" style="border-left: 5px solid #6c5ce7;">
                <small>SOCIETY PREMIUMS</small>
                <h2>R${premiumTotal.toLocaleString()}</h2>
            </div>
        </div>
        <div class="card">
            <h3>📈 Recent Transactions</h3>
            <table>
                <thead><tr><th>Date</th><th>Member</th><th>Type</th><th>Amount</th></tr></thead>
                <tbody>
                    ${transactions.slice(0, 10).map(tx => `
                        <tr>
                            <td>${tx.date ? tx.date.toLocaleDateString() : 'N/A'}</td>
                            <td>${tx.phone}</td>
                            <td><span class="badge">${tx.type}</span></td>
                            <td><strong>R${tx.amount}</strong></td>
                        </tr>`).join('')}
                </tbody>
            </table>
        </div>
    `));
});

// --- 👥 MEMBERS PAGE (With Arrears Tracking) ---
router.get('/admin/:code/members', checkSession, async (req, res) => {
    const { q } = req.query;
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    
    // 1. Fetch Members
    const members = await prisma.member.findMany({
        where: {
            churchCode: req.org.code,
            ...(q ? {
                OR: [
                    { phone: { contains: q } },
                    { lastName: { contains: q, mode: 'insensitive' } },
                    { firstName: { contains: q, mode: 'insensitive' } }
                ]
            } : {})
        },
        include: {
            // Include their transactions for the current month
            Transactions: {
                where: {
                    status: 'SUCCESS',
                    type: 'SOCIETY_PREMIUM',
                    date: { gte: startOfMonth }
                }
            }
        },
        orderBy: { lastName: 'asc' }
    });

    const rows = members.map(m => {
        const totalPaid = m.Transactions.reduce((sum, tx) => sum + tx.amount, 0);
        const required = m.monthlyPremium || 150.0;
        const isPaid = totalPaid >= required;
        
        // Visual Status logic
        const statusLabel = isPaid ? 'PAID' : (totalPaid > 0 ? 'PARTIAL' : 'OUTSTANDING');
        const statusColor = isPaid ? '#2ecc71' : (totalPaid > 0 ? '#f1c40f' : '#e74c3c');

        return `
        <tr>
            <td><b>${m.firstName} ${m.lastName}</b><br><small>${m.phone}</small></td>
            <td>
                <span class="badge" style="background:${statusColor}; color:white; padding:4px 8px;">
                    ${statusLabel}
                </div>
                <div style="font-size:10px; margin-top:4px;">R${totalPaid} / R${required}</div>
            </td>
            <td>
                <form method="POST" action="/admin/${req.org.code}/members/delete" style="display:inline;">
                    <input type="hidden" name="id" value="${m.id}"><button class="btn-del">Delete</button>
                </form>
            </td>
        </tr>`;
    }).join('');

    res.send(renderPage(req.org, 'members', `
        <div class="card" style="background: #1e272e; color: white;">
            <h3 style="margin-top:0;">📊 February 2026 Summary</h3>
            <div style="display:flex; gap:20px;">
                <div><small>Paid</small><br><b>${members.filter(m => m.Transactions.reduce((s, t) => s + t.amount, 0) >= (m.monthlyPremium || 150)).length}</b></div>
                <div><small>Outstanding</small><br><b>${members.filter(m => m.Transactions.reduce((s, t) => s + t.amount, 0) < (m.monthlyPremium || 150)).length}</b></div>
            </div>
        </div>
        `));
});

// CSV Upload Handler
router.post('/admin/:code/members/upload', checkSession, upload.single('file'), async (req, res) => {
    const results = [];
    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            for (const row of results) {
                try {
                    await prisma.member.upsert({
                        where: { phone: row.phone },
                        update: { firstName: row.firstName, lastName: row.lastName, monthlyPremium: parseFloat(row.monthlyPremium) || 150.0 },
                        create: { 
                            firstName: row.firstName, 
                            lastName: row.lastName, 
                            phone: row.phone, 
                            monthlyPremium: parseFloat(row.monthlyPremium) || 150.0,
                            churchCode: req.org.code,
                            status: 'ACTIVE'
                        }
                    });
                } catch (e) { console.error("CSV Row Error:", e.message); }
            }
            fs.unlinkSync(req.file.path); // Clean up temp file
            res.redirect(`/admin/${req.org.code}/members?success=true`);
        });
});

router.post('/admin/:code/members/delete', checkSession, async (req, res) => {
    await prisma.member.delete({ where: { id: parseInt(req.body.id) } });
    res.redirect(`/admin/${req.org.code}/members`);
});

// --- EVENTS ---
router.get('/admin/:code/events', checkSession, async (req, res) => {
    const events = await prisma.event.findMany({ where: { churchCode: req.org.code }, orderBy: { id: 'desc' } });
    res.send(renderPage(req.org, 'events', `
        <div class="card">
            <h3>📅 Create Event</h3>
            <form method="POST" action="/admin/${req.org.code}/events/add">
                <label>Name</label><input name="name" required>
                <label>Date Text</label><input name="date" placeholder="e.g. Friday 7pm" required>
                <label>Price</label><input type="number" name="price" value="0" required>
                <label>Expiry</label><input type="date" name="expiryDate" required>
                <button class="btn">Create Event</button>
            </form>
        </div>
        ${events.map(e => `
            <div class="card" style="display:flex; justify-content:space-between; align-items:center;">
                <div><b>${e.name}</b><br><small>${e.date} • R${e.price}</small></div>
                <form method="POST" action="/admin/${req.org.code}/events/delete"><input type="hidden" name="id" value="${e.id}"><button class="btn-del">Delete</button></form>
            </div>`).join('')}
    `));
});

router.post('/admin/:code/events/add', checkSession, async (req, res) => {
    await prisma.event.create({ data: { ...req.body, price: parseFloat(req.body.price), churchCode: req.org.code, expiryDate: safeDate(req.body.expiryDate), status: 'Active' } });
    res.redirect(`/admin/${req.org.code}/events`);
});

router.post('/admin/:code/events/delete', checkSession, async (req, res) => {
    await prisma.event.delete({ where: { id: parseInt(req.body.id) } });
    res.redirect(`/admin/${req.org.code}/events`);
});

// --- ADS ---
router.get('/admin/:code/ads', checkSession, async (req, res) => {
    const ads = await prisma.ad.findMany({ where: { churchId: req.org.id }, orderBy: { id: 'desc' } });
    res.send(renderPage(req.org, 'ads', `
        <div class="card">
            <h3>📢 New Broadcast</h3>
            <form method="POST" action="/admin/${req.org.code}/ads/add">
                <label>Content</label><textarea name="content" required></textarea>
                <label>Image URL</label><input name="imageUrl">
                <button class="btn">🚀 Broadcast to WhatsApp</button>
            </form>
        </div>
        ${ads.map(a => `
            <div class="card" style="display:flex; justify-content:space-between;">
                <div>${a.content}</div>
                <form method="POST" action="/admin/${req.org.code}/ads/delete"><input type="hidden" name="id" value="${a.id}"><button class="btn-del">Delete</button></form>
            </div>`).join('')}
    `));
});

router.post('/admin/:code/ads/add', checkSession, async (req, res) => {
    const { content, imageUrl } = req.body;
    const defaultExpiry = new Date();
    defaultExpiry.setDate(defaultExpiry.getDate() + 30);

    try {
        await prisma.ad.create({ data: { content, imageUrl: imageUrl || null, churchId: req.org.id, expiryDate: defaultExpiry } });
        const members = await prisma.member.findMany({ where: { churchCode: req.org.code } });
        members.forEach(m => {
            client.messages.create({
                from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
                to: `whatsapp:${m.phone}`,
                body: `📢 *${req.org.name}*\n\n${content}`,
                mediaUrl: imageUrl ? [imageUrl] : undefined
            }).catch(e => console.error(e));
        });
        res.redirect(`/admin/${req.org.code}/ads`);
    } catch (e) { res.status(500).send(e.message); }
});

router.post('/admin/:code/ads/delete', checkSession, async (req, res) => {
    await prisma.ad.delete({ where: { id: parseInt(req.body.id) } });
    res.redirect(`/admin/${req.org.code}/ads`);
});

module.exports = (app) => {
    app.use('/', router);
};