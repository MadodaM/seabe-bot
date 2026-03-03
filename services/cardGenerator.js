// services/cardGenerator.js
const { createCanvas } = require('canvas');
const cloudinary = require('cloudinary').v2;

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
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 40px sans-serif';
        ctx.fillText(org?.name || 'Burial Society', 40, 65);

        // 5. Title
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 30px sans-serif';
        ctx.fillText('DIGITAL MEMBERSHIP CARD', 40, 170);

        // 6. Draw Member Details
        ctx.font = '24px sans-serif';
        const startY = 250;
        const lineSpacing = 45;

        // Labels (Gray)
        ctx.fillStyle = '#bdc3c7';
        ctx.fillText('Member Name:', 40, startY);
        ctx.fillText('Policy Number:', 40, startY + lineSpacing);
        ctx.fillText('Contact No:', 40, startY + (lineSpacing * 2));
        ctx.fillText('Member Since:', 40, startY + (lineSpacing * 3));
        ctx.fillText('Account Status:', 40, startY + (lineSpacing * 4));

        // Values (White & Colored)
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px sans-serif';
        ctx.fillText(`${member.firstName} ${member.lastName}`, 250, startY);
        ctx.fillText(member.policyNumber || `SB-${member.phone.slice(-4)}`, 250, startY + lineSpacing);
        ctx.fillText(`+${member.phone}`, 250, startY + (lineSpacing * 2));
        ctx.fillText(member.joinedAt ? new Date(member.joinedAt).getFullYear().toString() : '2024', 250, startY + (lineSpacing * 3));

        // Status Badge (Green for Active, Red/Orange for Pending)
        const isActive = member.status === 'ACTIVE';
        ctx.fillStyle = isActive ? '#2ecc71' : '#e74c3c';
        ctx.fillText(member.status.replace(/_/g, ' '), 250, startY + (lineSpacing * 4));

        // 7. Convert to Image Buffer
        const buffer = canvas.toBuffer('image/jpeg');

        // 8. Upload Directly to Cloudinary (No saving to disk!)
        return new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { folder: 'seabe_id_cards', format: 'jpg' },
                (error, result) => {
                    if (error) {
                        console.error("❌ Cloudinary Upload Error:", error);
                        reject(error);
                    } else {
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