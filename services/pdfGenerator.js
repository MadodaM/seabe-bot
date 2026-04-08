// services/pdfGenerator.js
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

async function generateStatement(member, transactions, org) {
    return new Promise((resolve, reject) => {
        try {
            // 1. Ensure the public/statements directory exists
            const dir = path.join(__dirname, '../public/statements');
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // 2. Setup the file name and path
            const fileName = `Statement_${member.idNumber || member.id}_${Date.now()}.pdf`;
            const filePath = path.join(dir, fileName);

            // 3. Initialize PDF Document
            const doc = new PDFDocument({ margin: 50 });
            const stream = fs.createWriteStream(filePath);
            doc.pipe(stream);

            // 4. --- DRAW THE HEADER ---
            doc.fontSize(24).font('Helvetica-Bold').text(org.name, { align: 'center' });
            doc.fontSize(10).font('Helvetica').text('Powered by Seabe Pay', { align: 'center', color: '#888888' });
            doc.moveDown(2);

            // 5. --- DRAW MEMBER DETAILS ---
            doc.fontSize(16).font('Helvetica-Bold').text('OFFICIAL STATEMENT', { underline: true });
            doc.moveDown(0.5);
            doc.fontSize(12).font('Helvetica').fillColor('#000000');
            doc.text(`Member Name: ${member.firstName} ${member.lastName}`);
            doc.text(`Phone: ${member.phone}`);
            if (member.policyNumber) doc.text(`Policy/Ref Number: ${member.policyNumber}`);
            doc.text(`Date Generated: ${new Date().toLocaleDateString('en-ZA')}`);
            doc.moveDown(2);

            // 6. --- DRAW TRANSACTION TABLE HEADER ---
            doc.font('Helvetica-Bold');
            doc.text('Date', 50, doc.y, { continued: true, width: 100 });
            doc.text('Description', 150, doc.y, { continued: true, width: 200 });
            doc.text('Amount', 350, doc.y, { align: 'right' });
            doc.moveTo(50, doc.y + 5).lineTo(550, doc.y + 5).stroke();
            doc.moveDown(1);

            // 7. --- DRAW TRANSACTIONS ---
            doc.font('Helvetica');
            let totalPaid = 0;

            if (transactions.length === 0) {
                doc.text("No successful transactions found for this period.", 50, doc.y);
            } else {
                transactions.forEach(tx => {
                    const txDate = tx.date.toLocaleDateString('en-ZA');
                    const amountStr = `R ${tx.amount.toFixed(2)}`;
                    
                    doc.text(txDate, 50, doc.y, { continued: true, width: 100 });
                    doc.text(tx.type.replace('_', ' '), 150, doc.y, { continued: true, width: 200 });
                    doc.text(amountStr, 350, doc.y, { align: 'right' });
                    
                    totalPaid += tx.amount;
                    doc.moveDown(0.5);
                });
            }

            // 8. --- DRAW TOTALS ---
            doc.moveDown(1);
            doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
            doc.moveDown(0.5);
            doc.font('Helvetica-Bold').text('Total Processed:', 150, doc.y, { continued: true, width: 200 });
            doc.text(`R ${totalPaid.toFixed(2)}`, 350, doc.y, { align: 'right' });

            // 9. Finalize the PDF
            doc.end();

            stream.on('finish', () => {
                // Return the public URL for Twilio to grab
                const hostUrl = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
                const fileUrl = `${hostUrl}/statements/${fileName}`;
                resolve(fileUrl);
            });

            stream.on('error', (err) => reject(err));

        } catch (error) {
            reject(error);
        }
    });
}

module.exports = { generateStatement };