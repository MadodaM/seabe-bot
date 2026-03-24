// services/cardGenerator.js
const { createCanvas, loadImage } = require('canvas');
const cloudinary = require('cloudinary').v2;
const QRCode = require('qrcode');

async function generatePolicyCard(member, org) {
    try {
        console.log(`🎨 Generating Digital ID Card for ${member.firstName}...`);
        
        // 1. Setup the Canvas (Standard ID Card Ratio)
        const canvas = createCanvas(800, 500);
        const ctx = canvas.getContext('2d');

        // 2. Draw Background (Dark Theme)
        ctx.fillStyle = '#1e272e';
        ctx.fillRect(0, 0, 800, 500);

        // 3. Draw Header Accent (Teal)
        ctx.fillStyle = '#00d2d3';
        ctx.fillRect(0, 0, 800, 100);

        // 4. Header Text (Organization Name)
        ctx.fillStyle = '#1e272e'; // Dark text on the teal banner
        ctx.font = 'bold 40px sans-serif';
        ctx.fillText(org?.name || 'Burial Society', 40, 65);

        // 5. Title
        ctx.fillStyle = '#00d2d3';
        ctx.font = 'bold 28px sans-serif';
        ctx.fillText('DIGITAL MEMBERSHIP CARD', 40, 160);

        // 6. Draw Member Details
        const startY = 230;
        const lineSpacing = 45;

        // Labels (Gray)
        ctx.font = '22px sans-serif';
        ctx.fillStyle = '#bdc3c7';
        ctx.fillText('Member Name:', 40, startY);
        ctx.fillText('Policy Number:', 40, startY + lineSpacing);
        ctx.fillText('Contact No:', 40, startY + (lineSpacing * 2));
        ctx.fillText('Member Since:', 40, startY + (lineSpacing * 3));
        ctx.fillText('Account Status:', 40, startY + (lineSpacing * 4));

        // Values (White & Colored)
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px sans-serif';
        ctx.fillText(`${member.firstName} ${member.lastName || ''}`.trim(), 230, startY);
        
        // Dynamic Policy Number
        const policyNum = member.policyNumber || `SB-${member.phone.slice(-6)}`;
        ctx.fillText(policyNum, 230, startY + lineSpacing);
        
        const displayPhone = member.phone.startsWith('+') ? member.phone : `+${member.phone}`;
        ctx.fillText(displayPhone, 230, startY + (lineSpacing * 2));
        
        const joinYear = member.createdAt ? new Date(member.createdAt).getFullYear().toString() : new Date().getFullYear().toString();
        ctx.fillText(joinYear, 230, startY + (lineSpacing * 3));

        // Status Badge (Green for Active, Red for Pending/Lapsed)
        const isActive = member.status === 'ACTIVE';
        ctx.fillStyle = isActive ? '#2ecc71' : '#e74c3c';
        ctx.fillText(member.status ? member.status.replace(/_/g, ' ') : 'UNKNOWN', 230, startY + (lineSpacing * 4));

        // 7. 🚀 GENERATE & DRAW SCANNABLE QR CODE
        try {
            // 🚨 THE FIX: Format as a Web URL so iPhone/Android cameras recognize it instantly!
            const host = process.env.HOST_URL || 'https://seabe.tech';
            const qrData = `${host}/verify?org=${org?.code || 'N/A'}&policy=${policyNum}`;
            
            const qrDataUrl = await QRCode.toDataURL(qrData, {
                errorCorrectionLevel: 'H', 
                color: { dark: '#000000', light: '#ffffff' }, 
                width: 180,
                margin: 2 
            });
            
            const qrImage = await loadImage(qrDataUrl);
            
            // Draw white background box for QR to make it pop perfectly
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(560, 160, 200, 200);
            
            // Draw the actual QR Code
            ctx.drawImage(qrImage, 570, 170, 180, 180);
            
            // Add "Scan Me" text under QR
            ctx.fillStyle = '#bdc3c7';
            ctx.font = '16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('SCAN TO VERIFY', 660, 385);
            ctx.textAlign = 'left'; // reset text alignment for safety
        } catch (qrErr) {
            console.error("⚠️ QR Code Generation Skipped:", qrErr.message);
        }

        // 8. Footer (Watermark)
        ctx.fillStyle = '#7f8c8d';
        ctx.font = '14px sans-serif';
        ctx.fillText('Powered by Seabe Digital', 40, 460);

        // 9. Convert to Image Buffer
        const buffer = canvas.toBuffer('image/jpeg', { quality: 0.9 });

        // 10. Upload Directly to Cloudinary Stream
        return new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { 
                    folder: 'seabe_id_cards', 
                    format: 'jpg',
                    transformation: [{ width: 800, height: 500, crop: "limit" }] 
                },
                (error, result) => {
                    if (error) {
                        console.error("❌ Cloudinary Upload Error:", error);
                        reject(error);
                    } else {
                        console.log(`✅ ID Card uploaded: ${result.secure_url}`);
                        resolve(result.secure_url);
                    }
                }
            );
            stream.end(buffer);
        });

    } catch (error) {
        console.error("❌ Card Generation Failed:", error);
        return null;
    }
}

module.exports = { generatePolicyCard };