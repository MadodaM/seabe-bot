// routes/admin.js
// VERSION: 2.6 (CRUD Features: Search, Add, Edit)
require('dotenv').config();

// --- AUTH CONFIG ---
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'seabe123';
const COOKIE_NAME = 'seabe_admin_session';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'secret_token_123';

// --- HELPERS ---
function parseCookies(request) {
    const list = {}, rc = request.headers.cookie;
    rc && rc.split(';').forEach(function(cookie) {
        const parts = cookie.split('=');
        list[parts.shift().trim()] = decodeURI(parts.join('='));
    });
    return list;
}

function isAuthenticated(req) {
    const cookies = parseCookies(req);
    return cookies[COOKIE_NAME] === ADMIN_SECRET;
}

// --- SHARED UI RENDERER ---
function renderAdminPage(title, content) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>${title} | Seabe Admin</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: 'Segoe UI', sans-serif; background: #f4f7f6; margin: 0; display: flex; color: #333; }
                
                /* SIDEBAR */
                .sidebar { width: 250px; background: #0a4d3c; color: white; min-height: 100vh; padding: 20px; box-sizing: border-box; position: fixed; }
                .sidebar h2 { color: #D4AF37; margin-top: 0; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); }
                .sidebar a { display: block; color: #ddd; text-decoration: none; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05); transition: 0.2s; }
                .sidebar a:hover { color: white; padding-left: 5px; color: #D4AF37; }
                
                /* MAIN CONTENT */
                .main { margin-left: 250px; flex: 1; padding: 40px; }
                h1 { color: #0a4d3c; margin-bottom: 30px; border-bottom: 2px solid #D4AF37; display: inline-block; padding-bottom: 5px; }
                
                /* TABLES */
                table { width:100%; border-collapse:collapse; background:white; border-radius:8px; overflow:hidden; box-shadow:0 4px 10px rgba(0,0,0,0.05); margin-top: 20px; }
                thead { background:#0a4d3c; color:white; }
                th { padding:15px; text-align:left; font-weight: 600; }
                td { padding:12px 15px; color:#555; border-bottom:1px solid #eee; }
                tr:hover { background-color: #f9f9f9; }
                
                /* COMPONENTS */
                .tag { background:#eefdf5; color:#0a4d3c; padding:4px 8px; border-radius:4px; font-weight:bold; font-size:12px; border: 1px solid #ccebd6; }
                .btn { padding: 8px 12px; border-radius: 4px; text-decoration: none; font-size: 13px; font-weight: bold; display: inline-block; cursor: pointer; border: none; }
                .btn-primary { background: #0a4d3c; color: white; }
                .btn-edit { background: #D4AF37; color: #0a4d3c; }
                .btn-edit:hover { background: #b5952f; }
                
                /* FORMS */
                .search-bar { display: flex; gap: 10px; margin-bottom: 20px; }
                .search-input { padding: 10px; border: 1px solid #ccc; border-radius: 4px; width: 300px; }
                .card-form { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.05); max-width: 600px; }
                .form-group { margin-bottom: 15px; }
                .form-group label { display: block; margin-bottom: 5px; font-weight: bold; color: #0a4d3c; font-size: 14px; }
                .form-group input { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
                
                /* RESPONSIVE */
                @media(max-width: 768px) {
                    .sidebar { width: 60px; padding: 10px; }
                    .sidebar h2, .sidebar span { display: none; }
                    .main { margin-left: 60px; padding: 20px; }
                }
            </style>
        </head>
        <body>
            <div class="sidebar">
                <h2>SEABE</h2>
                <a href="/admin">📊 <span>Dashboard</span></a>
                <a href="/admin/churches">⛪ <span>Churches</span></a>
                <a href="/admin/users">👥 <span>Users</span></a>
                <a href="/admin/events">🎟️ <span>Events</span></a>
                <a href="/admin/ads">📢 <span>Ads</span></a>
                <br><br>
                <a href="/logout" style="color:#ff8888;">🚪 <span>Sign Out</span></a>
            </div>
            <div class="main">
                <h1>${title}</h1>
                ${content}
            </div>
        </body>
        </html>
    `;
}

module.exports = function(app, { prisma }) {

    // 1. AUTH ROUTES
    app.get('/login', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html><head><title>Sign In</title><style>body{font-family:sans-serif;background:#f4f7f6;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}.card{background:white;padding:40px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,0.05);text-align:center;width:300px}input{width:100%;padding:12px;margin-bottom:15px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box}button{width:100%;padding:12px;background:#0a4d3c;color:white;border:none;border-radius:6px;font-weight:bold;cursor:pointer}</style></head>
            <body><div class="card"><h2 style="color:#0a4d3c">Admin Console</h2><form action="/login" method="POST"><input name="username" placeholder="Username"><input type="password" name="password" placeholder="Password"><button>Sign In</button></form><br><a href="/" style="color:#999;text-decoration:none;font-size:12px">Back to Home</a></div></body></html>
        `);
    });

    app.post('/login', (req, res) => {
        const { username, password } = req.body;
        if (username === ADMIN_USER && password === ADMIN_PASS) {
            res.setHeader('Set-Cookie', `${COOKIE_NAME}=${ADMIN_SECRET}; HttpOnly; Path=/; Max-Age=3600`);
            res.redirect('/admin');
        } else { res.redirect('/login'); }
    });

    app.get('/logout', (req, res) => {
        res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`);
        res.redirect('/login');
    });

    // 2. DASHBOARD
    app.get('/admin', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const cCount = await prisma.church.count();
        const mCount = await prisma.member.count();
        const tCount = await prisma.transaction.count();
        
        const html = `
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:20px;">
                <div style="background:white; padding:25px; border-radius:10px; box-shadow:0 4px 15px rgba(0,0,0,0.05);">
                    <h3 style="margin:0; font-size:2.5rem; color:#0a4d3c;">${cCount}</h3><p style="color:#666; font-weight:bold; text-transform:uppercase;">Active Churches</p>
                </div>
                <div style="background:white; padding:25px; border-radius:10px; box-shadow:0 4px 15px rgba(0,0,0,0.05);">
                    <h3 style="margin:0; font-size:2.5rem; color:#0a4d3c;">${mCount}</h3><p style="color:#666; font-weight:bold; text-transform:uppercase;">Members</p>
                </div>
                <div style="background:white; padding:25px; border-radius:10px; box-shadow:0 4px 15px rgba(0,0,0,0.05);">
                    <h3 style="margin:0; font-size:2.5rem; color:#0a4d3c;">${tCount}</h3><p style="color:#666; font-weight:bold; text-transform:uppercase;">Transactions</p>
                </div>
            </div>`;
        res.send(renderAdminPage('Dashboard', html));
    });

    // ==========================================
    // 3. CHURCH MANAGEMENT (Search, Add, Edit)
    // ==========================================
    
    // LIST & SEARCH
    app.get('/admin/churches', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const query = req.query.q || '';
        
        // Search Logic
        const churches = await prisma.church.findMany({
            where: {
                OR: [
                    { name: { contains: query, mode: 'insensitive' } },
                    { code: { contains: query, mode: 'insensitive' } },
                    { email: { contains: query, mode: 'insensitive' } }
                ]
            },
            orderBy: { tosAcceptedAt: 'desc' }
        });

        const rows = churches.map(c => `
            <tr>
                <td>${c.name}</td>
                <td><span class="tag">${c.code}</span></td>
                <td>${c.email}</td>
                <td>${c.subaccountCode}</td>
                <td style="text-align:right;">
                    <a href="/admin/churches/edit/${c.code}" class="btn btn-edit">Edit</a>
                </td>
            </tr>
        `).join('');

        const html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <form action="/admin/churches" method="GET" class="search-bar" style="margin:0;">
                    <input type="text" name="q" class="search-input" placeholder="Search by Name, Code, or Email..." value="${query}">
                    <button type="submit" class="btn btn-primary">Search</button>
                    ${query ? '<a href="/admin/churches" class="btn" style="background:#ddd; color:#333; margin-left:5px;">Clear</a>' : ''}
                </form>
                <a href="/admin/churches/add" class="btn btn-primary" style="padding:10px 20px;">+ Add New Church</a>
            </div>

            <table>
                <thead><tr><th>Name</th><th>Code</th><th>Email</th><th>Subaccount</th><th style="text-align:right;">Actions</th></tr></thead>
                <tbody>${rows.length > 0 ? rows : '<tr><td colspan="5" style="text-align:center; padding:30px;">No churches found.</td></tr>'}</tbody>
            </table>
        `;
        res.send(renderAdminPage('Manage Churches', html));
    });

    // ADD CHURCH FORM
    app.get('/admin/churches/add', (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        res.send(renderAdminPage('Add New Church', `
            <div class="card-form">
                <form action="/admin/churches/add" method="POST">
                    <div class="form-group">
                        <label>Church Name</label>
                        <input type="text" name="name" required placeholder="e.g. Grace Bible Church">
                    </div>
                    <div class="form-group">
                        <label>Official Email</label>
                        <input type="email" name="email" required placeholder="admin@church.co.za">
                    </div>
                    <div class="form-group">
                        <label>Subaccount Code (Optional)</label>
                        <input type="text" name="subaccount" placeholder="ACCT_xxxx (Leave empty for PENDING)">
                    </div>
                    <div style="margin-top:20px; display:flex; gap:10px;">
                        <button type="submit" class="btn btn-primary" style="padding:10px 20px;">Create Church</button>
                        <a href="/admin/churches" class="btn" style="background:#ddd; color:#333; padding:10px 20px;">Cancel</a>
                    </div>
                </form>
            </div>
        `));
    });

    // ADD CHURCH LOGIC
    app.post('/admin/churches/add', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const { name, email, subaccount } = req.body;
        // Generate random code
        const prefix = name.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
        const newCode = `${prefix}${Math.floor(100 + Math.random() * 900)}`;
        
        try {
            await prisma.church.create({
                data: {
                    name: name, code: newCode, email: email,
                    subaccountCode: subaccount || 'PENDING_MANUAL',
                    tosAcceptedAt: new Date() // Manual add assumes TOS implicit
                }
            });
            res.redirect('/admin/churches?q=' + newCode);
        } catch(e) { res.send(`Error: ${e.message}`); }
    });

    // EDIT CHURCH FORM
    app.get('/admin/churches/edit/:code', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const church = await prisma.church.findUnique({ where: { code: req.params.code } });
        if (!church) return res.send("Church not found");

        res.send(renderAdminPage(`Edit: ${church.name}`, `
            <div class="card-form">
                <form action="/admin/churches/update" method="POST">
                    <input type="hidden" name="code" value="${church.code}">
                    <div class="form-group">
                        <label>Church Name (Read Only)</label>
                        <input type="text" value="${church.name}" disabled style="background:#eee;">
                    </div>
                    <div class="form-group">
                        <label>Email Address</label>
                        <input type="email" name="email" value="${church.email}" required>
                    </div>
                    <div class="form-group">
                        <label>Paystack Subaccount Code</label>
                        <input type="text" name="subaccount" value="${church.subaccountCode}">
                        <small style="color:#666;">Update this once KYC is approved on Paystack.</small>
                    </div>
                    <div style="margin-top:20px; display:flex; gap:10px;">
                        <button type="submit" class="btn btn-primary" style="padding:10px 20px;">Save Changes</button>
                        <a href="/admin/churches" class="btn" style="background:#ddd; color:#333; padding:10px 20px;">Cancel</a>
                    </div>
                </form>
            </div>
        `));
    });

    // UPDATE CHURCH LOGIC
    app.post('/admin/churches/update', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const { code, email, subaccount } = req.body;
        try {
            await prisma.church.update({
                where: { code: code },
                data: { email: email, subaccountCode: subaccount }
            });
            res.redirect('/admin/churches');
        } catch(e) { res.send(`Error: ${e.message}`); }
    });

    // ==========================================
    // 4. USER MANAGEMENT (Search Only for now)
    // ==========================================
    app.get('/admin/users', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const query = req.query.q || '';
        
        const members = await prisma.member.findMany({
            where: {
                OR: [
                    { phone: { contains: query } },
                    { churchCode: { contains: query, mode: 'insensitive' } }
                ]
            },
            take: 50,
            orderBy: { phone: 'desc' }
        });

        const rows = members.map(m => `
            <tr>
                <td>${m.phone}</td>
                <td><span class="tag">${m.churchCode}</span></td>
                <td><a href="/admin/churches?q=${m.churchCode}" style="font-size:12px; color:#0a4d3c;">View Church</a></td>
            </tr>
        `).join('');

        const html = `
             <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <form action="/admin/users" method="GET" class="search-bar" style="margin:0;">
                    <input type="text" name="q" class="search-input" placeholder="Search by Phone or Church Code..." value="${query}">
                    <button type="submit" class="btn btn-primary">Search</button>
                    ${query ? '<a href="/admin/users" class="btn" style="background:#ddd; color:#333; margin-left:5px;">Clear</a>' : ''}
                </form>
            </div>
            <table>
                <thead><tr><th>WhatsApp Number</th><th>Church Code</th><th>Actions</th></tr></thead>
                <tbody>${rows.length > 0 ? rows : '<tr><td colspan="3" style="text-align:center; padding:30px;">No users found.</td></tr>'}</tbody>
            </table>
        `;
        res.send(renderAdminPage('Manage Platform Users', html));
    });

    // --- PLACEHOLDERS ---
    const wip = `<div style="background:white; padding:40px; text-align:center; border-radius:8px;"><h3>🚧 Coming Soon</h3><p>Use database directly for now.</p></div>`;
    app.get('/admin/events', (req, res) => { if (!isAuthenticated(req)) return res.redirect('/login'); res.send(renderAdminPage('Manage Events', wip)); });
    app.get('/admin/ads', (req, res) => { if (!isAuthenticated(req)) return res.redirect('/login'); res.send(renderAdminPage('Manage Ads', wip)); });
};