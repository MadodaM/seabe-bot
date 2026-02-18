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
const PDFDocument = require('pdfkit');
const { decrypt } = require('../utils/crypto'); 
const cloudinary = require('cloudinary').v2; // 👈 ADD THIS

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
        // Only allow CSV files
        if (file.mimetype.includes('csv') || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('❌ Invalid File Type. Please upload a .CSV file.'));
        }
    }
});

// Safety check for env vars
const client = twilio(process.env.TWILIO_SID || 'AC_dummy', process.env.TWILIO_AUTH_TOKEN || 'dummy');

// --- 🛠️ HELPERS ---
// --- 🔐 CLOUDINARY SIGNER ---
const getSecureUrl = (encryptedUrl) => {
    if (!encryptedUrl) return null;
    
    // 1. Decrypt the URL stored in DB
    const rawUrl = decrypt(encryptedUrl);
    if (!rawUrl) return null;

    // 2. If it's not a Cloudinary link, just return it
    if (!rawUrl.includes('cloudinary')) return rawUrl;

    try {
        // 3. Extract the "Public ID" from the full URL
        // Example input: .../upload/v12345/folder/my-id-doc.jpg
        // We need: folder/my-id-doc
        const parts = rawUrl.split('/upload/');
        if (parts.length < 2) return rawUrl;

        let publicId = parts[1];
        // Remove version number (e.g., v1762...) if it exists
        if (publicId.startsWith('v')) {
            publicId = publicId.replace(/^v\d+\//, ''); 
        }
        // Remove file extension (e.g., .jpg, .png)
        publicId = publicId.split('.')[0];

        // 4. Generate a specialized "Signed URL" valid for 1 hour
        return cloudinary.url(publicId, {
            type: 'authenticated', // 👈 This unlocks the private file
            sign_url: true,        // 👈 This adds the signature
            secure: true,
            expires_at: Math.floor(Date.now() / 1000) + 3600 // Valid for 1 hour
        });
    } catch (e) {
        console.error("Signing Error:", e);
        return rawUrl; // Fallback
    }
};

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
    
    // 'Verifications' tab only shows for non-church orgs (Societies)
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
                <label style="font-size:10px;color:#888;">ADMIN WHATSAPP</label>
                <input name="phone" placeholder="+27..." required style="width:100%;padding:12px;margin-bottom:10px;border:1px solid #ddd;border-radius:5px;">
                <button style="width:100%;padding:15px;background:#1e272e;color:white;border:none;border-radius:5px;cursor:pointer;width:100%;font-weight:bold;">Request OTP</button>
            </form></body></html>`);
    }

    const admin = await prisma.admin.findFirst({ where: { phone, churchId: org.id } });
    if (!admin) return res.send("<h3>❌ Unauthorized Phone Number</h3>");

    const otp = generateOTP();
    await prisma.church.update({ where: { id: org.id }, data: { otp, otpExpires: new Date(Date.now() + 300000) } });
    await sendWhatsApp(phone, `🔐 *${org.name} Admin Login*\nOTP: *${otp}*`);
    
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
    const [tx, cl] = await Promise.all([
        prisma.transaction.findMany({ where: { churchCode: req.org.code, status: 'SUCCESS', date: { gte: start } }, orderBy: { id: 'desc' } }),
        !isChurch ? prisma.claim.findMany({ where: { churchCode: req.org.code, status: 'PENDING' } }) : []
    ]);

    let cards = '';
    if (isChurch) {
        const tithes = tx.filter(t => t.type === 'TITHE').reduce((s, t) => s + parseFloat(t.amount), 0);
        const offerings = tx.filter(t => t.type === 'OFFERING').reduce((s, t) => s + parseFloat(t.amount), 0);
        const tickets = tx.filter(t => t.type === 'EVENT_TICKET').reduce((s, t) => s + parseFloat(t.amount), 0);
        const pledges = tx.filter(t => ['PLEDGE', 'SEED'].includes(t.type)).reduce((s, t) => s + parseFloat(t.amount), 0);

        cards = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:15px;">
            <div class="card" style="border-left:4px solid #00b894;"><small>TITHES</small><h3>R${tithes.toLocaleString()}</h3></div>
            <div class="card" style="border-left:4px solid #0984e3;"><small>OFFERINGS</small><h3>R${offerings.toLocaleString()}</h3></div>
            <div class="card" style="border-left:4px solid #f1c40f;"><small>TICKETS</small><h3>R${tickets.toLocaleString()}</h3></div>
            <div class="card" style="border-left:4px solid #6c5ce7;"><small>PLEDGES/SEEDS</small><h3>R${pledges.toLocaleString()}</h3></div>
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

// --- 🕵️ KYC VERIFICATION QUEUE (Safe) ---
// --- 5. MEMBER PROFILE & VERIFICATION ---
    router.get('/admin/:code/member/:id', checkSession, async (req, res) => {
        const { id } = req.params;
        const member = await prisma.member.findUnique({
            where: { id: parseInt(id) }
        });

        if (!member) return res.send("Member not found");

        // 🔐 CLOUDINARY SIGNING LOGIC
        // If the URL is from Cloudinary, we might need to append a signature or transformation
        // For now, we will try to use the 'secure' HTTPS version and strict transformations
        let photoUrl = member.photoUrl || "";
        
        // If your Cloudinary is set to "Authenticated", basic URLs return 401.
        // We can try to generate a fetch-format url or just pass the raw one if public.
        // If you see 401, it usually means we need to use the API to generate a signed link.
        // But simpler fix: Ensure we don't request a restricted transformation.
        
        res.send(`
            <html>
            <head>
                <title>Member Profile</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body { font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; background: #f4f4f9; }
                    .container { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
                    .btn { display: inline-block; padding: 10px 15px; background: #ddd; color: #333; text-decoration: none; border-radius: 4px; margin-right: 10px;}
                    .btn-danger { background: #d9534f; color: white; border: none; cursor: pointer; }
                    img { max-width: 100%; border-radius: 4px; border: 1px solid #ddd; margin-top: 10px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <a href="/admin/${req.params.code}/dashboard" class="btn">← Back</a>
                    
                    <h2>👤 ${member.firstName} ${member.lastName}</h2>
                    <p><strong>Phone:</strong> ${member.phone}</p>
                    <p><strong>ID Number:</strong> ${member.idNumber || "Not provided"}</p>
                    <p><strong>Status:</strong> ${member.idNumber ? '✅ Verified' : '⚠️ Pending KYC'}</p>
                    
                    <hr>
                    <h3>🆔 Identity Document</h3>
                    ${photoUrl 
                        ? `<a href="${photoUrl}" target="_blank"><img src="${photoUrl}" alt="ID Document"></a><br><small>Click image to enlarge</small>` 
                        : `<p style="color:red;">❌ No ID Photo Uploaded</p>`}
                    
                    <br><br><br>
                    <form action="/admin/${req.params.code}/member/${id}/delete" method="POST" onsubmit="return confirm('⚠️ Are you sure? This deletes the member AND their payment history permanently.');">
                        <button class="btn btn-danger">Delete Member</button>
                    </form>
                </div>
            </body>
            </html>
        `);
    });

router.post('/admin/:code/verifications/action', checkSession, async (req, res) => {
    if (req.org.type === 'CHURCH') return res.status(403).send("Unauthorized");
    const { memberId, action, reason } = req.body;
    const member = await prisma.member.findUnique({ where: { id: parseInt(memberId) } });

    if (member) {
        if (action === 'approve') {
            await prisma.member.update({ where: { id: member.id }, data: { isIdVerified: true, verifiedAt: new Date(), rejectionReason: null } });
            await sendWhatsApp(member.phone, `✅ *Verification Approved*\n\nHi ${member.firstName}, your documents have been accepted by ${req.org.name}.`);
        } else {
            await prisma.member.update({ where: { id: member.id }, data: { isIdVerified: false, rejectionReason: reason || "Docs unclear" } });
            await sendWhatsApp(member.phone, `❌ *Verification Rejected*\n\nReason: ${reason || "Documents were not clear"}.\nPlease reply '3' to re-upload.`);
        }
    }
    res.redirect(`/admin/${req.org.code}/verifications`);
});

// --- 👥 MEMBERS ---
router.get('/admin/:code/members', checkSession, async (req, res) => {
    const isChurch = req.org.type === 'CHURCH';
    const { q } = req.query;
    const members = await prisma.member.findMany({
        where: { OR: isChurch ? [{ churchCode: req.org.code }] : [{ societyCode: req.org.code }], ...(q ? { OR: [{ phone: { contains: q } }, { lastName: { contains: q, mode: 'insensitive' } }] } : {}) },
        include: { transactions: { where: { status: 'SUCCESS', churchCode: req.org.code } } },
        orderBy: { lastName: 'asc' }
    });

    const rows = members.map(m => {
        const paid = m.transactions.reduce((s, t) => s + parseFloat(t.amount), 0);
        const reqAmt = m.monthlyPremium || 150.0;
        const statusBadge = !isChurch ? `<span class="badge" style="background:${paid >= reqAmt ? '#2ecc71' : '#e74c3c'}">${paid >= reqAmt ? 'PAID' : 'ARREARS'}</span>` : '';
        const kycBadge = m.isIdVerified ? '✅' : '⏳';
        return `<tr><td><a href="/admin/${req.org.code}/members/${m.phone}"><b>${m.firstName} ${m.lastName}</b></a></td><td>${kycBadge}</td><td>${statusBadge}</td><td>R${paid}</td><td><form method="POST" action="/admin/${req.org.code}/members/delete"><input type="hidden" name="id" value="${m.id}"><button class="btn-del">Delete</button></form></td></tr>`;
    }).join('');

    res.send(renderPage(req.org, 'members', `<div style="display:flex;justify-content:space-between;align-items:center;"><h3>👥 Members List</h3></div><div class="card"><form method="GET"><input name="q" value="${q || ''}" placeholder="Search..."><button class="btn">Search</button></form><form method="POST" action="/admin/${req.org.code}/members/upload" enctype="multipart/form-data" style="margin-top:10px;"><input type="file" name="file" accept=".csv" required><button class="btn" style="background:#0984e3;">Bulk Import (CSV Only)</button></form></div><div class="card"><table>${rows}</table></div>`));
});

// --- 🛡️ TEAM ---
router.get('/admin/:code/team', checkSession, async (req, res) => {
    const admins = await prisma.admin.findMany({ where: { churchId: req.org.id } });
    const rows = admins.map(a => `<tr><td><b>${a.name || 'Staff'}</b></td><td>${a.phone}</td><td><span class="badge" style="background:#eee;color:#333;">${a.role}</span></td></tr>`).join('');
    res.send(renderPage(req.org, 'team', `<div class="card"><h3>Invite Team Member</h3><form method="POST" action="/admin/${req.org.code}/team/add"><input name="name" placeholder="Name" required><input name="phone" placeholder="+27..." required><select name="role"><option value="STAFF">Staff</option><option value="TREASURER">Treasurer</option></select><button class="btn">Add to Team</button></form></div><div class="card"><table>${rows}</table></div>`));
});

router.post('/admin/:code/team/add', checkSession, async (req, res) => {
    await prisma.admin.create({ data: { ...req.body, churchId: req.org.id } });
    res.redirect(`/admin/${req.org.code}/team`);
});

// --- 👤 MEMBER DIRECTORY (Scoped) ---
router.get('/admin/:code/members/:phone', checkSession, async (req, res) => {
    const m = await prisma.member.findUnique({ 
        where: { phone: req.params.phone }, 
        include: { transactions: { where: { churchCode: req.org.code }, orderBy: { date: 'desc' } } } 
    });
    if (!m) return res.send("Not Found");
    res.send(renderPage(req.org, 'members', `<div class="card"><h3>👤 Profile</h3><p>${m.firstName} ${m.lastName}</p></div>`));
});

// --- 📄 PDF ---
router.get('/admin/:code/members/:phone/pdf', checkSession, async (req, res) => {
    const m = await prisma.member.findUnique({ where: { phone: req.params.phone } }); 
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);
    doc.text(`${req.org.name} Report for ${m.firstName}`);
    doc.end();
});

// --- 📑 CLAIMS ---
router.get('/admin/:code/claims', checkSession, async (req, res) => {
    const claims = await prisma.claim.findMany({ where: { churchCode: req.org.code } });
    res.send(renderPage(req.org, 'claims', `<div class="card"><h3>Claims</h3><p>Found: ${claims.length}</p></div>`));
});

// --- 📅 EVENTS ---
router.get('/admin/:code/events', checkSession, async (req, res) => {
    const events = await prisma.event.findMany({ where: { churchCode: req.org.code } });
    res.send(renderPage(req.org, 'events', `<div class="card"><h3>Events</h3><p>Found: ${events.length}</p></div>`));
});

// --- 📢 ADS, SETTINGS, UPLOAD, DELETE, LOGOUT ---
router.get('/admin/:code/ads', checkSession, async (req, res) => { res.send(renderPage(req.org, 'ads', '<h3>Ads</h3>')); });
router.get('/admin/:code/settings', checkSession, async (req, res) => { res.send(renderPage(req.org, 'settings', '<h3>Settings</h3>')); });
router.post('/admin/:code/settings/update', checkSession, async (req, res) => { res.redirect(`/admin/${req.org.code}/settings`); });

// 🛡️ SECURE UPLOAD HANDLER
router.post('/admin/:code/members/upload', checkSession, (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            // Gracefully handle "File too large" or "Wrong type"
            return res.send(renderPage(req.org, 'members', `
                <div class="card" style="border-left: 5px solid red;">
                    <h3>❌ Upload Failed</h3>
                    <p>${err.message}</p>
                    <a href="/admin/${req.params.code}/members" class="btn" style="width:auto; background:#888;">Try Again</a>
                </div>`));
        }
        next();
    });
}, async (req, res) => {
    // If we get here, file is valid CSV and < 5MB
    const results = [];
    fs.createReadStream(req.file.path).pipe(csv()).on('data', (d) => results.push(d)).on('end', async () => {
        for (const r of results) {
            try { await prisma.member.upsert({ where: { phone: r.phone }, update: { firstName: r.firstName }, create: { firstName: r.firstName, phone: r.phone, churchCode: req.org.code, status: 'ACTIVE' } }); } catch (e) {}
        }
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

module.exports = router;
module.exports = (app) => { app.use('/', router); };