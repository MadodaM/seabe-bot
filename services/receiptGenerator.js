const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function generateReceiptPDF(transaction, church) {
    return new Promise((resolve, reject) => {
        try {
            const fileName = `Receipt_${transaction.reference}.pdf`;
            const publicDir = path.join(__dirname, '../public/receipts');
            
            if (!fs.existsSync(publicDir)) {
                fs.mkdirSync(publicDir, { recursive: true });
            }
            
            const filePath = path.join(publicDir, fileName);
            const doc = new PDFDocument({ size: 'A4', margin: 50 });
            const stream = fs.createWriteStream(filePath);
            
            doc.pipe(stream);

            doc.fillColor('#1e272e').fontSize(24).font('Helvetica-Bold').text('OFFICIAL RECEIPT', { align: 'right' });
            doc.fillColor('#14b8a6').fontSize(20).text('Seabe Pay', 50, 50);
            doc.moveDown(3);

            doc.fillColor('#2c3e50').fontSize(14).text(`Prepared For:`);
            doc.fontSize(12).text(church.name).text(`Date: ${new Date(transaction.date).toLocaleDateString('en-ZA')}`);
            doc.moveDown(2);

            const boxTop = doc.y;
            doc.rect(50, boxTop, 495, 120).fillAndStroke('#f8fafc', '#e2e8f0');
            doc.fillColor('#1e272e').text('Transaction Details', 70, boxTop + 15);
            doc.text(`Reference: ${transaction.reference}`, 70, boxTop + 40);
            doc.text(`Payer Mobile: ${transaction.phone}`, 70, boxTop + 60);
            
            doc.fillColor('#14b8a6').fontSize(14).text(`TOTAL PAID: ZAR ${transaction.amount.toFixed(2)}`, 70, boxTop + 105);

            doc.end();

            stream.on('finish', () => {
                const baseUrl = process.env.BASE_URL || 'https://seabe.tech';
                resolve(`${baseUrl}/receipts/${fileName}`);
            });

            stream.on('error', reject);
        } catch (error) {
            reject(error);
        }
    });
}

module.exports = { generateReceiptPDF };