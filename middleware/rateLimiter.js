// middleware/rateLimiter.js
// Anti-Spam & DDoS Protection per IP Address
const rateLimit = require('express-rate-limit');

// 1. GLOBAL SHIELD: Applied to every single request on the platform
// Prevents basic Denial of Service (DDoS) attacks.
const globalLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 500, // Limit each IP to 500 requests per windowMs
    message: "Too many requests from this IP, please try again after 10 minutes.",
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// 2. OTP FORTRESS: Applied ONLY to the login/OTP route
// Prevents hackers/bots from draining your Twilio credits.
const otpLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 3, // Only 3 OTP requests allowed per minute per IP
    message: "You have requested too many OTPs. Please wait 60 seconds before trying again.",
    standardHeaders: true,
    legacyHeaders: false,
});

// 3. AI SCANNER FORTRESS: Applied ONLY to the Gemini extraction route
// Prevents hackers/bots from draining your Google AI credits.
const aiScannerLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5, // Only 5 document scans allowed per minute per IP
    message: "AI Scanning rate limit exceeded. Please wait 60 seconds.",
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = {
    globalLimiter,
    otpLimiter,
    aiScannerLimiter
};