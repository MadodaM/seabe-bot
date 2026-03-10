// utils/crypto.js
// VERSION: 2.1 (Deterministic Encryption with Legacy Fallback)
const crypto = require('crypto');
const algorithm = 'aes-256-cbc';

// 🛡️ ROBUST FIX: Hash the key to ensure it is exactly 32 bytes, no matter what string you used.
const secret = process.env.ENCRYPTION_KEY || 'default_fallback_secret_DO_NOT_USE_IN_PROD';
const key = crypto.createHash('sha256').update(String(secret)).digest('base64').substring(0, 32);

// 🛡️ DETERMINISTIC IV: A static IV derived from the key makes encryption "searchable".
// This allows Prisma to do exact-match lookups: WHERE phone = 'enc:1a2b3c...'
const STATIC_IV = crypto.createHash('md5').update(key).digest(); 

function encrypt(text) {
    if (!text) return text;
    // Prevent double-encryption
    if (typeof text === 'string' && text.startsWith('enc:')) return text; 
    
    try {
        const cipher = crypto.createCipheriv(algorithm, Buffer.from(key), STATIC_IV);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return `enc:${encrypted}`; // Tag it so we know it's deterministic
    } catch (e) {
        console.error("Encryption Error:", e.message);
        return text; 
    }
}

function decrypt(text) {
    if (!text) return text;
    
    // 🔄 LEGACY DECRYPTION (Supports your old random-IV format)
    // If it has a colon but DOES NOT start with 'enc:', it's the old version.
    if (typeof text === 'string' && text.includes(':') && !text.startsWith('enc:')) {
        try {
            const textParts = text.split(':');
            const iv = Buffer.from(textParts.shift(), 'hex');
            const encryptedText = Buffer.from(textParts.join(':'), 'hex');
            const decipher = crypto.createDecipheriv(algorithm, Buffer.from(key), iv);
            let decrypted = decipher.update(encryptedText);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            return decrypted.toString();
        } catch (e) {
            console.error("Legacy Decryption Error:", e.message);
            return text;
        }
    }

    // 🔒 NEW DETERMINISTIC DECRYPTION
    if (typeof text === 'string' && !text.startsWith('enc:')) return text; 
    
    try {
        const encryptedHex = text.replace('enc:', '');
        const decipher = crypto.createDecipheriv(algorithm, Buffer.from(key), STATIC_IV);
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        console.error("Decryption Error:", e.message);
        return text;
    }
}

module.exports = { encrypt, decrypt };