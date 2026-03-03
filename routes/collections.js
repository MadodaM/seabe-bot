const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const cloudinary = require('cloudinary').v2;
const { sendWhatsApp } = require('../services/whatsapp'); 
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient(); // ✅ Centralized DB connection

// 🚀 FIX: Removed Paystack, replaced with Netcash
const { createPaymentLink } = require('../services/netcash'); 

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
        
        // Parse cookies
        const list = {};
        const rc = req.headers.cookie;
        rc && rc.split(';').forEach(c => { 
            const p = c.split('='); 
            if (p.length >= 2) list[p.shift().trim()] = decodeURI(p.join('=')); 
        });

        // 1. Allow global Super Admin master token (Seabe Tech Staff)
        if (list['seabe_admin_session'] === (process.env.ADMIN_SECRET || 'secret_token_123')) {
            req.org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
            return next(); 
        }

        // 2. Allow logged-in Client Dashboard users
        if (list[`session_${code}`] === 'active') {
            req.org = await prisma.church.findUnique({ where: { code: code.toUpperCase() } });
            if (req.org) return next();
        }

        // 3. Kick out anyone else
        return res.status(403).send(`<h1>🚫 Access Denied</h1><p>Your session has expired or you do not have permission. <a href='/admin/${code}'>Click here to log in.</a></p>`);
    };

    // --- UPLOAD CSV ---
    router.post('/admin/:code/collections/upload', checkAccess, upload.single('file'), (req, res) => {
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
    router.post('/admin/:code/collections/blast', checkAccess, async (req, res) => {
        
        // Find the top 10 pending debts for this organization
        const pendingDebts = await prisma.collection.findMany({
            where: { churchCode: req.params.code.toUpperCase(), status: 'PENDING' },
            take: 10 
        });

        for (const debt of pendingDebts) {
            try {
                // 💳 1. Call your new Netcash Service
                const uniqueRef = `COL-${debt.reference}-${Date.now().toString().slice(-4)}`; 
                
                // 🚀 FIX: createPaymentLink for Netcash only needs: amount, ref, phone, orgName
                let payLink = await createPaymentLink(
                    debt.amount, 
                    uniqueRef, 
                    debt.phone, 
                    req.org.name
                );
                
                // Fallback just in case Netcash API fails
                const host = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
                if (!payLink) payLink = `${host}/link/${req.params.code}`;

                // 📄 2. Generate and Upload PDF to Cloudinary
                const pdfUrl = await createAndUploadStatement({ ...debt, idNumber: null }, req.org.name);
                
                // ⏳ 3. Brief Delay for Cloudinary Propagation
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // 💬 4. The PERFECTLY formatted Meta Template
                const messageBody = `Dear ${debt.firstName},\n\nPlease find attached your outstanding statement for ${req.org.name} (Ref: ${debt.reference}).\n\n💰 Amount Due: R${debt.amount}\n\n🔒 Statement Password: Your Phone Number (last 6 digits)\n\n👉 Click here to pay securely via Netcash: ${payLink}\n\nReply "1" if you need assistance.`;
                
                // 5. Send it via WhatsApp with the PDF attached!
                await sendWhatsApp(debt.phone, messageBody, pdfUrl);

                // 6. Update the database status to match UI standards!
                await prisma.collection.update({
                    where: { id: debt.id },
                    data: { status: 'REMINDER_1' } // 🚀 FIX: Changed from 'SENT' so UI turns Yellow
                });
            } catch (error) {
                console.error(`Error processing debt for ${debt.phone}:`, error);
            }
        } 

        // Once the loop is done, go back to the dashboard
        res.redirect(`/admin/${req.params.code}/collections`);
    });

    app.use('/', router);
};