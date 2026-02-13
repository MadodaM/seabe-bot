// utils/crypto.js
const crypto = require('crypto');
const algorithm = 'aes-256-cbc';

// 🛡️ ROBUST FIX: Hash the key to ensure it is exactly 32 bytes, no matter what string you used.
const secret = process.env.ENCRYPTION_KEY || 'default_fallback_secret_DO_NOT_USE_IN_PROD';
const key = crypto.createHash('sha256').update(String(secret)).digest('base64').substr(0, 32);

const ivLength = 16; 

function encrypt(text) {
    if (!text) return null;
    try {
        const iv = crypto.randomBytes(ivLength);
        const cipher = crypto.createCipheriv(algorithm, Buffer.from(key), iv);
        let encrypted = cipher.update(text);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        return iv.toString('hex') + ':' + encrypted.toString('hex');
    } catch (e) {
        console.error("Encryption Error:", e.message);
        return null; // Return null instead of crashing the server
    }
}

function decrypt(text) {
    if (!text) return null;
    try {
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv(algorithm, Buffer.from(key), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (e) {
        console.error("Decryption Error:", e.message);
        return null;
    }
}

module.exports = { encrypt, decrypt };