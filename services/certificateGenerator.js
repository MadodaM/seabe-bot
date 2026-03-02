const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

async function generateCertificate(memberName, courseName) {
    try {
        // 1. Ensure the certificates directory exists
        const certDir = path.join(__dirname, '..', 'public', 'certificates');
        if (!fs.existsSync(certDir)) {
            fs.mkdirSync(certDir, { recursive: true });
        }

        // 2. Set up the Canvas (Standard A4 Landscape Size)
        const width = 1123;
        const height = 794;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // 3. Create a clean, elegant background 
        // (You can replace this with a real image later using loadImage!)
        ctx.fillStyle = '#f8f9fa'; // Off-white
        ctx.fillRect(0, 0, width, height);

        // Draw a decorative border
        ctx.strokeStyle = '#0d6efd'; // Seabe Blue
        ctx.lineWidth = 15;
        ctx.strokeRect(30, 30, width - 60, height - 60);
        ctx.strokeStyle = '#ffc107'; // Gold inner border
        ctx.lineWidth = 5;
        ctx.strokeRect(45, 45, width - 90, height - 90);

        // 4. Add the Text
        ctx.textAlign = 'center';
        
        ctx.fillStyle = '#212529';
        ctx.font = 'bold 50px Arial';
        ctx.fillText('CERTIFICATE OF COMPLETION', width / 2, 200);

        ctx.font = 'italic 30px Arial';
        ctx.fillText('This proudly certifies that', width / 2, 300);

        // Student Name
        ctx.fillStyle = '#0d6efd';
        ctx.font = 'bold 60px "Times New Roman"';
        ctx.fillText(memberName.toUpperCase(), width / 2, 400);

        ctx.fillStyle = '#212529';
        ctx.font = '30px Arial';
        ctx.fillText('has successfully completed the course:', width / 2, 500);

        // Course Name
        ctx.fillStyle = '#198754'; // Gold/Green
        ctx.font = 'bold 45px Arial';
        ctx.fillText(courseName, width / 2, 600);

        // Date
        const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        ctx.fillStyle = '#6c757d';
        ctx.font = '20px Arial';
        ctx.fillText(`Awarded on ${dateStr} by Seabe Learning`, width / 2, 700);

        // 5. Save the image to the disk
        const fileName = `cert_${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`;
        const filePath = path.join(certDir, fileName);
        
        const buffer = canvas.toBuffer('image/jpeg');
        fs.writeFileSync(filePath, buffer);

        // 6. Return the public URL for Twilio
        const host = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
        return `${host}/public/certificates/${fileName}`;

    } catch (error) {
        console.error("❌ Certificate Generation Error:", error);
        return null; // Fails safely
    }
}

module.exports = { generateCertificate };