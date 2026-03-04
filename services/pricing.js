// services/pricing.js
// 💰 Central Pricing Strategy (Self-Healing)

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 1. 🛡️ Default Prices (Used if DB is empty)
const DEFAULT_PRICES = {
    'KYC_CHECK': 5.00,       
    'CLAIM_AI': 10.00,       // R10.00 per scan
    'MEMBER_CARD': 2.50,     
    'DEBIT_ORDER_FEE': 5.00  
};

// In-memory cache
let priceCache = { ...DEFAULT_PRICES }; 
let lastCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 Minutes

async function loadPrices() {
    const now = Date.now();
    
    // Only refresh if cache is expired
    if (now - lastCacheTime > CACHE_DURATION) {
        // console.log("🔄 [PRICING] Syncing with Database...");
        
        try {
            // A. Fetch from DB
            const dbPrices = await prisma.servicePrice.findMany();
            
            // B. If DB is empty, SEED it automatically!
            if (dbPrices.length === 0) {
                console.log("🌱 [PRICING] Table empty. Seeding defaults...");
                for (const [code, amount] of Object.entries(DEFAULT_PRICES)) {
                    await prisma.servicePrice.create({
                        data: { 
                            code, 
                            amount: amount,
                            description: `Auto-generated price for ${code}`
                        }
                    });
                }
                // Cache is already set to defaults, so we are good.
            } else {
                // C. If DB has data, update our cache
                dbPrices.forEach(p => {
                    priceCache[p.code] = Number(p.amount);
                });
                // console.log(`✅ [PRICING] Synced ${dbPrices.length} prices.`);
            }
            
            lastCacheTime = now;

        } catch (err) {
            console.warn("⚠️ [PRICING] DB Sync failed (Table missing?), using Defaults.");
            // We just keep using the DEFAULT_PRICES we loaded at the top
        }
    }
}

/**
 * Get the current price for a service code.
 * @param {string} code - The unique service code (e.g. 'CLAIM_AI')
 * @returns {Promise<number>} - The price in Rands
 */
async function getPrice(code) {
    await loadPrices(); // Ensure sync
    
    const price = priceCache[code];
    
    // Safety check: if code is unknown, return 0 or a safe default
    if (price === undefined) {
        console.error(`❌ [PRICING] Unknown Code '${code}'. returning R0.00`);
        return 0.00;
    }
    
    return price;
}

module.exports = { getPrice };