// services/pricing.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 1. 🛡️ Safety Net: Hardcoded Defaults (Used if DB fails or is empty)
const DEFAULT_PRICES = {
    'KYC_CHECK': 5.00,       
    'CLAIM_AI': 10.00,       // Ensures we never bill R0.00 for this
    'MEMBER_CARD': 2.50,     
    'DEBIT_ORDER_FEE': 5.00  
};

// In-memory cache
let priceCache = { ...DEFAULT_PRICES }; // Start with defaults loaded
let lastCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 Minutes

async function loadPrices() {
    const now = Date.now();
    
    // Only refresh if cache is old
    if (now - lastCacheTime > CACHE_DURATION) {
        console.log("🔄 [PRICING] Checking Database for updates...");
        
        try {
            // Attempt to fetch from DB
            // NOTE: This requires 'model ServicePrice' in your schema.prisma
            const prices = await prisma.servicePrice.findMany();
            
            if (prices.length > 0) {
                // Overwrite defaults with DB values
                prices.forEach(p => {
                    priceCache[p.code] = Number(p.amount);
                });
                console.log(`✅ [PRICING] Updated ${prices.length} prices from DB.`);
            } else {
                console.log("⚠️ [PRICING] DB table empty. Using Default Fallbacks.");
            }
            
            lastCacheTime = now;

        } catch (err) {
            // If table doesn't exist, we silently fail and keep using Defaults
            console.warn("⚠️ [PRICING] Database fetch failed (Table missing?), using Hardcoded Defaults.");
        }
    }
}

/**
 * Get the current price for a service code.
 * @param {string} code - The unique service code (e.g. 'KYC_CHECK')
 * @returns {Promise<number>} - The price in Rands
 */
async function getPrice(code) {
    await loadPrices(); // Check for updates
    
    const price = priceCache[code];
    
    if (price === undefined) {
        console.error(`❌ [PRICING] Critical: No price for '${code}'. returning R0.00`);
        return 0.00;
    }
    
    return price;
}

module.exports = { getPrice };