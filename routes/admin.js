// ==========================================
// CLIENT DASHBOARD (Organization Admin)
// Route: /admin/:code
// Features: Finance, Events, News, Ads, DELETE Functionality
// ==========================================
const express = require('express');
const router = express.Router();
const { sendWhatsApp } = require('../services/whatsapp');

// --- HELPERS ---
const generateOTP = () => Math.floor(1000 + Math.random() * 9000).toString();
const safeDate = (d) => d ? new Date(d) : new Date();

// Simple Cookie Parser
const parseCookies = (req) => {
    const list = {}, rc = req.headers.cookie;
    rc && rc.split(';').forEach(c => { const p = c.split('='); list[p.shift().trim()] = decodeURI(p.join('=')); });
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
        <link rel="icon" type="image/png" href="/favicon.png">
        <style>
            body { font-family: -apple-system, sans-serif; background: #f4f7f6; margin: 0; padding-bottom: 50px; }
            .header { background: white; padding: 20px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
            .nav { background: white; padding: 0 20px; border-bottom: 1px solid #ddd; overflow-x: auto; white-space: nowrap; }
            .container { padding: 20px; max-width: 800px; margin: 0 auto; }
            .card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); margin-bottom: 20px; }
            .btn { display: inline-block; padding: 12px 20px; background: #1e272e; color: white; text-decoration: none; border-radius: 8px; border: none; font-weight: bold; font-size: 14px; width: 100%; box-sizing: border-box; text-align: center; cursor: pointer; }
            .btn-del { background: #ffebeb; color: #d63031; padding: 5px 10px; font-size: 11px; width: auto; display: inline-block; margin-left: 10px; }
            input, select, textarea { width: 100%; padding: 12px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; font-family: inherit; }
            label { display: block; margin-bottom: 5px; font-weight: bold; font-size: 12px; color: #555; text-transform: uppercase; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            td { padding: 12px 0; border-bottom: 1px solid #eee; font-size: 14px; vertical-align: middle; }
            .tag { padding: 3px 8px; border-radius: 4px; font-size: 10px; text-transform: uppercase; font-weight: bold; }
            .active { background: #eefdf5; color: green; }
        </style>
    </head>
    <body>
        <div class="header">
            <div style="font-weight:bold; font-size:18px;">${org.name}</div>
            <a href="/admin/${org.code}/logout" style="font-size:12px; color:red; text-decoration:none;">Logout</a>
        </div>
        <div class="nav">
            <a href="/admin/${org.code}/dashboard" style="${navStyle('finance')}">💰 Finance</a>
            <a href="/admin/${org.code}/events" style="${navStyle('events')}">📅 Events</a>
            <a href="/admin/${org.code}/news" style="${navStyle('news')}">📰 News</a>
            <a href="/admin/${org.code}/ads" style="${navStyle('ads')}">📢 Ads</a>
        </div>
        <div class="container">
            ${content}
        </div>
    </body>
    </html>
    `;
};

module.exports = (app, { prisma }) => {

    // --- MIDDLEWARE ---
    const checkSession = async (req, res, next) => {
        const { code } = req.params;
        const cookies = parseCookies(req);
        if (!cookies[`session_${code}`]) return res.redirect(`/admin/${code}`);
        req.org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
        if (!req.org) return res.send("Org not found");
        next();
    };

    // 1. LOGIN
    router.get('/admin/:code', async (req, res) => {
        const { code } = req.params;
        const org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
        if (!org) return res.send("<h3>Organization not found.</h3>");

        const otp = generateOTP();
        await prisma.church.update({ where: { code: code.toUpperCase() }, data: { otp: otp, otpExpires: new Date(Date.now() + 5 * 60000) } });

        if (org.adminPhone) await sendWhatsApp(org.adminPhone, `🔐 *${org.name} Admin*\n\nLogin OTP: *${otp}*`);
        
        res.send(`
            <html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
            <body style="font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; background:#f4f7f6; margin:0;">
                <form action="/admin/${code}/verify" method="POST" style="background:white; padding:30px; border-radius:10px; text-align:center; width:300px; box-shadow:0 10px 25px rgba(0,0,0,0.1);">
                    <h3>🔐 ${org.name}</h3>
                    <p>Enter OTP sent to ...${org.adminPhone ? org.adminPhone.slice(-4) : '????'}</p>
                    <input name="otp" placeholder="0000" maxlength="4" style="font-size:24px; text-align:center; width:100%; padding:10px; margin-bottom:15px;" required>
                    <button style="width:100%; padding:15px; background:#1e272e; color:white; border:none; border-radius:5px; font-weight:bold;">Login</button>
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
        res.setHeader('Set-Cookie', `session_${req.params.code}=; Max-Age=0`);
        res.redirect(`/admin/${req.params.code}`);
    });

    // 2. DASHBOARD
    router.get('/admin/:code/dashboard', checkSession, async (req, res) => {
        const txs = await prisma.transaction.findMany({ where: { churchCode: req.org.code, status: 'success' }, orderBy: { date: 'desc' }, take: 50 });
        const total = txs.reduce((sum, t) => sum + t.amount, 0);

        const rows = txs.map(t => `
            <tr>
                <td><div style="font-weight:bold;">${t.type}</div><div style="font-size:11px; color:#888;">${new Date(t.date).toLocaleDateString()}</div></td>
                <td>${t.phone}</td>
                <td style="text-align:right; font-weight:bold;">R${t.amount.toFixed(2)}</td>
            </tr>`).join('');

        res.send(renderPage(req.org, 'finance', `
            <div class="card" style="text-align:center; padding:30px;">
                <div style="font-size:12px; color:#888;">TOTAL FUNDS RAISED</div>
                <div style="font-size:36px; font-weight:bold; color:#00b894;">R${total.toFixed(2)}</div>
            </div>
            <div class="card"><h3>Recent Transactions</h3><table><tbody>${rows || '<tr><td>No transactions yet.</td></tr>'}</tbody></table></div>
        `));
    });

    // 3. EVENTS (With Delete)
    router.get('/admin/:code/events', checkSession, async (req, res) => {
        const events = await prisma.event.findMany({ where: { churchCode: req.org.code }, orderBy: { id: 'desc' } });
        const list = events.map(e => `
            <div class="card" style="display:flex; justify-content:space-between; align-items:center;">
                <div><div style="font-weight:bold;">${e.name}</div><div style="font-size:12px; color:#888;">${e.date} • R${e.price}</div></div>
                <form method="POST" action="/admin/${req.org.code}/events/delete" style="margin:0;">
                    <input type="hidden" name="id" value="${e.id}">
                    <button class="btn btn-del" onclick="return confirm('Delete this event?')">Delete</button>
                </form>
            </div>`).join('');

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
            <h3>Your Events</h3>${list || '<p style="text-align:center; color:#888;">No events found.</p>'}
        `));
    });

    router.post('/admin/:code/events/add', checkSession, async (req, res) => {
        await prisma.event.create({ data: { name: req.body.name, date: req.body.date, price: parseFloat(req.body.price), churchCode: req.org.code, status: 'Active', expiryDate: safeDate(req.body.expiryDate) } });
        res.redirect(`/admin/${req.org.code}/events`);
    });

    router.post('/admin/:code/events/delete', checkSession, async (req, res) => {
        await prisma.event.delete({ where: { id: parseInt(req.body.id) } });
        res.redirect(`/admin/${req.org.code}/events`);
    });

    // 4. NEWS (With Delete)
    router.get('/admin/:code/news', checkSession, async (req, res) => {
        const news = await prisma.news.findMany({ where: { churchId: req.org.id }, orderBy: { id: 'desc' } });
        const list = news.map(n => `
            <div class="card">
                <div style="display:flex; justify-content:space-between;">
                    <div style="font-weight:bold;">${n.headline}</div>
                    <form method="POST" action="/admin/${req.org.code}/news/delete" style="margin:0;">
                        <input type="hidden" name="id" value="${n.id}">
                        <button class="btn btn-del" onclick="return confirm('Delete this news?')">Delete</button>
                    </form>
                </div>
                <div style="font-size:13px; color:#555; margin-top:5px;">${n.body}</div>
            </div>`).join('');

        res.send(renderPage(req.org, 'news', `
            <div class="card">
                <h3>📰 Post News</h3>
                <form method="POST" action="/admin/${req.org.code}/news/add">
                    <label>Headline</label><input name="headline" required>
                    <label>Body</label><textarea name="body" rows="3" required></textarea>
                    <label>Expiry</label><input type="date" name="expiryDate" required>
                    <button class="btn">Post News</button>
                </form>
            </div>
            <h3>Recent News</h3>${list || '<p style="text-align:center; color:#888;">No news posted.</p>'}
        `));
    });

    router.post('/admin/:code/news/add', checkSession, async (req, res) => {
        await prisma.news.create({ data: { headline: req.body.headline, body: req.body.body, churchId: req.org.id, status: 'Active', expiryDate: safeDate(req.body.expiryDate) } });
        res.redirect(`/admin/${req.org.code}/news`);
    });

    router.post('/admin/:code/news/delete', checkSession, async (req, res) => {
        await prisma.news.delete({ where: { id: parseInt(req.body.id) } });
        res.redirect(`/admin/${req.org.code}/news`);
    });

    // 5. ADS (With Delete)
    router.get('/admin/:code/ads', checkSession, async (req, res) => {
        const ads = await prisma.ad.findMany({ where: { churchId: req.org.id }, orderBy: { id: 'desc' } });
        const list = ads.map(a => `
            <div class="card" style="display:flex; justify-content:space-between;">
                <div>${a.content}</div>
                <div>
                    <span style="font-weight:bold; color:#00b894; margin-right:10px;">👁️ ${a.views || 0}</span>
                    <form method="POST" action="/admin/${req.org.code}/ads/delete" style="display:inline; margin:0;">
                        <input type="hidden" name="id" value="${a.id}">
                        <button class="btn btn-del" onclick="return confirm('Delete this ad?')">Delete</button>
                    </form>
                </div>
            </div>`).join('');

        res.send(renderPage(req.org, 'ads', `
            <div class="card">
                <h3>📢 Create Ad</h3>
                <form method="POST" action="/admin/${req.org.code}/ads/add">
                    <label>Content</label><textarea name="content" rows="2" required></textarea>
                    <label>Expiry</label><input type="date" name="expiryDate" required>
                    <button class="btn">Create Ad</button>
                </form>
            </div>
            <h3>Active Ads</h3>${list || '<p style="text-align:center; color:#888;">No ads running.</p>'}
        `));
    });

    router.post('/admin/:code/ads/add', checkSession, async (req, res) => {
        await prisma.ad.create({ data: { content: req.body.content, churchId: req.org.id, status: 'Active', expiryDate: safeDate(req.body.expiryDate) } });
        res.redirect(`/admin/${req.org.code}/ads`);
    });

    router.post('/admin/:code/ads/delete', checkSession, async (req, res) => {
        await prisma.ad.delete({ where: { id: parseInt(req.body.id) } });
        res.redirect(`/admin/${req.org.code}/ads`);
    });

    app.use('/', router);
};