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
    
    const verificationTab = !isChurch ? `<a href="/admin/${org.code}/verifications" style="${navStyle('verifications')}">🕵️ Verifications</a>` : '';

    return `<!DOCTYPE html><html><head><title>${org.name}</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:-apple-system,sans-serif;background:#f4f7f6;margin:0;padding-bottom:50px;}.header{background:white;padding:20px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;}.nav{background:white;padding:0 20px;border-bottom:1px solid #ddd;overflow-x:auto;white-space:nowrap;display:flex;}.container{padding:20px;max-width:800px;margin:0 auto;}.card{background:white;padding:20px;border-radius:10px;box-shadow:0 2px 5px rgba(0,0,0,0.05);margin-bottom:20px;}.btn{display:inline-block;padding:12px 20px;background:#1e272e;color:white;text-decoration:none;border-radius:8px;border:none;font-weight:bold;font-size:14px;width:100%;text-align:center;cursor:pointer;}.btn-del{background:#ffebeb;color:#d63031;padding:5px 10px;font-size:11px;width:auto;border-radius:4px;border:none;}.approve{background:#2ecc71;}.reject{background:#e74c3c;}.img-preview{max-width:100%;height:auto;border:1px solid #ddd;border-radius:5px;margin-top:10px;}input,select,textarea,button{box-sizing:border-box;}input,select,textarea{width:100%;padding:12px;margin-bottom:15px;border:1px solid #ddd;border-radius:6px;}label{display:block;margin-bottom:5px;font-weight:bold;font-size:12px;color:#555;text-transform:uppercase;}table{width:100%;border-collapse:collapse;}td,th{padding:12px 8px;border-bottom:1px solid #eee;font-size:14px;text-align:left;}.badge{padding:4px 8px;border-radius:4px;font-size:10px;color:white;font-weight:bold;}a{color:#0984e3;text-decoration:none;}</style></head>
    <body><div class="header"><b>${org.name} (${org.type})</b><a href="/admin/${org.code}/logout" style="color:red;font-size:12px;">Logout</a></div>
    <div class="nav">
        <a href="/admin/${org.code}/dashboard" style="${navStyle('dashboard')}">📊 Dashboard</a>
        ${verificationTab}
        <a href="/admin/${org.code}/members" style="${navStyle('members')}">👥 Members</a>
        ${!isChurch ? `<a href="/admin/${org.code}/claims" style="${navStyle('claims')}">📑 Claims</a>` : ''}
        ${isChurch ? `<a href="/admin/${org.code}/events" style="${navStyle('events')}">📅 Events</a>` : ''}
        <a href="/admin/${org.code}/team" style="${navStyle('team')}">🛡️ Team</a>
        <a href="/admin/${org.code}/ads" style="${navStyle('ads')}">📢 Ads</a>
        <a href="/admin/${org.code}/settings" style="${navStyle('settings')}">⚙️ Settings</a>
    </div><div class="container">${content}</div></body></html>`;
};

// ==============================================
// 🚀 MAIN MODULE EXPORT (The Fix!)
// ==============================================
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

    // --- 🔐 AUTH (WhatsApp OTP) ---
    router.get('/admin/:code', async (req, res) => {
        const { code } = req.params;
        const { phone } = req.query; 
        const org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
        
        if (!org) return res.send("Not Found");

        // 1. Initial Login Screen
        if (!phone) {
            return res.send(`<html><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#f4f7f6;margin:0;">
                <form style="background:white;padding:30px;border-radius:10px;width:300px;box-shadow:0 10px 25px rgba(0,0,0,0.1);">
                    <h3 style="text-align:center;">🔐 ${org.name}</h3>
                    <label style="font-size:10px;color:#888;">ADMIN WHATSAPP</label>
                    <input name="phone" placeholder="+27..." required style="width:100%;padding:12px;margin-bottom:10px;border:1px solid #ddd;border-radius:5px;">
                    <button style="width:100%;padding:15px;background:#1e272e;color:white;border:none;border-radius:5px;cursor:pointer;width:100%;font-weight:bold;">Request OTP</button>
                </form></body></html>`);
        }

        // 2. Verify Admin Phone in Database
        // Note: This requires an 'Admin' table linked to 'Church'
        let admin = null;
        try {
            admin = await prisma.admin.findFirst({ where: { phone: phone.replace(/\D/g, ''), churchId: org.id } });
        } catch(e) { console.log("Admin table might not exist yet"); }

        // Fallback: Check if it's the Main Super Admin (optional)
        if (!admin) {
            // Check if phone matches the Organisation contact for fallback
             // return res.send("<h3>❌ Unauthorized Phone Number. Ask your administrator to add you.</h3>");
        }

        const otp = generateOTP();
        await prisma.church.update({ where: { id: org.id }, data: { otp, otpExpires: new Date(Date.now() + 300000) } });
        
        // Send WhatsApp
        try {
            await sendWhatsApp(phone, `🔐 *${org.name} Admin Login*\nOTP: *${otp}*`);
        } catch (e) {
            console.error("WhatsApp Send Failed:", e);
            return res.send(`Error sending OTP: ${e.message}`);
        }
        
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
        const isChurch = req.org.type === 'CHURCH';
        const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        
        const tx = await prisma.transaction.findMany({ 
            where: { churchCode: req.org.code, status: 'SUCCESS', date: { gte: start } }, 
            orderBy: { id: 'desc' } 
        });
        
        // Safe check for Claims table existence
        let cl = [];
        try {
            if (!isChurch) cl = await prisma.claim.findMany({ where: { churchCode: req.org.code, status: 'PENDING' } });
        } catch (e) {}

        let cards = '';
        if (isChurch) {
            const tithes = tx.filter(t => t.type === 'TITHE').reduce((s, t) => s + parseFloat(t.amount), 0);
            const offerings = tx.filter(t => t.type === 'OFFERING').reduce((s, t) => s + parseFloat(t.amount), 0);
            
            cards = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:15px;">
                <div class="card" style="border-left:4px solid #00b894;"><small>TITHES</small><h3>R${tithes.toLocaleString()}</h3></div>
                <div class="card" style="border-left:4px solid #0984e3;"><small>OFFERINGS</small><h3>R${offerings.toLocaleString()}</h3></div>
            </div>`;
        } else {
            const total = tx.filter(t => t.type === 'SOCIETY_PREMIUM').reduce((s, t) => s + parseFloat(t.amount), 0);
            const liability = cl.reduce((s, c) => s + parseFloat(c.payoutAmount), 0);
            cards = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
                <div class="card" style="border-left:5px solid #6c5ce7;"><small>COLLECTIONS</small><h2>R${total.toLocaleString()}</h2></div>
                <div class="card" style="border-left:5px solid #e74c3c;"><small>CLAIMS LIABILITY</small><h2>R${liability.toLocaleString()}</h2></div>
            </div>`;
        }
        res.send(renderPage(req.org, 'dashboard', cards + `<div class="card"><h3>Recent Activity</h3><table>${tx.slice(0, 5).map(t => `<tr><td>${t.phone}</td><td>${t.type}</td><td>R${t.amount}</td></tr>`).join('')}</table></div>`));
    });

    // --- 🕵️ KYC VERIFICATION QUEUE ---
    router.get('/admin/:code/verifications', checkSession, async (req, res) => {
        const { code } = req.params;
        const members = await prisma.member.findMany({
            where: { 
                churchCode: code.toUpperCase(),
                OR: [{ photoUrl: { not: null } }, { idNumber: { not: null } }]
            }
        });

        res.send(renderPage(req.org, 'verifications', `
            <div class="card">
            <h3>📂 Verification Queue</h3>
            <table>
                <thead><tr><th>Name</th><th>Phone</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>
                    ${members.map(m => `
                        <tr>
                            <td>${m.firstName} ${m.lastName}</td>
                            <td>${m.phone}</td>
                            <td>${m.photoUrl ? '📷 Photo' : '📝 Data'}</td>
                            <td><a href="/admin/${code}/member/${m.id}" class="btn" style="width:auto;padding:5px 10px;">View</a></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            </div>
        `));
    });

    // --- 👤 MEMBER PROFILE (With Cloudinary Fix) ---
    router.get('/admin/:code/member/:id', checkSession, async (req, res) => {
        const { id } = req.params;
        const member = await prisma.member.findUnique({ where: { id: parseInt(id) } });

        if (!member) return res.send("Member not found");

        let photoUrl = member.photoUrl || "";
        // Simple secure fix
        if (photoUrl && photoUrl.startsWith('http:')) photoUrl = photoUrl.replace('http:', 'https:');

        res.send(`
            <html>
            <head>
                <title>Member Profile</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body { font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; background: #f4f4f9; }
                    .container { background: white; padding: 20px; border-radius: 8px; }
                    .btn { padding: 10px; background: #ddd; text-decoration: none; border-radius: 4px; margin-right: 10px; color: #333;}
                    img { max-width: 100%; border-radius: 4px; border: 1px solid #ddd; margin-top: 10px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <a href="/admin/${req.params.code}/verifications" class="btn">← Back</a>
                    <h2>👤 ${member.firstName} ${member.lastName}</h2>
                    <p>Phone: ${member.phone}</p>
                    <p>ID: ${member.idNumber || "N/A"}</p>
                    <hr>
                    ${photoUrl 
                        ? `<a href="${photoUrl}" target="_blank"><img src="${photoUrl}"></a>` 
                        : `<p style="color:red;">❌ No ID Photo</p>`}
                    
                    <br><br>
                    <form action="/admin/${req.params.code}/member/${id}/delete" method="POST" onsubmit="return confirm('Delete?');">
                        <button style="background:red;color:white;padding:10px;border:none;border-radius:4px;">Delete Member</button>
                    </form>
                </div>
            </body>
            </html>
        `);
    });

    // --- 👥 MEMBERS LIST & CSV UPLOAD ---
    router.get('/admin/:code/members', checkSession, async (req, res) => {
        const { q } = req.query;
        const members = await prisma.member.findMany({
            where: { 
                churchCode: req.org.code,
                ...(q ? { OR: [{ phone: { contains: q } }, { lastName: { contains: q, mode: 'insensitive' } }] } : {}) 
            },
            orderBy: { lastName: 'asc' }
        });

        const rows = members.map(m => `<tr><td><a href="/admin/${req.org.code}/member/${m.id}"><b>${m.firstName} ${m.lastName}</b></a></td><td>${m.phone}</td><td><form method="POST" action="/admin/${req.org.code}/members/delete"><input type="hidden" name="id" value="${m.id}"><button class="btn-del">Delete</button></form></td></tr>`).join('');

        res.send(renderPage(req.org, 'members', `
            <div class="card">
                <form method="GET"><input name="q" value="${q || ''}" placeholder="Search..."><button class="btn">Search</button></form>
                <form method="POST" action="/admin/${req.org.code}/members/upload" enctype="multipart/form-data" style="margin-top:10px; border-top:1px solid #eee; padding-top:10px;">
                    <label>Bulk Import (CSV)</label>
                    <input type="file" name="file" accept=".csv" required>
                    <button class="btn" style="background:#0984e3;">Upload CSV</button>
                </form>
            </div>
            <div class="card"><table>${rows}</table></div>
        `));
    });

    // 🛡️ SECURE UPLOAD HANDLER
    router.post('/admin/:code/members/upload', checkSession, (req, res, next) => {
        upload.single('file')(req, res, (err) => {
            if (err) return res.send(renderPage(req.org, 'members', `<h3>❌ Upload Failed</h3><p>${err.message}</p>`));
            next();
        });
    }, async (req, res) => {
        const results = [];
        fs.createReadStream(req.file.path).pipe(csv()).on('data', (d) => results.push(d)).on('end', async () => {
            for (const r of results) {
                // Adjust field names based on your CSV columns (e.g., Name, Phone)
                try { await prisma.member.upsert({ where: { phone: r.phone || r.Phone }, update: { firstName: r.firstName || r.Name }, create: { firstName: r.firstName || r.Name, phone: r.phone || r.Phone, churchCode: req.org.code } }); } catch (e) {}
            }
            fs.unlinkSync(req.file.path);
            res.redirect(`/admin/${req.org.code}/members`);
        });
    });

    // --- OTHER ROUTES ---
    router.post('/admin/:code/members/delete', checkSession, async (req, res) => {
        await prisma.member.delete({ where: { id: parseInt(req.body.id) } });
        res.redirect(`/admin/${req.org.code}/members`);
    });

    router.get('/admin/:code/logout', (req, res) => {
        res.setHeader('Set-Cookie', `session_${req.params.code}=; Path=/; Max-Age=0`);
        res.redirect(`/admin/${req.params.code}`);
    });

    // Attach Router
    app.use('/', router);
};