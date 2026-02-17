// routes/platform.js
// VERSION: 4.1 (Schema Alignment: defaultPremium + subscriptionFee + subaccountCode)
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
    if (!d) return new Date(); 
    return new Date(d);
}

// --- UI LAYOUT ---
function renderAdminPage(title, content, error = null) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <link rel="icon" type="image/png" href="/favicon.png">
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
                .tag { padding:4px 8px; border-radius:4px; font-weight:bold; font-size:11px; text-transform:uppercase; display:inline-block; }
                .tag-church { background:#eefdf5; color:green; border:1px solid green; }
                .tag-society { background:#eefafc; color:#0984e3; border:1px solid #0984e3; }
                .tag-npo { background:#fff8e1; color:#f39c12; border:1px solid #f39c12; }
                
                /* Buttons */
                .btn { padding: 8px 15px; border-radius: 4px; text-decoration: none; font-size: 13px; font-weight: bold; cursor: pointer; border: none; display: inline-block; transition: 0.2s; }
                .btn-primary { background: #1e272e; color: white; }
                .btn-primary:hover { background: #00d2d3; color: #1e272e; }
                .btn-edit { background: #dfe6e9; color: #2d3436; }
                .btn-edit:hover { background: #b2bec3; }
                
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
                <a href="/admin/churches">🏢 Organizations</a>
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
                ads: await prisma.ad.count().catch(() => 0)
            };

            res.send(renderAdminPage('Platform Overview', `
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:20px;">
                    <div style="background:white; padding:30px; border-radius:10px; border-left: 5px solid #00d2d3; box-shadow:0 4px 10px rgba(0,0,0,0.05);">
                        <h3 style="margin:0; font-size:3rem; color:#1e272e;">${counts.orgs}</h3>
                        <p style="color:#636e72; font-weight:bold; margin-top:5px; text-transform:uppercase; font-size:12px;">Total Organizations</p>
                    </div>
                    <div style="background:white; padding:30px; border-radius:10px; border-left: 5px solid #a29bfe; box-shadow:0 4px 10px rgba(0,0,0,0.05);">
                        <h3 style="margin:0; font-size:3rem; color:#1e272e;">${counts.events}</h3>
                        <p style="color:#636e72; font-weight:bold; margin-top:5px; text-transform:uppercase; font-size:12px;">Active Events</p>
                    </div>
                    <div style="background:white; padding:30px; border-radius:10px; border-left: 5px solid #fdcb6e; box-shadow:0 4px 10px rgba(0,0,0,0.05);">
                        <h3 style="margin:0; font-size:3rem; color:#1e272e;">${counts.ads}</h3>
                        <p style="color:#636e72; font-weight:bold; margin-top:5px; text-transform:uppercase; font-size:12px;">Active Ads</p>
                    </div>
                </div>
            `));
        } catch (e) {
            res.send(renderAdminPage('Dashboard', '', `Database Error: ${e.message}`));
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
                where: { OR: [
                    {name:{contains:q, mode:'insensitive'}}, 
                    {code:{contains:q, mode:'insensitive'}},
                    {adminPhone:{contains:q}} 
                ]},
                orderBy: { createdAt: 'desc' } 
            });

            const rows = items.map(c => {
                let badgeClass = 'tag-church';
                if (c.type === 'BURIAL_SOCIETY') badgeClass = 'tag-society';
                if (c.type === 'NON_PROFIT') badgeClass = 'tag-npo';

                return `
                <tr>
                    <td>
                        <strong>${c.name}</strong><br>
                        <span style="font-size:11px; color:#999;">${c.email || 'No Email'}</span>
                    </td>
                    <td><span class="tag ${badgeClass}">${c.type.replace('_', ' ')}</span></td>
                    <td><code>${c.code}</code></td>
                    <td>${c.adminPhone || '<span style="color:red">Missing</span>'}</td>
                    <td>${c.subaccountCode ? '✅ Linked' : '<span style="color:orange">Pending</span>'}</td>
                    <td style="text-align:right;">
                        <a href="/admin/churches/edit/${c.code}" class="btn btn-edit">Manage</a>
                    </td>
                </tr>
            `}).join('');

            res.send(renderAdminPage('Manage Organizations', `
                <div style="display:flex; justify-content:space-between; margin-bottom:20px; align-items:center;">
                    <form action="/admin/churches" class="search-bar" style="margin:0;">
                        <input name="q" value="${q}" placeholder="Search Name, Code, Phone..." style="padding:10px; width:300px; border:1px solid #ddd; border-radius:4px;">
                        <button class="btn btn-primary">Search</button>
                    </form>
                    <a href="/admin/churches/add" class="btn btn-primary" style="background:#00d2d3; color:black;">+ New Organization</a>
                </div>
                <table>
                    <thead><tr><th>Organization</th><th>Type</th><th>Code</th><th>Admin Phone</th><th>Payments</th><th style="text-align:right;">Actions</th></tr></thead>
                    <tbody>${rows.length > 0 ? rows : '<tr><td colspan="6" style="text-align:center; padding:30px;">No results found.</td></tr>'}</tbody>
                </table>
            `));
        } catch (e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    // --- ADD ORGANIZATION ---
    app.get('/admin/churches/add', (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        res.send(renderAdminPage('Add New Organization', `
            <form method="POST" class="card-form">
                <div class="form-group">
                    <label>Organization Type</label>
                    <select name="type" required>
                        <option value="CHURCH">Church ⛪</option>
                        <option value="BURIAL_SOCIETY">Burial Society 🛡️</option>
                        <option value="NON_PROFIT">Non-Profit / NGO 🤝</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Organization Name</label>
                    <input name="name" required placeholder="e.g. Grace Family Church">
                </div>
                <div class="form-group">
                    <label>Official Email</label>
                    <input name="email" required placeholder="admin@org.co.za">
                </div>
                <div class="form-group">
                    <label>Admin WhatsApp Number (Required for OTP)</label>
                    <input name="adminPhone" required placeholder="27820001111" pattern="[0-9]+">
                    <small style="color:#666;">Format: 2782... (No spaces, no +)</small>
                </div>
                
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px;">
                    <div class="form-group">
                        <label>Member Default Premium (ZAR)</label>
                        <input type="number" name="defaultPremium" placeholder="150.00" value="150" step="10">
                        <small style="color:#666;">Standard price for members.</small>
                    </div>
                    <div class="form-group">
                        <label>Org Subscription Fee (ZAR)</label>
                        <input type="number" name="subscriptionFee" placeholder="0.00" value="0" step="10">
                        <small style="color:#666;">What Org pays Platform.</small>
                    </div>
                </div>

                <div class="form-group">
                    <label>Paystack Subaccount Code</label>
                    <input name="subaccount" placeholder="ACCT_xxxx (Leave empty if none)">
                </div>
                <button class="btn btn-primary" style="width:100%; padding:15px;">Create Organization</button>
            </form>
        `));
    });

    app.post('/admin/churches/add', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        
        // Generate Unique Code (First 3 chars of name + random)
        const prefix = req.body.name.replace(/[^a-zA-Z]/g, '').substring(0,3).toUpperCase();
        const code = prefix + Math.floor(100 + Math.random()*900);

        try {
            await prisma.church.create({ 
                data: { 
                    name: req.body.name, 
                    email: req.body.email, 
                    code: code,
                    type: req.body.type,
                    adminPhone: req.body.adminPhone,
                    
                    // ✅ Updated Schema Fields
                    defaultPremium: parseFloat(req.body.defaultPremium || 150),
                    subscriptionFee: parseFloat(req.body.subscriptionFee || 0),
                    subaccountCode: req.body.subaccount || '', // Maps 'subaccount' input to 'subaccountCode' DB field

                    createdAt: new Date()
                } 
            });
            res.redirect('/admin/churches');
        } catch(e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    // --- EDIT ORGANIZATION ---
    app.get('/admin/churches/edit/:code', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const c = await prisma.church.findUnique({ where: { code: req.params.code } });
        
        res.send(renderAdminPage('Edit Organization', `
            <form action="/admin/churches/update" method="POST" class="card-form">
                <input type="hidden" name="code" value="${c.code}">
                
                <div class="form-group">
                    <label>Organization Name (Read Only)</label>
                    <input value="${c.name}" disabled style="background:#f0f0f0; color:#888;">
                </div>

                <div class="form-group">
                    <label>Organization Type</label>
                    <select name="type">
                        <option value="CHURCH" ${c.type==='CHURCH'?'selected':''}>Church</option>
                        <option value="BURIAL_SOCIETY" ${c.type==='BURIAL_SOCIETY'?'selected':''}>Burial Society</option>
                        <option value="NON_PROFIT" ${c.type==='NON_PROFIT'?'selected':''}>Non-Profit</option>
                    </select>
                </div>

                <div class="form-group">
                    <label>Admin WhatsApp Number</label>
                    <input name="adminPhone" value="${c.adminPhone || ''}" required>
                </div>

                <div class="form-group">
                    <label>Email Address</label>
                    <input name="email" value="${c.email || ''}" required>
                </div>

                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px;">
                    <div class="form-group">
                        <label>Member Default Premium</label>
                        <input type="number" name="defaultPremium" value="${c.defaultPremium || 150}">
                    </div>
                    <div class="form-group">
                        <label>Org Subscription Fee</label>
                        <input type="number" name="subscriptionFee" value="${c.subscriptionFee || 0}">
                    </div>
                </div>

                <div class="form-group">
                    <label>Paystack Subaccount</label>
                    <input name="subaccount" value="${c.subaccountCode || ''}">
                </div>

                <button class="btn btn-primary">Update Organization</button>
                <a href="/admin/churches" class="btn" style="background:#ddd; color:#333; margin-left:10px;">Cancel</a>
            </form>
        `));
    });

    app.post('/admin/churches/update', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        try {
            await prisma.church.update({ 
                where: { code: req.body.code }, 
                data: { 
                    email: req.body.email, 
                    type: req.body.type,
                    adminPhone: req.body.adminPhone,
                    
                    // ✅ Updated Schema Fields
                    defaultPremium: parseFloat(req.body.defaultPremium),
                    subscriptionFee: parseFloat(req.body.subscriptionFee),
                    subaccountCode: req.body.subaccount 
                } 
            });
            res.redirect('/admin/churches');
        } catch(e) { res.send(renderAdminPage('Error', '', e.message)); }
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
                    <td>${e.church ? e.church.name : 'Unknown'}</td>
                    <td><span class="tag ${e.status === 'Active' ? 'tag-church' : 'tag-npo'}">${e.status}</span></td>
                    <td>${e.expiryDate ? new Date(e.expiryDate).toLocaleDateString() : '-'}</td>
                    <td style="text-align:right;"><a href="/admin/events/edit/${e.id}" class="btn btn-edit">Edit</a></td>
                </tr>
            `).join('');

            res.send(renderAdminPage('Manage Events', `
                <div style="text-align:right; margin-bottom:20px;"><a href="/admin/events/add" class="btn btn-primary">+ Add Event</a></div>
                <table>
                    <thead><tr><th>Event</th><th>Date Text</th><th>Price</th><th>Organization</th><th>Status</th><th>Expires</th><th>Action</th></tr></thead>
                    <tbody>${rows.length > 0 ? rows : '<tr><td colspan="7" style="text-align:center;">No events found.</td></tr>'}</tbody>
                </table>
            `));
        } catch (e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    app.get('/admin/events/add', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const churches = await prisma.church.findMany({ orderBy: { name: 'asc' } });
        const opts = churches.map(c => `<option value="${c.code}">${c.name} (${c.type})</option>`).join('');
        
        res.send(renderAdminPage('Add Event', `
            <form method="POST" class="card-form">
                <div class="form-group"><label>Event Name</label><input name="name" required></div>
                <div class="form-group"><label>Display Date (e.g. Fri 7pm)</label><input name="date" required></div>
                <div class="form-group"><label>Price (ZAR)</label><input type="number" name="price" required></div>
                <div class="form-group"><label>Organization</label><select name="churchCode">${opts}</select></div>
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

    // ============================================================
    // 3. ADS
    // ============================================================
    app.get('/admin/ads', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        try {
            const ads = await prisma.ad.findMany({ include: { church: true }, orderBy: { id: 'desc' } });
            
            const rows = ads.map(a => `
                <tr>
                    <td>${a.content}</td>
                    <td>${a.church ? a.church.name : 'Unknown'}</td>
                    <td style="font-weight:bold; color:#00d2d3;">👁️ ${a.views || 0}</td>
                    <td><span class="tag ${a.status==='Active'?'tag-church':'tag-npo'}">${a.status}</span></td>
                    <td>${new Date(a.expiryDate).toLocaleDateString()}</td>
                    <td style="text-align:right;"><a href="/admin/ads/edit/${a.id}" class="btn btn-edit">Edit</a></td>
                </tr>
            `).join('');

            res.send(renderAdminPage('Manage Ads', `
                <div style="text-align:right; margin-bottom:20px;"><a href="/admin/ads/add" class="btn btn-primary">+ New Ad</a></div>
                <table>
                    <thead><tr><th>Ad Content</th><th>Target Org</th><th>Views</th><th>Status</th><th>Expires</th><th>Action</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            `));
        } catch (e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    app.get('/admin/ads/add', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const churches = await prisma.church.findMany({ select: { id: true, name: true } });
        const options = churches.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

        res.send(renderAdminPage('New Ad', `
            <form method="POST" class="card-form">
                <div class="form-group"><label>Ad Content</label><textarea name="content" rows="3" required placeholder="Ad text here..."></textarea></div>
                <div class="form-group">
                    <label>Target Organization</label>
                    <select name="churchId" required>
                        <option value="" disabled selected>Select an Org...</option>
                        ${options}
                    </select>
                </div>
                <div class="form-group"><label>Status</label><select name="status"><option>Active</option><option>Inactive</option></select></div>
                <div class="form-group"><label>Expiry</label><input type="date" name="expiryDate" required></div>
                <button class="btn btn-primary">Save Ad</button>
            </form>
        `));
    });

    app.post('/admin/ads/add', async (req, res) => {
        try {
            await prisma.ad.create({ 
                data: { 
                    content: req.body.content, 
                    churchId: parseInt(req.body.churchId), 
                    status: req.body.status, 
                    expiryDate: safeDate(req.body.expiryDate) 
                } 
            });
            res.redirect('/admin/ads');
        } catch(e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    // ============================================================
    // 4. NEWS
    // ============================================================
    app.get('/admin/news', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        try {
            const news = await prisma.news.findMany({ include: { church: true }, orderBy: { id: 'desc' } });
            
            const rows = news.map(n => `
                <tr>
                    <td>${n.headline}</td>
                    <td>${n.church ? n.church.name : 'Unknown'}</td>
                    <td><span class="tag ${n.status==='Active'?'tag-church':'tag-npo'}">${n.status}</span></td>
                    <td>${new Date(n.expiryDate).toLocaleDateString()}</td>
                    <td style="text-align:right;"><a href="#" class="btn btn-edit">Edit</a></td>
                </tr>
            `).join('');

            res.send(renderAdminPage('Manage News', `
                <div style="text-align:right; margin-bottom:20px;"><a href="/admin/news/add" class="btn btn-primary">+ Add News</a></div>
                <table><thead><tr><th>Headline</th><th>Organization</th><th>Status</th><th>Expires</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>
            `));
        } catch(e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    app.get('/admin/news/add', async (req, res) => {
        const churches = await prisma.church.findMany({ select: { id: true, name: true } });
        const options = churches.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

        res.send(renderAdminPage('Add News', `
            <form method="POST" class="card-form">
                <div class="form-group"><label>Headline</label><input name="headline" required></div>
                <div class="form-group">
                    <label>Target Organization</label>
                    <select name="churchId" required>
                        <option value="" disabled selected>Select an Org...</option>
                        ${options}
                    </select>
                </div>
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
                data: { 
                    headline: req.body.headline,
                    body: req.body.body, 
                    churchId: parseInt(req.body.churchId),
                    status: req.body.status, 
                    expiryDate: safeDate(req.body.expiryDate) 
                } 
            });
            res.redirect('/admin/news');
        } catch(e) { res.send(renderAdminPage('Error', '', e.message)); }
    });

    // ============================================================
    // 5. USERS
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

            const rows = members.map(m => `<tr><td>${m.phone}</td><td><span class="tag">${m.churchCode}</span></td><td>${m.firstName}</td></tr>`).join('');
            res.send(renderAdminPage('Manage Users', `
                <form action="/admin/users" class="search-bar">
                    <input name="q" value="${q}" placeholder="Search Phone or Code..." style="padding:10px; width:300px; border:1px solid #ddd; border-radius:4px;">
                    <button class="btn btn-primary">Search</button>
                </form>
                <table>
                    <thead><tr><th>Phone</th><th>Org Code</th><th>Name</th></tr></thead>
                    <tbody>${rows.length > 0 ? rows : '<tr><td colspan="3" style="text-align:center;">No users found.</td></tr>'}</tbody>
                </table>
            `));
        } catch(e) { res.send(renderAdminPage('Error', '', e.message)); }
    });
};