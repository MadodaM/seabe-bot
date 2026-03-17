// services/pricing.js
// 💰 Central Pricing Strategy (Self-Healing & Grouped)

const { PrismaClient } = require('@prisma/client');
const prisma = require('./prisma-client');

// 1. 🛡️ Master Default Prices (One single source of truth)
const DEFAULT_PRICES = {
    // --- Platform Service Fees ---
    'KYC_CHECK': 5.00,
    'CLAIM_AI': 10.00,
    'MEMBER_CARD': 2.50,
    'DEBIT_ORDER_FEE': 5.00,

    // --- Transaction Fees: Capitec Pay / EFT ---
    'TX_CAPITEC_WH_PCT': 0.016,  
    'TX_CAPITEC_WH_FLAT': 1.50, 
    'TX_CAPITEC_RT_PCT': 0.025,  
    'TX_CAPITEC_RT_FLAT': 1.50, 

    // --- Transaction Fees: Credit/Debit Card ---
    'TX_CARD_WH_PCT': 0.0295,    
    'TX_CARD_WH_FLAT': 1.50,
    'TX_CARD_RT_PCT': 0.035,     
    'TX_CARD_RT_FLAT': 2.50,    

    // --- Transaction Fees: Retail Cash ---
    'TX_RETAIL_WH_PCT': 0.039,    
    'TX_RETAIL_WH_FLAT': 8.00,
    'TX_RETAIL_RT_PCT': 0.050,    
    'TX_RETAIL_RT_FLAT': 3.00,

    // --- Module Surcharges (LMS, Restaurant, etc) ---
    'MOD_LMS_PCT': 0.10,
    'MOD_LMS_MIN': 5.00,
    'MOD_REST_FLAT': 3.00,
    'MOD_RETAIL_FLAT': 1.50
};

// In-memory cache
let priceCache = { ...DEFAULT_PRICES }; 
let lastCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 Minutes

/**
 * Syncs the Database with the code. 
 * If a key exists here but NOT in the DB, it adds it automatically.
 */
async function loadPrices() {
    const now = Date.now();
    // Cache check: Skip if fresh (and cache is mostly populated)
    if (now - lastCacheTime < CACHE_DURATION && Object.keys(priceCache).length > 15) return;

    try {
        const dbPrices = await prisma.servicePrice.findMany();
        const dbKeys = dbPrices.map(p => p.code);

        // A. Seed missing keys individually
        for (const [code, amount] of Object.entries(DEFAULT_PRICES)) {
            if (!dbKeys.includes(code)) {
                console.log(`🌱 [PRICING] Seeding missing key: ${code}`);
                await prisma.servicePrice.create({
                    data: { 
                        code, 
                        amount: amount,
                        description: `Auto-generated price for ${code}`
                    }
                }).catch(() => {}); // Safety catch
            }
        }

        // B. Update Cache with DB values
        const updatedDbPrices = await prisma.servicePrice.findMany();
        updatedDbPrices.forEach(p => {
            priceCache[p.code] = Number(p.amount);
        });

        lastCacheTime = now;
    } catch (err) {
        console.warn("⚠️ [PRICING] DB Sync failed, using Cache/Defaults.", err.message);
    }
}

/**
 * Main accessor function used system-wide
 */
async function getPrice(code) {
    await loadPrices(); 
    const price = priceCache[code];
    
    if (price === undefined) {
        console.error(`❌ [PRICING] Unknown Code '${code}'. returning R0.00`);
        return 0.00;
    }
    
    return price;
}

module.exports = { getPrice, loadPrices, DEFAULT_PRICES };