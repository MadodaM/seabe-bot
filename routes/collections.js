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
    router.get('/admin/:code/collections', checkAccess, async (req, res) => {
        const prisma = new (require('@prisma/client').PrismaClient)();
        const debts = await prisma.collection.findMany({ 
            where: { churchCode: req.params.code.toUpperCase() },
            orderBy: { id: 'desc' }
        });

        const total = debts.reduce((sum, d) => sum + d.amount, 0);
        const pending = debts.filter(d => d.status === 'PENDING').length;

        res.send(`
            <html><head><title>Collections | ${req.org.name}</title><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>body{font-family:sans-serif;padding:20px;background:#f4f7f6}.card{background:white;padding:20px;border-radius:8px;box-shadow:0 2px 5px rgba(0,0,0,0.1);margin-bottom:20px}table{width:100%;border-collapse:collapse}td,th{padding:10px;border-bottom:1px solid #eee;text-align:left}.btn{padding:10px;background:#1e272e;color:white;text-decoration:none;border-radius:5px;cursor:pointer;border:none}</style>
            </head><body>
            <div class="card">
                <a href="/admin/churches">← Back to Platform</a>
                <h2>💰 Collections: ${req.org.name}</h2>
                <p>Total Outstanding: <strong>R${total.toLocaleString()}</strong></p>
                <form method="POST" action="/admin/${req.params.code}/collections/upload" enctype="multipart/form-data" style="background:#eee;padding:15px;border-radius:5px;">
                    <h4>1. Upload Debtor CSV</h4>
                    <input type="file" name="file" accept=".csv" required>
                    <button class="btn">Upload & Preview</button>
                    <br><small>Columns: Name, Phone, Amount, Reference</small>
                </form>
            </div>
            <div class="card">
                <h4>2. Campaign Queue (${pending} Pending)</h4>
                ${pending > 0 ? `<form method="POST" action="/admin/${req.params.code}/collections/blast"><button class="btn" style="background:#c0392b;width:100%">🚀 LAUNCH CAMPAIGN (SEND PDF + PAYSTACK LINK)</button></form>` : '<p>No pending messages.</p>'}
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