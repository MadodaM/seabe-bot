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