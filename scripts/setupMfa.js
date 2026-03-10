// scripts/setupMfa.js
// Generates a secure TOTP secret and QR code for Super Admin MFA
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const fs = require('fs');

console.log("\n🔒 INITIATING MFA VAULT SETUP...");

// 1. Generate a secure, 32-character base32 secret
const secret = speakeasy.generateSecret({
    name: 'Seabe Digital (Super Admin)'
});

// 2. Generate the QR Code image URL
qrcode.toDataURL(secret.otpauth_url, (err, data_url) => {
    if (err) {
        console.error("❌ QR Code Generation Failed", err);
        return;
    }

    // 3. Create a temporary HTML file to display the QR code
    const html = `
        <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
            <h2>📱 Scan this with Google Authenticator or Authy</h2>
            <img src="${data_url}" style="width: 250px; height: 250px; border: 5px solid #1e272e; border-radius: 10px;">
            <p style="font-size: 18px; color: #c0392b;"><strong>IMPORTANT:</strong> Save this secret in your .env file!</p>
            <div style="background: #eee; padding: 15px; display: inline-block; font-family: monospace; font-size: 20px; font-weight: bold; letter-spacing: 2px;">
                ADMIN_TOTP_SECRET=${secret.base32}
            </div>
            <p>Once you save it to your .env (and Render Environment Variables), delete this file.</p>
        </div>
    `;

    fs.writeFileSync('mfa-setup.html', html);
    
    console.log(`✅ Success! Your Vault Key is: ${secret.base32}`);
    console.log(`📂 Open the newly created 'mfa-setup.html' file in your browser to scan the QR code.`);
    console.log(`⚠️ Don't forget to add ADMIN_TOTP_SECRET=${secret.base32} to your .env file!\n`);
});