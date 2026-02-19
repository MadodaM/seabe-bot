const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const cloudinary = require('cloudinary').v2;
const { sendWhatsApp } = require('../services/whatsapp'); 

// 1. Configure Uploads
const upload = multer({ dest: 'uploads/' });

// 2. Helper: Generate Payment Link
const generatePaymentLink = (amount, reference) => {
    // Replace with actual Yoco/Netcash logic later
    return `https://pay.seabe.co.za/pay?ref=${reference}&amt=${amount}`; 
};

// 3. Helper: Create & Encrypt PDF
const createAndUploadStatement = async (debtor, orgName) => {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            userPassword: debtor.idNumber || debtor.phone.slice(-6), 
            ownerPassword: process.env.ADMIN_PASSWORD || 'admin123',
            permissions: { printing: 'highResolution', copying: false, modifying: false }
        });

        // Clean Reference for Filename
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
        doc.fontSize(10).text(`* Please use the payment link sent via WhatsApp to settle immediately.`, { align: 'center', margin: 50 });
        doc.end();

        writeStream.on('finish', async () => {
            try {
                // 🛠️ FIX: Force .pdf extension in Public ID
                const result = await cloudinary.uploader.upload(pdfPath, {
                    resource_type: 'raw', 
                    folder: 'statements',
                    public_id: `stmt_${cleanRef}.pdf`, // <--- CRITICAL FIX
                    use_filename: false,
                    unique_filename: false,
                    overwrite: true,
                    type: 'upload', 
                    access_mode: 'public'
                });
                
                fs.unlinkSync(pdfPath);
                
                // Ensure HTTPS
                let secureUrl = result.secure_url;
                if (secureUrl.startsWith('http:')) secureUrl = secureUrl.replace('http:', 'https:');
                
                console.log(`📂 PDF Uploaded: ${secureUrl}`);
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

    // --- VIEW PAGE ---
    router.get('/admin/:code/collections', checkAccess, async (req, res) => {
        const prisma = new (require('@prisma/client').PrismaClient)();
        const debts = await prisma.collection.findMany({ 
            where: { churchCode: req.params.code.toUpperCase() },
            orderBy: { id: 'desc' }
        });

        const total = debts.reduce((sum, d) => sum + d.amount, 0);
        const pending = debts.filter(d => d.status === 'PENDING').length;

        res.send(`
            <html><head><title>Collections</title><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>body{font-family:sans-serif;padding:20px;background:#f4f7f6}.card{background:white;padding:20px;border-radius:8px;box-shadow:0 2px 5px rgba(0,0,0,0.1);margin-bottom:20px}table{width:100%;border-collapse:collapse}td,th{padding:10px;border-bottom:1px solid #eee;text-align:left}.btn{padding:10px;background:#1e272e;color:white;text-decoration:none;border-radius:5px;cursor:pointer;border:none}</style>
            </head><body>
            <div class="card">
                <a href="/admin/churches">← Back</a>
                <h2>💰 Collections: ${req.org.name}</h2>
                <p>Outstanding: <strong>R${total.toLocaleString()}</strong></p>
                <form method="POST" action="/admin/${req.params.code}/collections/upload" enctype="multipart/form-data" style="background:#eee;padding:15px;border-radius:5px;">
                    <h4>1. Upload CSV</h4>
                    <input type="file" name="file" accept=".csv" required>
                    <button class="btn">Upload</button>
                </form>
            </div>
            <div class="card">
                <h4>2. Queue (${pending})</h4>
                ${pending > 0 ? `<form method="POST" action="/admin/${req.params.code}/collections/blast"><button class="btn" style="background:#c0392b;width:100%">🚀 SEND MESSAGES</button></form>` : '<p>No pending items.</p>'}
                <br><table><thead><tr><th>Name</th><th>Phone</th><th>Amount</th><th>Status</th></tr></thead><tbody>${debts.map(d => `<tr><td>${d.firstName}</td><td>${d.phone}</td><td>R${d.amount}</td><td>${d.status}</td></tr>`).join('')}</tbody></table>
            </div></body></html>
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
                const cleanRef = (r.Reference || r.Ref || `INV-${Math.floor(Math.random()*10000)}`).replace(/[^a-zA-Z0-9-_]/g, '');

                if (phone && amount > 0) {
                    await prisma.collection.create({
                        data: {
                            churchCode: req.params.code.toUpperCase(),
                            firstName: name,
                            phone: phone.startsWith('0') ? '27'+phone.substring(1) : phone,
                            amount: amount,
                            reference: cleanRef,
                            status: 'PENDING'
                        }
                    });
                }
            }
            fs.unlinkSync(req.file.path);
            res.redirect(`/admin/${req.params.code}/collections`);
        });
    });

    // --- BLAST ---
    router.post('/admin/:code/collections/blast', checkAccess, async (req, res) => {
        const prisma = new (require('@prisma/client').PrismaClient)();
        const pendingDebts = await prisma.collection.findMany({
            where: { churchCode: req.params.code.toUpperCase(), status: 'PENDING' },
            take: 10
        });

        for (const debt of pendingDebts) {
            try {
                const payLink = generatePaymentLink(debt.amount, debt.reference);
                const pdfUrl = await createAndUploadStatement({ ...debt, idNumber: null }, req.org.name);
                const message = `Dear ${debt.firstName},\n\nPlease find attached your outstanding statement (Ref: ${debt.reference}).\n\n💰 *Amount Due: R${debt.amount}*\n\n🔒 *Statement Password:* Your Phone Number (last 6 digits)\n\n👉 *Click here to pay:* ${payLink}`;
                
                const success = await sendWhatsApp(debt.phone, message, pdfUrl);
                if(success) await prisma.collection.update({ where: { id: debt.id }, data: { status: 'SENT' } });
            } catch (e) { console.error("Loop Error:", e); }
        }
        res.redirect(`/admin/${req.params.code}/collections`);
    });

    app.use('/', router);
};