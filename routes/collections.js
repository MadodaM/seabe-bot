const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const cloudinary = require('cloudinary').v2;
const { sendWhatsApp } = require('../services/whatsapp'); 
const { createPaymentLink } = require('../services/paystack'); // 🔗 IMPORT EXISTING PAYSTACK LOGIC

// 1. Configure Uploads
const upload = multer({ dest: 'uploads/' });

// 2. Helper: Create & Encrypt PDF
const createAndUploadStatement = async (debtor, orgName) => {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            userPassword: debtor.idNumber || debtor.phone.slice(-6), 
            ownerPassword: process.env.ADMIN_PASSWORD || 'admin123',
            permissions: { printing: 'highResolution', copying: false, modifying: false }
        });

        const cleanRef = debtor.reference.replace(/[^a-zA-Z0-9-_]/g, '');
        const pdfPath = `uploads/statement_${cleanRef}.pdf`;
        
        const writeStream = fs.createWriteStream(pdfPath);
        doc.pipe(writeStream);

        // PDF Content
        doc.fontSize(20).text(`${orgName} - Outstanding Account`, { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Date: ${new Date().toDateString()}`);
        doc.text(`Reference: ${debtor.reference}`);
        doc.moveDown();
        doc.text(`Dear ${debtor.firstName},`);
        doc.text(`This is a reminder of your outstanding balance.`);
        doc.moveDown();
        doc.fontSize(16).text(`Amount Due: R${debtor.amount.toFixed(2)}`, { align: 'right' });
        doc.fontSize(10).text(`* Please use the secure payment link sent via WhatsApp to settle immediately.`, { align: 'center', margin: 50 });
        doc.end();

        writeStream.on('finish', async () => {
            try {
                const result = await cloudinary.uploader.upload(pdfPath, {
                    resource_type: 'raw', 
                    folder: 'statements',
                    public_id: `stmt_${cleanRef}.pdf`,
                    use_filename: false,
                    unique_filename: false,
                    overwrite: true,
                    type: 'upload', 
                    access_mode: 'public'
                });
                
                fs.unlinkSync(pdfPath);
                let secureUrl = result.secure_url;
                if (secureUrl.startsWith('http:')) secureUrl = secureUrl.replace('http:', 'https:');
                resolve(secureUrl);
            } catch (e) {
                console.error("Cloudinary Upload Error:", e);
                reject(e);
            }
        });
    });
};

module.exports = (app) => {
    // 🛡️ SECURITY MIDDLEWARE
    const checkAccess = async (req, res, next) => {
        const { code } = req.params;
        const prisma = new (require('@prisma/client').PrismaClient)();
        
        const list = {}, rc = req.headers.cookie;
        rc && rc.split(';').forEach(c => { const p = c.split('='); list[p.shift().trim()] = decodeURI(p.join('=')); });

        if (list['seabe_admin_session'] === (process.env.ADMIN_SECRET || 'secret_token_123')) {
            req.org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
            return next(); 
        }

        const phoneCookie = list[`phone_${code}`];
        if (phoneCookie) {
            const org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
            const admin = await prisma.admin.findFirst({ where: { phone: phoneCookie, churchId: org.id } });
            
            if (admin && admin.role === 'SUPER_ADMIN') {
                req.org = org;
                return next(); 
            }
        }
        return res.status(403).send("<h1>🚫 Access Denied</h1><p>You must be a Super Admin to access Collections.</p>");
    };

    // --- VIEW CAMPAIGN PAGE ---
    // --- VIEW CAMPAIGN PAGE (CLIENT-FACING UI) ---
    router.get('/admin/:code/collections', checkAccess, async (req, res) => {
        const prisma = new (require('@prisma/client').PrismaClient)();
        
        // Check if this is the Platform Admin so we can give them a back button
        const list = {}, rc = req.headers.cookie;
        rc && rc.split(';').forEach(c => { const p = c.split('='); list[p.shift().trim()] = decodeURI(p.join('=')); });
        const isPlatformAdmin = list['seabe_admin_session'] === (process.env.ADMIN_SECRET || 'secret_token_123');

        const debts = await prisma.collection.findMany({ 
            where: { churchCode: req.params.code.toUpperCase() },
            orderBy: { id: 'desc' }
        });

        const total = debts.reduce((sum, d) => sum + d.amount, 0);
        const pending = debts.filter(d => d.status === 'PENDING').length;

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Revenue Recovery | ${req.org.name}</title>
                <meta name="viewport" content="width=device-width,initial-scale=1">
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: #f4f7f6; margin: 0; display: flex; color: #333; }
                    /* Client Sidebar */
                    .sidebar { width: 250px; background: #2d3436; color: white; min-height: 100vh; padding: 20px; box-sizing: border-box; position: fixed; }
                    .sidebar h2 { color: #00d2d3; margin-top: 0; font-size: 18px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px; }
                    .sidebar a { display: block; color: #ccc; text-decoration: none; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05); transition: 0.2s; }
                    .sidebar a:hover { color: #00d2d3; padding-left: 5px; }
                    .active-tab { color: #00d2d3 !important; font-weight: bold; border-left: 3px solid #00d2d3; padding-left: 10px !important; }
                    
                    /* Main Content */
                    .main { margin-left: 250px; flex: 1; padding: 40px; }
                    .card { background: white; padding: 25px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.05); margin-bottom: 25px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
                    th { background: #f0f2f5; padding: 12px; text-align: left; font-size: 13px; text-transform: uppercase; color: #636e72; }
                    td { padding: 12px; border-bottom: 1px solid #eee; font-size: 14px; }
                    .btn { padding: 10px 15px; background: #00d2d3; color: #2d3436; font-weight: bold; border: none; border-radius: 4px; cursor: pointer; transition: 0.2s; }
                    .btn:hover { background: #00b894; color: white; }
                    .btn-danger { background: #d63031; color: white; width: 100%; font-size: 16px; padding: 15px; }
                    .btn-danger:hover { background: #c0392b; }
                    .status-pending { color: #e67e22; font-weight: bold; }
                    .status-sent { color: #27ae60; font-weight: bold; }
                </style>
            </head>
            <body>
                <div class="sidebar">
                    <h2>${req.org.name}</h2>
                    <a href="/admin/${req.params.code}">📊 Dashboard</a>
                    <a href="/admin/${req.params.code}/members">👥 Directory</a>
                    <a href="/admin/${req.params.code}/collections" class="active-tab">💰 Revenue Recovery</a>
                    <br><br>
                    <a href="/admin/${req.params.code}/logout" style="color:#ff7675;">🚪 Logout</a>
                </div>
                
                <div class="main">
                    ${isPlatformAdmin ? `<a href="/admin/churches" style="display:inline-block; margin-bottom:20px; color:#636e72; text-decoration:none;">⬅ Back to Super Admin Platform</a>` : ''}
                    
                    <h1 style="margin-top:0;">Revenue Recovery Engine</h1>
                    <p style="color:#636e72;">Upload your outstanding invoices and automate your collections via WhatsApp.</p>
                    
                    <div style="display:grid; grid-template-columns: 1fr 2fr; gap: 20px;">
                        <div class="card">
                            <h3 style="margin-top:0;">1. Upload Debtor CSV</h3>
                            <form method="POST" action="/admin/${req.params.code}/collections/upload" enctype="multipart/form-data">
                                <div style="border: 2px dashed #ddd; padding: 20px; text-align: center; border-radius: 5px; margin-bottom: 15px; background: #fafafa;">
                                    <input type="file" name="file" accept=".csv" required style="width: 100%;">
                                </div>
                                <button class="btn" style="width: 100%;">Upload Data</button>
                                <p style="font-size: 12px; color: #999; margin-top: 10px;">Required columns: Name, Phone, Amount, Reference</p>
                            </form>
                        </div>

                        <div class="card" style="display: flex; flex-direction: column; justify-content: center; align-items: center; background: #2d3436; color: white;">
                            <h4 style="margin:0; color: #b2bec3; text-transform: uppercase; letter-spacing: 1px;">Total Outstanding</h4>
                            <h2 style="font-size: 3rem; margin: 10px 0; color: #00d2d3;">R${total.toLocaleString()}</h2>
                            <p style="margin:0;">Pending Messages: <strong>${pending}</strong></p>
                        </div>
                    </div>

                    <div class="card">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <h3 style="margin:0;">2. Campaign Queue</h3>
                            ${pending > 0 ? `<form method="POST" action="/admin/${req.params.code}/collections/blast" style="margin:0;"><button class="btn btn-danger">🚀 LAUNCH CAMPAIGN</button></form>` : '<span style="color:#999;">Queue is empty</span>'}
                        </div>
                        
                        <table>
                            <thead><tr><th>Debtor Name</th><th>WhatsApp Number</th><th>Amount Due</th><th>Status</th></tr></thead>
                            <tbody>
                                ${debts.map(d => `
                                <tr>
                                    <td><strong>${d.firstName}</strong><br><small style="color:#999;">Ref: ${d.reference}</small></td>
                                    <td>${d.phone}</td>
                                    <td><strong>R${d.amount.toFixed(2)}</strong></td>
                                    <td class="${d.status === 'PENDING' ? 'status-pending' : 'status-sent'}">${d.status}</td>
                                </tr>`).join('')}
                                ${debts.length === 0 ? '<tr><td colspan="4" style="text-align:center; padding:30px; color:#999;">No active debtors found. Upload a CSV to begin.</td></tr>' : ''}
                            </tbody>
                        </table>
                    </div>
                </div>
            </body>
            </html>
        `);
    });

    // --- UPLOAD CSV ---
    router.post('/admin/:code/collections/upload', checkAccess, upload.single('file'), (req, res) => {
        const prisma = new (require('@prisma/client').PrismaClient)();
        const results = [];
        fs.createReadStream(req.file.path).pipe(csv()).on('data', (data) => results.push(data)).on('end', async () => {
            for (const r of results) {
                const phone = (r.Phone || r.Mobile || '').replace(/\D/g, '');
                const amount = parseFloat(r.Amount || r.Balance || 0);
                const name = r.Name || r.FirstName;
                const rawRef = r.Reference || r.Ref || `INV-${Math.floor(Math.random()*10000)}`;
                const ref = rawRef.replace(/[^a-zA-Z0-9-_]/g, '');

                if (phone && amount > 0) {
                    await prisma.collection.create({
                        data: {
                            churchCode: req.params.code.toUpperCase(),
                            firstName: name,
                            phone: phone.startsWith('0') ? '27'+phone.substring(1) : phone,
                            amount: amount,
                            reference: ref,
                            status: 'PENDING'
                        }
                    });
                }
            }
            fs.unlinkSync(req.file.path);
            res.redirect(`/admin/${req.params.code}/collections`);
        });
    });

    // --- BLAST CAMPAIGN ---
    // --- BLAST CAMPAIGN ---
    router.post('/admin/:code/collections/blast', checkAccess, async (req, res) => {
        const prisma = new (require('@prisma/client').PrismaClient)();
        const pendingDebts = await prisma.collection.findMany({
            where: { churchCode: req.params.code.toUpperCase(), status: 'PENDING' },
            take: 10 
        });

        for (const debt of pendingDebts) {
            try {
                // 💳 1. Call your existing Paystack Service
                const email = debt.email || `${debt.phone}@seabe.co.za`; 
                const uniqueRef = `COL_${debt.reference}_${Date.now()}`; 
                
                let payLink = await createPaymentLink(
                    debt.amount, 
                    uniqueRef, 
                    email, 
                    req.org.subaccountCode, 
                    debt.phone, 
                    req.org.name
                );
                
                // Fallback just in case Paystack API fails
                if (!payLink) payLink = `https://pay.seabe.co.za/pay?ref=${uniqueRef}&amt=${debt.amount}`;

                // 📄 2. Generate PDF
                const pdfUrl = await createAndUploadStatement({ ...debt, idNumber: null }, req.org.name);
                
                // ⏳ 3. Brief Delay for Cloudinary Propagation
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // 💬 4. Send Message (UPDATED WITH ORG NAME)
                const message = `Dear ${debt.firstName},\n\nPlease find attached your outstanding statement for *${req.org.name}* (Ref: ${debt.reference}).\n\n💰 *Amount Due: R${debt.amount}*\n\n🔒 *Statement Password:* Your Phone Number (last 6 digits)\n\n👉 *Click here to pay securely via Paystack:* \n${payLink}`;
                
                const success = await sendWhatsApp(debt.phone, message, pdfUrl);
                
                if (success) {
                    await prisma.collection.update({ where: { id: debt.id }, data: { status: 'SENT' } });
                }

            } catch (e) { console.error("Loop Error:", e); }
        }
        res.redirect(`/admin/${req.params.code}/collections`);
    });

    app.use('/', router);
};