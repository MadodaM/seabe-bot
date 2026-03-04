// services/pricing.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// In-memory cache to prevent database hammering
let priceCache = {};
let lastCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 Minutes

async function loadPrices() {
    const now = Date.now();
    // Only refresh from DB if cache is older than 5 minutes
    if (now - lastCacheTime > CACHE_DURATION || Object.keys(priceCache).length === 0) {
        console.log("🔄 [PRICING] Refreshing price list from Database...");
        const prices = await prisma.servicePrice.findMany();
        
        prices.forEach(p => {
            priceCache[p.code] = Number(p.amount);
        });
        
        lastCacheTime = now;
    }
}

/**
 * Get the current price for a service code.
 * @param {string} code - The unique service code (e.g. 'KYC_CHECK')
 * @returns {Promise<number>} - The price in Rands
 */
async function getPrice(code) {
    await loadPrices(); // Ensure cache is warm
    const price = priceCache[code];
    
    if (price === undefined) {
        console.error(`❌ [PRICING] Warning: No price found for code '${code}'. Defaulting to R0.00`);
        return 0.00;
    }
    
    return price;
}

module.exports = { getPrice };