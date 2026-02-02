// routes/admin.js
// VERSION: 3.0 (Master Version: Robust, Readable, Fully Featured)
require('dotenv').config();

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

// Helper: Ensure Dates don't crash the database
function safeDate(d) {
    if (!d) return new Date(); // Default to 'Now' if empty
    return new Date(d);
}

// --- UI LAYOUT (Full & Readable) ---
function renderAdminPage(title, content, error = null) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>${title} | Seabe Admin</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: 'Segoe UI', sans-serif; background: #f4f7f6; margin: 0; display: flex; color: #333; }
                
                /* Sidebar */
                .sidebar { width: 250px; background: #0a4d3c; color: white; min-height: 100vh; padding: 20px; box-sizing: border-box; position: fixed; }
                .sidebar h2 { color: #D4AF37; margin-top: 0; padding-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.1); }
                .sidebar a { display: block; color: #ddd; text-decoration: none; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05); transition:0.2s; }
                .sidebar a:hover { color: #D4AF37; padding-left: 5px; }
                
                /* Main Area */
                .main { margin-left: 250px; flex: 1; padding: 40px; }
                h1 { color: #0a4d3c; border-bottom: 2px solid #D4AF37; display: inline-block; padding-bottom: 5px; margin-bottom: 30px; }
                
                /* Error Box */
                .error-box { background: #fee; color: #c00; padding: 15px; border-radius: 5px; border: 1px solid #fcc; margin-bottom: 20px; }

                /* Tables */
                table { width:100%; border-collapse:collapse; background:white; border-radius:8px; overflow:hidden; box-shadow:0 4px 10px rgba(0,0,0,0.05); margin-top: 20px; }
                thead { background:#0a4d3c; color:white; }
                th { padding:15px; text-align:left; font-weight:600; }
                td { padding:12px 15px; border-bottom:1px solid #eee; }
                tr:hover { background-color: #f9f9f9; }
                
                /* Badges */
                .tag { padding:4px 8px; border-radius:4px; font-weight:bold; font-size:11px; text-transform:uppercase; display:inline-block; }
                .tag-active { background:#eefdf5; color:green; border:1px solid green; }
                .tag-inactive { background:#fff5f5; color:red; border:1px solid red; }
                
                /* Buttons */
                .btn { padding: 8px 12px; border-radius: 4px; text-decoration: none; font-size: 13px; font-weight: bold; cursor: pointer; border: none; display: inline-block; }
                .btn-primary { background: #0a4d3c; color: white; }
                .btn-edit { background: #D4AF37; color: #0a4d3c; }
                .btn-edit:hover { background: #b5952f; }
                
                /* Forms */
                .card-form { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.05); max-width: 600px; }
                .form-group { margin-bottom: 20px; }
                .form-group label { display: block; margin-bottom: 8px; font-weight: bold; color: #0a4d3c; }
                .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; font-family: inherit; }
                .search-bar { display: flex; gap: 10px; margin-bottom: 20px; align-items: center; }
            </style>
        </head>
        <body>
            <div class="sidebar">
                <h2>SEABE ADMIN</h2>
                <a href="/admin">📊 Dashboard</a>
                <a href="/admin/churches">⛪ Churches</a>
                <a href="/admin/events">🎟️ Events</a>
                <a href="/admin/ads">📢 Ads</a>
                <a href="/admin/news">📰 News</a>
                <a href="/admin/users">👥 Users</a>
                <br><br>
                <a href="/logout" style="color:#ff8888;">🚪 Sign Out</a>
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
            <div style="font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; background:#f4f7f6;">
                <form action="/login" method="POST" style="background:white; padding:40px; border-radius:10px; text-align:center; box-shadow:0 10px 30px rgba(0,0,0,0.05);">
                    <h2 style="color:#0a4d3c;">Admin Console</h2>
                    <input name="username" placeholder="Username" style="padding:10px; width:100%; margin-bottom:10px; box-sizing:border-box;">
                    <input type="password" name="password" placeholder="Password" style="padding:10px; width:100%; margin-bottom:20px; box-sizing:border-box;">
                    <button style="padding:12px 24px; background:#0a4d3c; color:white; border:none; border-radius:5px; cursor:pointer;">Sign In</button>
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
                churches: await prisma.church.count(),
                events: await prisma.event.count().catch(() => 0), // Safe check
                ads: await prisma.ad.count().catch(() => 0)
            };

            res.send(renderAdminPage('Dashboard', `
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:20px;">
                    <div style="background:white; padding:25px; border-radius:10px; box-shadow:0 4px 10px rgba(0,0,0,0.05);">
                        <h3 style="margin:0; font-size:2.5rem; color:#0a4d3c;">${counts.churches}</h3>
                        <p style="color:#666; font-weight:bold; margin-top:5px;">Active Churches</p>
                    </div>
                    <div style="background:white; padding:25px; border-radius:10px; box-shadow:0 4px 10px rgba(0,0,0,0.05);">
                        <h3 style="margin:0; font-size:2.5rem; color:#0a4d3c;">${counts.events}</h3>
                        <p style="color:#666; font-weight:bold; margin-top:5px;">Active Events</p>
                    </div>
                    <div style="background:white; padding:25px; border-radius:10px; box-shadow:0 4px 10px rgba(0,0,0,0.05);">
                        <h3 style="margin:0; font-size:2.5rem; color:#0a4d3c;">${counts.ads}</h3>
                        <p style="color:#666; font-weight:bold; margin-top:5px;">Active Ads</p>
                    </div>
                </div>
            `));
        } catch (e) {
            res.send(renderAdminPage('Dashboard', '', `Database Error: ${e.message}`));
        }
    });

    // ============================================================
    // 1. CHURCHES
    // ============================================================
    app.get('/admin/churches', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const q = req.query.q || '';
        
        try {
            const items = await prisma.church.findMany({ 
                where: { OR: [{name:{contains:q, mode:'insensitive'}}, {code:{contains:q, mode:'insensitive'}}, {email:{contains:q, mode:'insensitive'}}] },
                orderBy: { createdAt: 'desc' }
            });

            const rows = items.map(c => `
                <tr>
                    <td>${c.name}</td>
                    <td><span class="tag tag-active">${c.code}</span></td>
                    <td>${c.email}</td>
                    <td>${c.subaccountCode}</td>
                    <td style="text-align:right;"><a href="/admin/churches/edit/${c.code}" class="btn btn-edit">Edit</a></td>
                </tr>
            `).join('');

            res.send(renderAdminPage('Manage Churches', `
                <div style="display:flex; justify-content:space-between; margin-bottom:20px;">
                    <form action="/admin/churches" class="search-bar" style="margin:0;">
                        <input name="q" value="${q}" placeholder="Search Name, Code, Email..." style="padding:10px; width:300px; border:1px solid #ddd; border-radius:4px;">
                        <button class="btn btn-primary">Search</button>
                    </form>
                    <a href="/admin/churches/add" class="btn btn-primary">+ Add New Church</a>
                </div>
                <table>
                    <thead><tr><th>Name</th><th>Code</th><th>Email</th><th>Subaccount</th><th style="text-align:right;">Actions</th></tr></thead>
                    <tbody>${rows.length > 0 ? rows : '<tr><td colspan="5" style="text-align:center; padding:30px;">No results found.</td></tr>'}</tbody>
                </table>
            `));
        } catch (e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    app.get('/admin/churches/add', (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        res.send(renderAdminPage('Add New Church', `
            <form method="POST" class="card-form">
                <div class="form-group">
                    <label>Church Name</label>
                    <input name="name" required placeholder="e.g. Grace Family Church">
                </div>
                <div class="form-group">
                    <label>Official Email</label>
                    <input name="email" required placeholder="admin@church.co.za">
                </div>
                <div class="form-group">
                    <label>Subaccount Code (Optional)</label>
                    <input name="subaccount" placeholder="ACCT_xxxx (Leave empty for PENDING)">
                </div>
                <button class="btn btn-primary">Create Church</button>
                <a href="/admin/churches" class="btn" style="background:#ddd; color:#333; margin-left:10px;">Cancel</a>
            </form>
        `));
    });

    app.post('/admin/churches/add', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const code = req.body.name.replace(/[^a-zA-Z]/g, '').substring(0,3).toUpperCase() + Math.floor(100 + Math.random()*900);
        await prisma.church.create({ 
            data: { name: req.body.name, email: req.body.email, code, subaccountCode: req.body.subaccount || 'PENDING', tosAcceptedAt: new Date() } 
        });
        res.redirect('/admin/churches');
    });

    app.get('/admin/churches/edit/:code', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const c = await prisma.church.findUnique({ where: { code: req.params.code } });
        res.send(renderAdminPage('Edit Church', `
            <form action="/admin/churches/update" method="POST" class="card-form">
                <input type="hidden" name="code" value="${c.code}">
                <div class="form-group">
                    <label>Church Name (Read Only)</label>
                    <input value="${c.name}" disabled style="background:#f0f0f0; color:#888;">
                </div>
                <div class="form-group">
                    <label>Email Address</label>
                    <input name="email" value="${c.email}" required>
                </div>
                <div class="form-group">
                    <label>Paystack Subaccount</label>
                    <input name="subaccount" value="${c.subaccountCode}">
                </div>
                <button class="btn btn-primary">Update Church</button>
                <a href="/admin/churches" class="btn" style="background:#ddd; color:#333; margin-left:10px;">Cancel</a>
            </form>
        `));
    });

    app.post('/admin/churches/update', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        await prisma.church.update({ where: { code: req.body.code }, data: { email: req.body.email, subaccountCode: req.body.subaccount } });
        res.redirect('/admin/churches');
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
                    <td>${e.date}</td>
                    <td>R${e.price}</td>
                    <td>${e.church.name}</td>
                    <td><span class="tag ${e.status === 'Active' ? 'tag-active' : 'tag-inactive'}">${e.status}</span></td>
                    <td>${e.expiryDate ? new Date(e.expiryDate).toLocaleDateString() : '-'}</td>
                    <td style="text-align:right;"><a href="/admin/events/edit/${e.id}" class="btn btn-edit">Edit</a></td>
                </tr>
            `).join('');

            res.send(renderAdminPage('Manage Events', `
                <div style="text-align:right; margin-bottom:20px;"><a href="/admin/events/add" class="btn btn-primary">+ Add Event</a></div>
                <table>
                    <thead><tr><th>Event</th><th>Date Text</th><th>Price</th><th>Church</th><th>Status</th><th>Expires</th><th>Action</th></tr></thead>
                    <tbody>${rows.length > 0 ? rows : '<tr><td colspan="7" style="text-align:center;">No events found.</td></tr>'}</tbody>
                </table>
            `));
        } catch (e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    app.get('/admin/events/add', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const churches = await prisma.church.findMany();
        const opts = churches.map(c => `<option value="${c.code}">${c.name}</option>`).join('');
        
        res.send(renderAdminPage('Add Event', `
            <form method="POST" class="card-form">
                <div class="form-group"><label>Event Name</label><input name="name" required></div>
                <div class="form-group"><label>Display Date (e.g. Fri 7pm)</label><input name="date" required></div>
                <div class="form-group"><label>Price (ZAR)</label><input type="number" name="price" required></div>
                <div class="form-group"><label>Church</label><select name="churchCode">${opts}</select></div>
                <div class="form-group">
                    <label>Status</label>
                    <select name="status"><option>Active</option><option>Inactive</option></select>
                </div>
                <div class="form-group">
                    <label>Expiry Date (Auto-Hide)</label>
                    <input type="date" name="expiryDate" required>
                </div>
                <button class="btn btn-primary">Create Event</button>
            </form>
        `));
    });

    app.post('/admin/events/add', async (req, res) => {
        try {
            await prisma.event.create({ 
                data: { 
                    name: req.body.name, 
                    date: req.body.date, 
                    price: parseFloat(req.body.price), 
                    churchCode: req.body.churchCode, 
                    status: req.body.status, 
                    expiryDate: safeDate(req.body.expiryDate)
                } 
            });
            res.redirect('/admin/events');
        } catch(e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    app.get('/admin/events/edit/:id', async (req, res) => {
        const e = await prisma.event.findUnique({ where: { id: parseInt(req.params.id) } });
        const exp = e.expiryDate ? e.expiryDate.toISOString().split('T')[0] : '';
        
        res.send(renderAdminPage('Edit Event', `
            <form action="/admin/events/update" method="POST" class="card-form">
                <input type="hidden" name="id" value="${e.id}">
                <div class="form-group"><label>Event Name</label><input name="name" value="${e.name}"></div>
                <div class="form-group"><label>Display Date</label><input name="date" value="${e.date}"></div>
                <div class="form-group">
                    <label>Status</label>
                    <select name="status">
                        <option ${e.status==='Active'?'selected':''}>Active</option>
                        <option ${e.status==='Inactive'?'selected':''}>Inactive</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Expiry Date</label>
                    <input type="date" name="expiryDate" value="${exp}">
                </div>
                <button class="btn btn-primary">Update Event</button>
            </form>
        `));
    });

    app.post('/admin/events/update', async (req, res) => {
        try {
            await prisma.event.update({ 
                where: { id: parseInt(req.body.id) }, 
                data: { 
                    name: req.body.name, date: req.body.date, 
                    status: req.body.status, expiryDate: safeDate(req.body.expiryDate) 
                } 
            });
            res.redirect('/admin/events');
        } catch(e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    // ============================================================
    // 3. ADS
    // ============================================================
    app.get('/admin/ads', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        try {
            const ads = await prisma.ad.findMany({ orderBy: { id: 'desc' } });
            
            const rows = ads.map(a => `
                <tr>
                    <td>${a.text}</td>
                    <td>${a.target}</td>
                    <td><span class="tag ${a.status==='Active'?'tag-active':'tag-inactive'}">${a.status}</span></td>
                    <td>${new Date(a.expiryDate).toLocaleDateString()}</td>
                    <td style="text-align:right;"><a href="/admin/ads/edit/${a.id}" class="btn btn-edit">Edit</a></td>
                </tr>
            `).join('');

            res.send(renderAdminPage('Manage Ads', `
                <div style="text-align:right; margin-bottom:20px;"><a href="/admin/ads/add" class="btn btn-primary">+ New Ad</a></div>
                <table><thead><tr><th>Text</th><th>Target</th><th>Status</th><th>Expires</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>
            `));
        } catch (e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    app.get('/admin/ads/add', (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        res.send(renderAdminPage('New Ad', `
            <form method="POST" class="card-form">
                <div class="form-group"><label>Ad Text</label><textarea name="text" rows="3" required></textarea></div>
                <div class="form-group"><label>Target (Church Code or 'Global')</label><input name="target" value="Global"></div>
                <div class="form-group"><label>Status</label><select name="status"><option>Active</option><option>Inactive</option></select></div>
                <div class="form-group"><label>Expiry</label><input type="date" name="expiryDate" required></div>
                <button class="btn btn-primary">Save Ad</button>
            </form>
        `));
    });

    app.post('/admin/ads/add', async (req, res) => {
        try {
            await prisma.ad.create({ 
                data: { text: req.body.text, target: req.body.target, status: req.body.status, expiryDate: safeDate(req.body.expiryDate) } 
            });
            res.redirect('/admin/ads');
        } catch(e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    app.get('/admin/ads/edit/:id', async (req, res) => {
        const ad = await prisma.ad.findUnique({ where: { id: parseInt(req.params.id) } });
        const exp = ad.expiryDate.toISOString().split('T')[0];
        
        res.send(renderAdminPage('Edit Ad', `
            <form action="/admin/ads/update" method="POST" class="card-form">
                <input type="hidden" name="id" value="${ad.id}">
                <div class="form-group"><label>Text</label><textarea name="text" rows="3">${ad.text}</textarea></div>
                <div class="form-group"><label>Status</label><select name="status"><option ${ad.status==='Active'?'selected':''}>Active</option><option ${ad.status==='Inactive'?'selected':''}>Inactive</option></select></div>
                <div class="form-group"><label>Expiry</label><input type="date" name="expiryDate" value="${exp}"></div>
                <button class="btn btn-primary">Update Ad</button>
            </form>
        `));
    });

    app.post('/admin/ads/update', async (req, res) => {
        try {
            await prisma.ad.update({ where: { id: parseInt(req.body.id) }, data: { text: req.body.text, status: req.body.status, expiryDate: safeDate(req.body.expiryDate) } });
            res.redirect('/admin/ads');
        } catch(e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    // ============================================================
    // 4. NEWS
    // ============================================================
    app.get('/admin/news', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        try {
            const news = await prisma.news.findMany({ orderBy: { id: 'desc' } });
            const rows = news.map(n => `
                <tr>
                    <td>${n.headline}</td>
                    <td><span class="tag ${n.status==='Active'?'tag-active':'tag-inactive'}">${n.status}</span></td>
                    <td>${new Date(n.expiryDate).toLocaleDateString()}</td>
                    <td style="text-align:right;"><a href="/admin/news/edit/${n.id}" class="btn btn-edit">Edit</a></td>
                </tr>
            `).join('');

            res.send(renderAdminPage('Manage News', `
                <div style="text-align:right; margin-bottom:20px;"><a href="/admin/news/add" class="btn btn-primary">+ Add News</a></div>
                <table><thead><tr><th>Headline</th><th>Status</th><th>Expires</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>
            `));
        } catch(e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    app.get('/admin/news/add', (req, res) => {
        res.send(renderAdminPage('Add News', `
            <form method="POST" class="card-form">
                <div class="form-group"><label>Headline</label><input name="headline" required></div>
                <div class="form-group"><label>Body</label><textarea name="body" rows="4"></textarea></div>
                <div class="form-group"><label>Status</label><select name="status"><option>Active</option><option>Inactive</option></select></div>
                <div class="form-group"><label>Expiry</label><input type="date" name="expiryDate" required></div>
                <button class="btn btn-primary">Publish News</button>
            </form>
        `));
    });

    app.post('/admin/news/add', async (req, res) => {
        try {
            await prisma.news.create({ 
                data: { headline: req.body.headline, body: req.body.body, status: req.body.status, expiryDate: safeDate(req.body.expiryDate) } 
            });
            res.redirect('/admin/news');
        } catch(e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    app.get('/admin/news/edit/:id', async (req, res) => {
        const n = await prisma.news.findUnique({ where: { id: parseInt(req.params.id) } });
        const exp = n.expiryDate.toISOString().split('T')[0];
        
        res.send(renderAdminPage('Edit News', `
            <form action="/admin/news/update" method="POST" class="card-form">
                <input type="hidden" name="id" value="${n.id}">
                <div class="form-group"><label>Headline</label><input name="headline" value="${n.headline}"></div>
                <div class="form-group"><label>Body</label><textarea name="body" rows="4">${n.body}</textarea></div>
                <div class="form-group"><label>Status</label><select name="status"><option ${n.status==='Active'?'selected':''}>Active</option><option ${n.status==='Inactive'?'selected':''}>Inactive</option></select></div>
                <div class="form-group"><label>Expiry</label><input type="date" name="expiryDate" value="${exp}"></div>
                <button class="btn btn-primary">Update News</button>
            </form>
        `));
    });

    app.post('/admin/news/update', async (req, res) => {
        try {
            await prisma.news.update({ where: { id: parseInt(req.body.id) }, data: { headline: req.body.headline, body: req.body.body, status: req.body.status, expiryDate: safeDate(req.body.expiryDate) } });
            res.redirect('/admin/news');
        } catch(e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    // ============================================================
    // 5. USERS (Search)
    // ============================================================
    app.get('/admin/users', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const q = req.query.q || '';
        
        try {
            const members = await prisma.member.findMany({ 
                where: { OR: [{ phone: { contains: q } }, { churchCode: { contains: q, mode: 'insensitive' } }] }, 
                take: 50, 
                orderBy: { id: 'desc' } 
            });

            const rows = members.map(m => `<tr><td>${m.phone}</td><td><span class="tag">${m.churchCode}</span></td></tr>`).join('');
            res.send(renderAdminPage('Manage Users', `
                <form action="/admin/users" class="search-bar">
                    <input name="q" value="${q}" placeholder="Search Phone or Church Code..." style="padding:10px; width:300px; border:1px solid #ddd; border-radius:4px;">
                    <button class="btn btn-primary">Search</button>
                </form>
                <table>
                    <thead><tr><th>Phone</th><th>Church</th></tr></thead>
                    <tbody>${rows.length > 0 ? rows : '<tr><td colspan="2" style="text-align:center;">No users found.</td></tr>'}</tbody>
                </table>
            `));
        } catch(e) { res.send(renderAdminPage('Error', '', e.message)); }
    });
};