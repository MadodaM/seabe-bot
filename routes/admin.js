const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const cloudinary = require('cloudinary').v2;
const { sendWhatsApp } = require('../services/whatsapp'); 

// 🛡️ Ensure Cloudinary is Configured
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// 🛡️ SECURE UPLOAD CONFIGURATION
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 5 * 1024 * 1024 }, // Limit: 5MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.includes('csv') || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('❌ Invalid File Type. Please upload a .CSV file.'));
        }
    }
});

// --- 🛠️ HELPERS ---
const generateOTP = () => Math.floor(1000 + Math.random() * 9000).toString();

const parseCookies = (req) => {
    const list = {};
    const rc = req.headers.cookie;
    rc && rc.split(';').forEach(c => {
        const p = c.split('=');
        if (p.length >= 2) list[p.shift().trim()] = decodeURI(p.join('='));
    });
    return list;
};

// --- 🎨 UI TEMPLATE ---
const renderPage = (org, activeTab, content) => {
    const isChurch = org.type === 'CHURCH';
    const navStyle = (tab) => `padding: 10px 15px; text-decoration: none; color: ${activeTab === tab ? '#000' : '#888'}; border-bottom: ${activeTab === tab ? '3px solid #00d2d3' : 'none'}; font-weight: bold; font-size: 14px;`;
    
    // Logic: Churches don't usually need Claims, Societies do.
    const verificationTab = !isChurch ? `<a href="/admin/${org.code}/verifications" style="${navStyle('verifications')}">🕵️ Verifications</a>` : '';
    const claimsTab = !isChurch ? `<a href="/admin/${org.code}/claims" style="${navStyle('claims')}">📑 Claims</a>` : '';

    return `<!DOCTYPE html><html><head><title>${org.name}</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:-apple-system,sans-serif;background:#f4f7f6;margin:0;padding-bottom:50px;}.header{background:white;padding:20px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;}.nav{background:white;padding:0 20px;border-bottom:1px solid #ddd;overflow-x:auto;white-space:nowrap;display:flex;}.container{padding:20px;max-width:800px;margin:0 auto;}.card{background:white;padding:20px;border-radius:10px;box-shadow:0 2px 5px rgba(0,0,0,0.05);margin-bottom:20px;}.btn{display:inline-block;padding:12px 20px;background:#1e272e;color:white;text-decoration:none;border-radius:8px;border:none;font-weight:bold;font-size:14px;width:100%;text-align:center;cursor:pointer;}.btn-del{background:#ffebeb;color:#d63031;padding:5px 10px;font-size:11px;width:auto;border-radius:4px;border:none;}.approve{background:#2ecc71;}.reject{background:#e74c3c;}.img-preview{max-width:100%;height:auto;border:1px solid #ddd;border-radius:5px;margin-top:10px;}input,select,textarea,button{box-sizing:border-box;}input,select,textarea{width:100%;padding:12px;margin-bottom:15px;border:1px solid #ddd;border-radius:6px;}label{display:block;margin-bottom:5px;font-weight:bold;font-size:12px;color:#555;text-transform:uppercase;}table{width:100%;border-collapse:collapse;}td,th{padding:12px 8px;border-bottom:1px solid #eee;font-size:14px;text-align:left;}.badge{padding:4px 8px;border-radius:4px;font-size:10px;color:white;font-weight:bold;}a{color:#0984e3;text-decoration:none;}</style></head>
    <body><div class="header"><b>${org.name} (${org.type})</b><a href="/admin/${org.code}/logout" style="color:red;font-size:12px;">Logout</a></div>
    <div class="nav">
        <a href="/admin/${org.code}/dashboard" style="${navStyle('dashboard')}">📊 Dashboard</a>
        ${verificationTab}
        <a href="/admin/${org.code}/members" style="${navStyle('members')}">👥 Members</a>
        ${claimsTab}
        <a href="/admin/${org.code}/team" style="${navStyle('team')}">🛡️ Team</a>
        <a href="/admin/${org.code}/ads" style="${navStyle('ads')}">📢 Ads</a>
        <a href="/admin/${org.code}/settings" style="${navStyle('settings')}">⚙️ Settings</a>
    </div><div class="container">${content}</div></body></html>`;
};

module.exports = (app, { prisma }) => {

    // --- 🛡️ MIDDLEWARE ---
    const checkSession = async (req, res, next) => {
        const { code } = req.params;
        const cookies = parseCookies(req);
        if (!cookies[`session_${code}`]) return res.redirect(`/admin/${code}`);
        req.org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
        if (!req.org) return res.send("Not Found");
        next();
    };

    // --- 🔐 AUTH ---
    router.get('/admin/:code', async (req, res) => {
        const { code } = req.params;
        const { phone } = req.query; 
        const org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
        
        if (!org) return res.send("Not Found");
        if (!phone) {
            return res.send(`<html><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#f4f7f6;margin:0;">
                <form style="background:white;padding:30px;border-radius:10px;width:300px;box-shadow:0 10px 25px rgba(0,0,0,0.1);">
                    <h3 style="text-align:center;">🔐 ${org.name}</h3>
                    <input name="phone" placeholder="+27..." required style="width:100%;padding:12px;margin-bottom:10px;border:1px solid #ddd;border-radius:5px;">
                    <button style="width:100%;padding:15px;background:#1e272e;color:white;border:none;border-radius:5px;cursor:pointer;width:100%;font-weight:bold;">Request OTP</button>
                </form></body></html>`);
        }
        const otp = generateOTP();
        await prisma.church.update({ where: { id: org.id }, data: { otp, otpExpires: new Date(Date.now() + 300000) } });
        try { await sendWhatsApp(phone, `🔐 *${org.name} Admin Login*\nOTP: *${otp}*`); } catch (e) {}
        res.send(`<html><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#f4f7f6;margin:0;">
            <form action="/admin/${code}/verify" method="POST" style="background:white;padding:30px;border-radius:10px;width:300px;box-shadow:0 10px 25px rgba(0,0,0,0.1);">
                <input type="hidden" name="phone" value="${phone}">
                <h3 style="text-align:center;">Enter OTP</h3>
                <input name="otp" maxlength="4" style="font-size:28px;text-align:center;width:100%;padding:10px;border:1px solid #ddd;" required autofocus>
                <button style="width:100%;padding:15px;background:#1e272e;color:white;border:none;border-radius:5px;margin-top:15px;cursor:pointer;width:100%;">Verify</button>
            </form></body></html>`);
    });

    router.post('/admin/:code/verify', async (req, res) => {
        const org = await prisma.church.findUnique({ where: { code: req.params.code.toUpperCase() } });
        if (!org || org.otp !== req.body.otp) return res.send("Invalid OTP");
        res.setHeader('Set-Cookie', `session_${org.code}=active; HttpOnly; Path=/; Max-Age=3600`);
        res.redirect(`/admin/${org.code}/dashboard`);
    });

    // --- 📊 DASHBOARD ---
    router.get('/admin/:code/dashboard', checkSession, async (req, res) => {
        const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const tx = await prisma.transaction.findMany({ 
            where: { churchCode: req.org.code, status: 'SUCCESS', date: { gte: start } }, 
            orderBy: { id: 'desc' } 
        });
        const total = tx.reduce((s, t) => s + parseFloat(t.amount), 0);
        res.send(renderPage(req.org, 'dashboard', `<div class="card"><h3>💰 Total Collected</h3><h1>R${total.toLocaleString()}</h1></div><div class="card"><h3>Recent Activity</h3><table>${tx.slice(0, 5).map(t => `<tr><td>${t.phone}</td><td>R${t.amount}</td></tr>`).join('')}</table></div>`));
    });

    // --- 🕵️ VERIFICATIONS (Relaxed Fix) ---
    router.get('/admin/:code/verifications', checkSession, async (req, res) => {
        const allMembers = await prisma.member.findMany({ where: { churchCode: req.params.code.toUpperCase() } });
        const queue = allMembers.filter(m => (m.idPhotoUrl && m.idPhotoUrl.length > 5) || (m.idNumber && m.idNumber.length > 5));
        
        res.send(renderPage(req.org, 'verifications', `
            <div class="card"><h3>📂 Verification Queue (${queue.length})</h3>
            <table><thead><tr><th>Name</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>${queue.map(m => `<tr><td>${m.firstName}</td><td>${m.idPhotoUrl ? '📷' : '📝'}</td><td><a href="/admin/${req.params.code}/member/${m.id}" class="btn" style="width:auto;padding:5px 10px;">View</a></td></tr>`).join('')}</tbody>
            </table></div>`));
    });

    // --- 👤 MEMBER PROFILE ---
    router.get('/admin/:code/member/:id', checkSession, async (req, res) => {
        const member = await prisma.member.findUnique({ where: { id: parseInt(req.params.id) } });
        if (!member) return res.send("Not Found");
        let photoUrl = member.idPhotoUrl || "";
        if (photoUrl.startsWith('http:')) photoUrl = photoUrl.replace('http:', 'https:');

        res.send(`<html><head><title>Profile</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="padding:20px;font-family:sans-serif;">
            <a href="/admin/${req.params.code}/verifications">Back</a><h2>${member.firstName} ${member.lastName}</h2>
            <p>ID: ${member.idNumber || 'N/A'}</p>
            ${photoUrl ? `<a href="${photoUrl}"><img src="${photoUrl}" style="max-width:100%;border:1px solid #ddd;"></a>` : '<p>No Photo</p>'}
        </body></html>`);
    });

    // --- 👥 MEMBERS LIST ---
    router.get('/admin/:code/members', checkSession, async (req, res) => {
        const members = await prisma.member.findMany({ where: { churchCode: req.org.code }, orderBy: { lastName: 'asc' } });
        const rows = members.map(m => `<tr><td><a href="/admin/${req.org.code}/member/${m.id}"><b>${m.firstName} ${m.lastName}</b></a></td><td>${m.phone}</td></tr>`).join('');
        res.send(renderPage(req.org, 'members', `<div class="card"><h3>👥 Members</h3><table>${rows}</table></div>`));
    });

    // --- 📑 CLAIMS (RESTORED) ---
    router.get('/admin/:code/claims', checkSession, async (req, res) => {
        // Try/Catch in case Claim table is not migrated yet
        try {
            const claims = await prisma.claim.findMany({ where: { churchCode: req.org.code } });
            res.send(renderPage(req.org, 'claims', `<div class="card"><h3>📑 Claims</h3><p>Found: ${claims.length}</p></div>`));
        } catch (e) {
            res.send(renderPage(req.org, 'claims', `<div class="card"><h3>📑 Claims</h3><p>No claims system configured yet.</p></div>`));
        }
    });

    // --- 🛡️ TEAM (RESTORED) ---
    router.get('/admin/:code/team', checkSession, async (req, res) => {
        try {
            const admins = await prisma.admin.findMany({ where: { churchId: req.org.id } });
            const rows = admins.map(a => `<tr><td>${a.name || 'Staff'}</td><td>${a.phone}</td></tr>`).join('');
            res.send(renderPage(req.org, 'team', `<div class="card"><h3>🛡️ Team</h3><p>Add admin via WhatsApp.</p><table>${rows}</table></div>`));
        } catch (e) {
            res.send(renderPage(req.org, 'team', `<div class="card"><h3>🛡️ Team</h3><p>Team management unavailable.</p></div>`));
        }
    });

    // --- ⚙️ SETTINGS (RESTORED) ---
    router.get('/admin/:code/settings', checkSession, async (req, res) => {
        res.send(renderPage(req.org, 'settings', `
            <div class="card">
                <h3>⚙️ Settings</h3>
                <p><strong>Organization Name:</strong> ${req.org.name}</p>
                <p><strong>Code:</strong> ${req.org.code}</p>
                <p><strong>Type:</strong> ${req.org.type}</p>
            </div>
        `));
    });

    // --- 📢 ADS (RESTORED) ---
    router.get('/admin/:code/ads', checkSession, async (req, res) => {
        res.send(renderPage(req.org, 'ads', `<div class="card"><h3>📢 Ads</h3><p>Ad Management coming soon.</p></div>`));
    });

    // --- UPLOAD HANDLER ---
    router.post('/admin/:code/members/upload', checkSession, (req, res, next) => {
        upload.single('file')(req, res, (err) => { if (err) return res.send(err.message); next(); });
    }, async (req, res) => {
        const results = [];
        fs.createReadStream(req.file.path).pipe(csv()).on('data', (d) => results.push(d)).on('end', async () => {
            for (const r of results) { try { await prisma.member.upsert({ where: { phone: r.phone }, update: { firstName: r.firstName }, create: { firstName: r.firstName, phone: r.phone, churchCode: req.org.code } }); } catch (e) {} }
            fs.unlinkSync(req.file.path);
            res.redirect(`/admin/${req.org.code}/members`);
        });
    });

    router.post('/admin/:code/members/delete', checkSession, async (req, res) => {
        await prisma.member.delete({ where: { id: parseInt(req.body.id) } });
        res.redirect(`/admin/${req.org.code}/members`);
    });

    router.get('/admin/:code/logout', (req, res) => {
        res.setHeader('Set-Cookie', `session_${req.params.code}=; Path=/; Max-Age=0`);
        res.redirect(`/admin/${req.params.code}`);
    });

    app.use('/', router);
};