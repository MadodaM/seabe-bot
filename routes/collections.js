const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const cloudinary = require('cloudinary').v2;
const { sendWhatsApp } = require('../services/whatsapp'); // Ensure this supports media
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 1. Configure Uploads
const upload = multer({ dest: 'uploads/' });

// 2. Helper: Generate Payment Link (Placeholder for Yoco/Netcash/PayFast)
const generatePaymentLink = (amount, reference) => {
    // Replace this with your actual Payment Gateway Logic
    // Example: https://pay.yoco.com/your-business?amount=${amount}&ref=${reference}
    return `https://pay.seabe.co.za/pay?ref=${reference}&amt=${amount}`; 
};

// 3. Helper: Create & Encrypt PDF, Upload to Cloudinary
const createAndUploadStatement = async (debtor, orgName) => {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            // 🔐 ENCRYPTION: User must enter their ID/Phone to open
            userPassword: debtor.idNumber || debtor.phone.slice(-6), 
            ownerPassword: process.env.ADMIN_PASSWORD || 'admin123',
            permissions: { printing: 'highResolution', copying: false, modifying: false }
        });

        const pdfPath = `uploads/statement_${debtor.reference}.pdf`;
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
                // Upload to Cloudinary so WhatsApp can access it
                const result = await cloudinary.uploader.upload(pdfPath, {
                    resource_type: 'raw', // Important for PDFs
                    folder: 'statements',
                    use_filename: true
                });
                
                // Cleanup local file
                fs.unlinkSync(pdfPath);
                resolve(result.secure_url);
            } catch (e) {
                reject(e);
            }
        });
    });
};

module.exports = (app) => {

    // --- A. VIEW CAMPAIGN PAGE ---
    router.get('/admin/:code/collections', async (req, res) => {
        const { code } = req.params;
        const debts = await prisma.collection.findMany({ 
            where: { churchCode: code.toUpperCase() },
            orderBy: { id: 'desc' }
        });

        // Calculate Stats
        const total = debts.reduce((sum, d) => sum + d.amount, 0);
        const pending = debts.filter(d => d.status === 'PENDING').length;

        res.send(`
            <html><head><title>Collections</title><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>body{font-family:sans-serif;padding:20px;background:#f4f7f6}.card{background:white;padding:20px;border-radius:8px;box-shadow:0 2px 5px rgba(0,0,0,0.1);margin-bottom:20px}table{width:100%;border-collapse:collapse}td,th{padding:10px;border-bottom:1px solid #eee;text-align:left}.btn{padding:10px;background:#1e272e;color:white;text-decoration:none;border-radius:5px;cursor:pointer;border:none}</style>
            </head><body>
            <div class="card">
                <a href="/admin/${code}/dashboard">← Back</a>
                <h2>💰 Early Collections Campaign</h2>
                <p>Total Outstanding: <strong>R${total.toLocaleString()}</strong></p>
                
                <form method="POST" action="/admin/${code}/collections/upload" enctype="multipart/form-data" style="background:#eee;padding:15px;border-radius:5px;">
                    <h4>1. Upload Debtor CSV</h4>
                    <input type="file" name="file" accept=".csv" required>
                    <button class="btn">Upload & Preview</button>
                    <br><small>Columns: Name, Phone, Amount, Reference, IDNumber (Optional)</small>
                </form>
            </div>

            <div class="card">
                <h4>Campaign Queue (${pending} Pending)</h4>
                ${pending > 0 ? `<form method="POST" action="/admin/${code}/collections/blast"><button class="btn" style="background:#c0392b;width:100%">🚀 LAUNCH CAMPAIGN (SEND WHATSAPP)</button></form>` : ''}
                <br>
                <table>
                    <thead><tr><th>Name</th><th>Phone</th><th>Amount</th><th>Status</th></tr></thead>
                    <tbody>
                        ${debts.map(d => `<tr><td>${d.firstName}</td><td>${d.phone}</td><td>R${d.amount}</td><td>${d.status}</td></tr>`).join('')}
                    </tbody>
                </table>
            </div>
            </body></html>
        `);
    });

    // --- B. UPLOAD CSV ---
    router.post('/admin/:code/collections/upload', upload.single('file'), (req, res) => {
        const results = [];
        fs.createReadStream(req.file.path).pipe(csv()).on('data', (data) => results.push(data)).on('end', async () => {
            for (const r of results) {
                // Map CSV Columns (Flexible)
                const phone = (r.Phone || r.Mobile || '').replace(/\D/g, '');
                const amount = parseFloat(r.Amount || r.Balance || 0);
                const name = r.Name || r.FirstName;
                const ref = r.Reference || r.Ref || `INV-${Math.floor(Math.random()*10000)}`;

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

    // --- C. BLAST CAMPAIGN (The Magic) ---
    router.post('/admin/:code/collections/blast', async (req, res) => {
        const { code } = req.params;
        
        // 1. Get Pending Debts
        const pendingDebts = await prisma.collection.findMany({
            where: { churchCode: code.toUpperCase(), status: 'PENDING' },
            take: 50 // Process in batches to avoid timeout
        });

        // 2. Loop and Send
        for (const debt of pendingDebts) {
            try {
                // A. Generate Payment Link
                const payLink = generatePaymentLink(debt.amount, debt.reference);

                // B. Generate & Encrypt PDF
                // We mock an ID number if not in DB (Use phone as password fallback)
                const pdfUrl = await createAndUploadStatement({ ...debt, idNumber: null }, "Medical Practice");

                // C. Send WhatsApp with Media
                const message = `Dear ${debt.firstName},\n\nPlease find attached your outstanding statement (Ref: ${debt.reference}).\n\n💰 *Amount Due: R${debt.amount}*\n\n🔒 *Statement Password:* Your Phone Number (last 6 digits)\n\n👉 *Click here to pay securely:* ${payLink}`;
                
                // Assuming your sendWhatsApp service handles mediaUrl as 3rd argument
                // If not, we need to update services/whatsapp.js
                await sendWhatsApp(debt.phone, message, pdfUrl);

                // D. Update Status
                await prisma.collection.update({
                    where: { id: debt.id },
                    data: { status: 'SENT' }
                });

            } catch (e) {
                console.error(`Failed to send to ${debt.phone}:`, e);
            }
        }

        res.redirect(`/admin/${code}/collections`);
    });

    app.use('/', router);
};