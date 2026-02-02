// routes/admin.js
// PURPOSE: Handles Admin Login, Authentication, and Dashboard Logic
require('dotenv').config();

// --- AUTH CONFIG ---
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'seabe123';
const COOKIE_NAME = 'seabe_admin_session';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'secret_token_123';

// --- AUTH HELPERS ---
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

function renderAdminPage(title, content) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>${title} | Seabe Admin</title>
            <style>
                body { font-family: 'Segoe UI', sans-serif; background: #f4f7f6; margin: 0; display: flex; }
                .sidebar { width: 250px; background: #0a4d3c; color: white; min-height: 100vh; padding: 20px; box-sizing: border-box; }
                .sidebar h2 { color: #D4AF37; margin-top: 0; }
                .sidebar a { display: block; color: #ddd; text-decoration: none; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.1); }
                .sidebar a:hover { color: white; padding-left: 5px; transition: 0.2s; }
                .main { flex: 1; padding: 40px; }
                h1 { color: #333; margin-bottom: 30px; }
                table { width:100%; border-collapse:collapse; background:white; border-radius:8px; overflow:hidden; box-shadow:0 4px 10px rgba(0,0,0,0.05); }
                thead { background:#0a4d3c; color:white; }
                th { padding:15px; text-align:left; }
                td { padding:12px 15px; color:#555; border-bottom:1px solid #eee; }
                .tag { background:#eefdf5; color:#0a4d3c; padding:4px 8px; border-radius:4px; font-weight:bold; font-size:12px; }
            </style>
        </head>
        <body>
            <div class="sidebar">
                <h2>SEABE ADMIN</h2>
                <a href="/admin">Dashboard</a>
                <a href="/admin/churches">Manage Churches</a>
                <a href="/admin/users">Manage Users</a>
                <a href="/admin/events">Manage Events</a>
                <a href="/admin/ads">Manage Ads</a>
                <a href="/admin/news">Manage News</a>
                <br><br>
                <a href="/logout" style="color:#ff8888;">Sign Out</a>
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

    // 1. LOGIN PAGE
    app.get('/login', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Admin Sign In</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: #f4f7f6; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
                    .card { background: white; padding: 40px; border-radius: 10px; width: 100%; max-width: 350px; box-shadow: 0 10px 30px rgba(0,0,0,0.05); text-align: center; }
                    h2 { color: #0a4d3c; margin-bottom: 5px; }
                    input { width: 100%; padding: 12px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 6px; }
                    button { width: 100%; padding: 12px; background: #0a4d3c; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>Admin Console</h2>
                    <p style="color:#888; margin-bottom:30px;">Sign in to manage the platform</p>
                    <form action="/login" method="POST">
                        <input type="text" name="username" placeholder="Username" required>
                        <input type="password" name="password" placeholder="Password" required>
                        <button type="submit">Sign In</button>
                    </form>
                    <br><a href="/" style="color:#aaa; text-decoration:none; font-size:12px;">Back to Home</a>
                </div>
            </body>
            </html>
        `);
    });

    // 2. AUTH HANDLER
    app.post('/login', (req, res) => {
        const { username, password } = req.body;
        if (username === ADMIN_USER && password === ADMIN_PASS) {
            res.setHeader('Set-Cookie', `${COOKIE_NAME}=${ADMIN_SECRET}; HttpOnly; Path=/; Max-Age=3600`);
            res.redirect('/admin');
        } else {
            res.send('<h3 style="color:red; text-align:center; margin-top:50px;">Invalid Credentials</h3><p style="text-align:center;"><a href="/login">Try Again</a></p>');
        }
    });

    app.get('/logout', (req, res) => {
        res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`);
        res.redirect('/login');
    });

    // 3. DASHBOARD
    app.get('/admin', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        
        const churchCount = await prisma.church.count();
        const memberCount = await prisma.member.count();
        const transactionCount = await prisma.transaction.count();
        
        const content = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px;">
                <div>System Status: <span style="color:green; font-weight:bold;">● Online</span></div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px;">
                <div style="background: white; padding: 25px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
                    <h3 style="margin: 0; font-size: 2.5rem; color: #0a4d3c;">${churchCount}</h3>
                    <p style="margin: 5px 0 0; color: #666; text-transform: uppercase; font-size: 0.8rem; font-weight: bold;">Active Churches</p>
                </div>
                <div style="background: white; padding: 25px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
                    <h3 style="margin: 0; font-size: 2.5rem; color: #0a4d3c;">${memberCount}</h3>
                    <p style="margin: 5px 0 0; color: #666; text-transform: uppercase; font-size: 0.8rem; font-weight: bold;">Registered Members</p>
                </div>
                <div style="background: white; padding: 25px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
                    <h3 style="margin: 0; font-size: 2.5rem; color: #0a4d3c;">${transactionCount}</h3>
                    <p style="margin: 5px 0 0; color: #666; text-transform: uppercase; font-size: 0.8rem; font-weight: bold;">Transactions</p>
                </div>
            </div>
        `;
        res.send(renderAdminPage('Dashboard', content));
    });

    // 4. MANAGEMENT PAGES
    app.get('/admin/churches', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const churches = await prisma.church.findMany({ orderBy: { tosAcceptedAt: 'desc' } });
        const rows = churches.map(c => `<tr><td>${c.name}</td><td><span class="tag">${c.code}</span></td><td>${c.email}</td><td>${c.subaccountCode}</td><td>${c.tosAcceptedAt?.toLocaleDateString()}</td></tr>`).join('');
        res.send(renderAdminPage('Manage Churches', `<table><thead><tr><th>Name</th><th>Code</th><th>Email</th><th>Subaccount</th><th>Joined</th></tr></thead><tbody>${rows}</tbody></table>`));
    });

    app.get('/admin/users', async (req, res) => {
        if (!isAuthenticated(req)) return res.redirect('/login');
        const members = await prisma.member.findMany({ take: 50, orderBy: { phone: 'desc' } });
        const rows = members.map(m => `<tr><td>${m.phone}</td><td>${m.churchCode}</td></tr>`).join('');
        res.send(renderAdminPage('Platform Users (Last 50)', `<table><thead><tr><th>Phone</th><th>Church Code</th></tr></thead><tbody>${rows}</tbody></table>`));
    });

    // Placeholders
    const wip = `<div style="background:white; padding:40px; text-align:center; border-radius:8px;"><h3>🚧 Module Under Construction</h3><p>This feature will be available in the next update.</p></div>`;
    app.get('/admin/events', (req, res) => { if (!isAuthenticated(req)) return res.redirect('/login'); res.send(renderAdminPage('Manage Events', wip)); });
    app.get('/admin/ads', (req, res) => { if (!isAuthenticated(req)) return res.redirect('/login'); res.send(renderAdminPage('Manage Ads', wip)); });
    app.get('/admin/news', (req, res) => { if (!isAuthenticated(req)) return res.redirect('/login'); res.send(renderAdminPage('Manage News', wip)); });
};