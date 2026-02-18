const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const cloudinary = require('cloudinary').v2;
const { sendWhatsApp } = require('../services/whatsapp'); 

// 🛡️ Cloudinary Config
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// 🛡️ Upload Config
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.includes('csv') || file.originalname.endsWith('.csv')) cb(null, true);
        else cb(new Error('❌ Invalid File Type. CSV only.'));
    }
});

// --- HELPERS ---
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

// --- UI TEMPLATE ---
const renderPage = (org, activeTab, content) => {
    const isChurch = org.type === 'CHURCH';
    const navStyle = (tab) => `padding: 10px 15px; text-decoration: none; color: ${activeTab === tab ? '#000' : '#888'}; border-bottom: ${activeTab === tab ? '3px solid #00d2d3' : 'none'}; font-weight: bold; font-size: 14px;`;
    
    // Feature Toggles based on Type
    const verifyTab = !isChurch ? `<a href="/admin/${org.code}/verifications" style="${navStyle('verifications')}">🕵️ Verifications</a>` : '';
    const claimsTab = !isChurch ? `<a href="/admin/${org.code}/claims" style="${navStyle('claims')}">📑 Claims</a>` : '';
    const eventsTab = isChurch ? `<a href="/admin/${org.code}/events" style="${navStyle('events')}">📅 Events</a>` : '';

    return `<!DOCTYPE html><html><head><title>${org.name}</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:-apple-system,sans-serif;background:#f4f7f6;margin:0;padding-bottom:50px;}.header{background:white;padding:20px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;}.nav{background:white;padding:0 20px;border-bottom:1px solid #ddd;overflow-x:auto;white-space:nowrap;display:flex;}.container{padding:20px;max-width:800px;margin:0 auto;}.card{background:white;padding:20px;border-radius:10px;box-shadow:0 2px 5px rgba(0,0,0,0.05);margin-bottom:20px;}.btn{display:inline-block;padding:12px 20px;background:#1e272e;color:white;text-decoration:none;border-radius:8px;border:none;font-weight:bold;font-size:14px;width:100%;text-align:center;cursor:pointer;}.btn-del{background:#ffebeb;color:#d63031;padding:5px 10px;font-size:11px;width:auto;border-radius:4px;border:none;}.approve{background:#2ecc71;}.reject{background:#e74c3c;}.img-preview{max-width:100%;height:auto;border:1px solid #ddd;border-radius:5px;margin-top:10px;}input,select,textarea,button{box-sizing:border-box;}input,select,textarea{width:100%;padding:12px;margin-bottom:15px;border:1px solid #ddd;border-radius:6px;}label{display:block;margin-bottom:5px;font-weight:bold;font-size:12px;color:#555;text-transform:uppercase;}table{width:100%;border-collapse:collapse;}td,th{padding:12px 8px;border-bottom:1px solid #eee;font-size:14px;text-align:left;}.badge{padding:4px 8px;border-radius:4px;font-size:10px;color:white;font-weight:bold;}a{color:#0984e3;text-decoration:none;}</style></head>
    <body><div class="header"><b>${org.name} (${org.type})</b><a href="/admin/${org.code}/logout" style="color:red;font-size:12px;">Logout</a></div>
    <div class="nav">
        <a href="/admin/${org.code}/dashboard" style="${navStyle('dashboard')}">📊 Dashboard</a>
        ${verifyTab}
        <a href="/admin/${org.code}/members" style="${navStyle('members')}">👥 Members</a>
        ${claimsTab}
        ${eventsTab}
        <a href="/admin/${org.code}/team" style="${navStyle('team')}">🛡️ Team</a>
        <a href="/admin/${org.code}/ads" style="${navStyle('ads')}">📢 Ads</a>
        <a href="/admin/${org.code}/settings" style="${navStyle('settings')}">⚙️ Settings</a>
    </div><div class="container">${content}</div></body></html>`;
};

module.exports = (app, { prisma }) => {

    // --- MIDDLEWARE ---
    const checkSession = async (req, res, next) => {
        const { code } = req.params;
        const cookies = parseCookies(req);
        if (!cookies[`session_${code}`]) return res.redirect(`/admin/${code}`);
        req.org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
        if (!req.org) return res.send("Not Found");
        next();
    };

    // --- LOGIN ---
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

    // --- DASHBOARD ---
    router.get('/admin/:code/dashboard', checkSession, async (req, res) => {
        const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const tx = await prisma.transaction.findMany({ 
            where: { churchCode: req.org.code, status: 'SUCCESS', date: { gte: start } }, 
            orderBy: { id: 'desc' } 
        });
        const total = tx.reduce((s, t) => s + parseFloat(t.amount), 0);
        res.send(renderPage(req.org, 'dashboard', `<div class="card"><h3>💰 Collected (This Month)</h3><h1>R${total.toLocaleString()}</h1></div><div class="card"><h3>Recent Activity</h3><table>${tx.slice(0, 5).map(t => `<tr><td>${t.phone}</td><td>${t.type}</td><td>R${t.amount}</td></tr>`).join('')}</table></div>`));
    });

    // --- 🕵️ VERIFICATIONS (FIXED: Relaxed Search + idPhotoUrl) ---
    router.get('/admin/:code/verifications', checkSession, async (req, res) => {
        // Fetch ALL members, then filter in code to avoid DB schema errors
        const allMembers = await prisma.member.findMany({ where: { churchCode: req.params.code.toUpperCase() } });
        
        // Filter: Must have ID Photo OR ID Number (checks string length to be safe)
        const queue = allMembers.filter(m => (m.idPhotoUrl && m.idPhotoUrl.length > 5) || (m.idNumber && m.idNumber.length > 5));

        res.send(renderPage(req.org, 'verifications', `
            <div class="card"><h3>📂 Verification Queue (${queue.length})</h3>
            <table><thead><tr><th>Name</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>${queue.length > 0 ? queue.map(m => `<tr><td>${m.firstName}</td><td>${(m.idPhotoUrl && m.idPhotoUrl.length > 5) ? '📷 Photo' : '📝 Data'}</td><td><a href="/admin/${req.params.code}/member/${m.id}" class="btn" style="width:auto;padding:5px 10px;">View</a></td></tr>`).join('') : '<tr><td colspan="3">No items found.</td></tr>'}</tbody>
            </table></div>`));
    });

    // --- VERIFICATIONS ACTIONS ---
    router.post('/admin/:code/verifications/action', checkSession, async (req, res) => {
        const { memberId, action, reason } = req.body;
        const member = await prisma.member.findUnique({ where: { id: parseInt(memberId) } });

        if (member) {
            if (action === 'approve') {
                await prisma.member.update({ where: { id: member.id }, data: { isIdVerified: true, verifiedAt: new Date(), rejectionReason: null } });
                try { await sendWhatsApp(member.phone, `✅ *Verification Approved*\n\nHi ${member.firstName}, your documents have been accepted.`); } catch(e){}
            } else {
                await prisma.member.update({ where: { id: member.id }, data: { isIdVerified: false, rejectionReason: reason || "Docs unclear" } });
                try { await sendWhatsApp(member.phone, `❌ *Verification Rejected*\n\nReason: ${reason || "Documents were not clear"}.\nPlease reply '3' to re-upload.`); } catch(e){}
            }
        }
        res.redirect(`/admin/${req.org.code}/verifications`);
    });

    // --- 👤 MEMBER PROFILE (FIXED: idPhotoUrl + HTTPS) ---
    router.get('/admin/:code/member/:id', checkSession, async (req, res) => {
        const member = await prisma.member.findUnique({ where: { id: parseInt(req.params.id) } });
        if (!member) return res.send("Not Found");
        
        let photoUrl = member.idPhotoUrl || ""; // ✅ Fixed Column Name
        if (photoUrl.startsWith('http:')) photoUrl = photoUrl.replace('http:', 'https:');

        res.send(`<html><head><title>Profile</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:sans-serif;padding:20px;max-width:600px;margin:0 auto;background:#f4f4f9}.card{background:white;padding:20px;border-radius:8px;}</style></head><body>
            <div class="card"><a href="/admin/${req.params.code}/verifications">Back</a><h2>${member.firstName} ${member.lastName}</h2>
            <p>ID: ${member.idNumber || 'N/A'}</p>
            <hr>
            ${photoUrl.length > 5 ? `<a href="${photoUrl}"><img src="${photoUrl}" style="max-width:100%;border-radius:5px;"></a>` : '<p style="color:red">No Photo</p>'}
            <br><br>
            <div style="background:#f0f2f5;padding:15px;">
                <h4>Action</h4>
                <form action="/admin/${req.params.code}/verifications/action" method="POST">
                    <input type="hidden" name="memberId" value="${member.id}">
                    <button name="action" value="approve" style="background:#2ecc71;color:white;padding:10px;border:none;cursor:pointer;">✅ Approve</button>
                    <button name="action" value="reject" style="background:#e74c3c;color:white;padding:10px;border:none;cursor:pointer;">❌ Reject</button>
                </form>
            </div>
            <br><a href="/admin/${req.params.code}/members/${member.phone}/pdf" style="display:block;margin-top:10px;">📄 Download Statement (PDF)</a>
            </div></body></html>`);
    });

    // --- 📄 PDF STATEMENT (RESTORED) ---
    router.get('/admin/:code/members/:phone/pdf', checkSession, async (req, res) => {
        const m = await prisma.member.findUnique({ where: { phone: req.params.phone } }); 
        const doc = new PDFDocument();
        res.setHeader('Content-Type', 'application/pdf');
        doc.pipe(res);
        doc.fontSize(20).text(`${req.org.name}`, { align: 'center' });
        doc.fontSize(14).text(`Statement for ${m.firstName} ${m.lastName}`, { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Date: ${new Date().toDateString()}`);
        doc.end();
    });

    // --- 👥 MEMBERS LIST ---
    router.get('/admin/:code/members', checkSession, async (req, res) => {
        const { q } = req.query;
        const members = await prisma.member.findMany({ 
            where: { churchCode: req.org.code, ...(q ? { OR: [{ phone: { contains: q } }, { lastName: { contains: q, mode: 'insensitive' } }] } : {}) },
            orderBy: { lastName: 'asc' } 
        });
        const rows = members.map(m => `<tr><td><a href="/admin/${req.org.code}/member/${m.id}"><b>${m.firstName} ${m.lastName}</b></a></td><td>${m.phone}</td></tr>`).join('');
        res.send(renderPage(req.org, 'members', `<div class="card"><form><input name="q" placeholder="Search"><button class="btn">Search</button></form><br><table>${rows}</table></div>`));
    });

    // --- 🛡️ TEAM (RESTORED) ---
    router.get('/admin/:code/team', checkSession, async (req, res) => {
        try {
            const admins = await prisma.admin.findMany({ where: { churchId: req.org.id } });
            const rows = admins.map(a => `<tr><td>${a.name || 'Staff'}</td><td>${a.phone}</td></tr>`).join('');
            res.send(renderPage(req.org, 'team', `<div class="card"><h3>Invite</h3><form method="POST" action="/admin/${req.org.code}/team/add"><input name="phone" placeholder="+27..." required><button class="btn">Add</button></form><table>${rows}</table></div>`));
        } catch (e) { res.send(renderPage(req.org, 'team', `<div class="card"><h3>Team</h3><p>Not available.</p></div>`)); }
    });

    router.post('/admin/:code/team/add', checkSession, async (req, res) => {
        try { await prisma.admin.create({ data: { ...req.body, churchId: req.org.id, role: 'STAFF' } }); } catch(e){}
        res.redirect(`/admin/${req.org.code}/team`);
    });

    // --- ⚙️ SETTINGS & ADS (RESTORED) ---
    router.get('/admin/:code/settings', checkSession, (req, res) => res.send(renderPage(req.org, 'settings', `<div class="card"><h3>Settings</h3><p>${req.org.name}</p></div>`)));
    router.get('/admin/:code/ads', checkSession, (req, res) => res.send(renderPage(req.org, 'ads', `<div class="card"><h3>Ads</h3><p>Coming Soon</p></div>`)));
    router.get('/admin/:code/claims', checkSession, (req, res) => res.send(renderPage(req.org, 'claims', `<div class="card"><h3>Claims</h3><p>See Dashboard for Liability.</p></div>`)));
    
    router.get('/admin/:code/logout', (req, res) => {
        res.setHeader('Set-Cookie', `session_${req.params.code}=; Path=/; Max-Age=0`);
        res.redirect(`/admin/${req.params.code}`);
    });

    app.use('/', router);
};