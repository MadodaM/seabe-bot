// services/paymentQrgen.js
const QRCode = require('qrcode');

/**
 * Generates a Base64 Data URL for the Organization's Payment Link
 * @param {string} orgCode - The unique organization code (e.g. AFM001)
 * @returns {Promise<string>} - Base64 Image Data URL (PNG)
 */
const generatePaymentQR = async (orgCode) => {
    try {
        // Use the dynamic HOST_URL from environment variables
        const host = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
        
        // Construct the payment link (Handled by routes/link.js)
        const targetUrl = `${host}/link/${orgCode.toUpperCase()}`;

        // Generate QR Code with high error correction and professional styling
        const qrDataUrl = await QRCode.toDataURL(targetUrl, {
            errorCorrectionLevel: 'H', // High error correction (allows for logo overlay later if needed)
            type: 'image/png',
            width: 400,
            margin: 2,
            color: {
                dark: '#2c3e50',  // Professional Navy/Dark Grey
                light: '#ffffff'  // White Background
            }
        });

        return qrDataUrl;
    } catch (err) {
        console.error("❌ QR Generation Error:", err);
        // Return a generic error image or null if generation fails
        return null; 
    }
};

module.exports = { generatePaymentQR };