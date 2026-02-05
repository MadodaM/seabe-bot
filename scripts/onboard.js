// scripts/onboard.js
// Usage: node scripts/onboard.js

require('dotenv').config();
require('dotenv').config(); // This is existing

// ⬇️ ADD THESE DEBUG LINES ⬇️
console.log("-----------------------------------");
console.log("DEBUG CHECK:");
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
    console.error("❌ DATABASE_URL is MISSING or UNDEFINED.");
} else {
    // Print first 15 chars only to keep password safe
    console.log(`✅ DATABASE_URL found: ${dbUrl.substring(0, 15)}...`); 
}
console.log("-----------------------------------");
// ⬆️ END DEBUG LINES ⬆️

const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const readline = require('readline');

const prisma = new PrismaClient();
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

// Paystack API Setup
const paystack = axios.create({
    baseURL: 'https://api.paystack.co',
    headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type': 'application/json'
    }
});

// Helper: Ask Question
function ask(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
    console.log("\n⛪ SEABE CHURCH ONBOARDING WIZARD ⛪");
    console.log("-----------------------------------");

    try {
        // 1. Gather Details
        const name = await ask("Enter Church Name: ");
        const email = await ask("Enter Church Email (for reports): ");
        const bankCode = await ask("Enter Bank Code (e.g., 632005 for ABSA): ");
        const accountNum = await ask("Enter Account Number: ");
        const businessName = await ask("Enter Business Name (on Account): ");

        console.log("\n⏳ Creating Paystack Subaccount...");

        // 2. Create Paystack Subaccount
        const paystackRes = await paystack.post('/subaccount', {
            business_name: businessName,
            settlement_bank: bankCode, 
            account_number: accountNum,
            percentage_charge: 2.5, // Your Platform Fee (Adjust if needed)
            description: `Subaccount for ${name}`
        });

        const subaccountCode = paystackRes.data.data.subaccount_code;
        console.log(`✅ Paystack Subaccount Created: ${subaccountCode}`);

        // 3. Generate a Unique 3-Letter Code (e.g., GRACE -> GRA)
        let code = name.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
        const existing = await prisma.church.findUnique({ where: { code: code } });
        if (existing) {
            code = code + Math.floor(Math.random() * 10); // Handle duplicates
        }

        // 4. Save to Neon Database
        console.log("⏳ Saving to Database...");
        const newChurch = await prisma.church.create({
            data: {
                name: name,
                code: code,
                subaccountCode: subaccountCode,
                email: email
            }
        });

        console.log("\n🎉 SUCCESS! Church Onboarded.");
        console.log("-----------------------------");
        console.log(`Name: ${newChurch.name}`);
        console.log(`Short Code: ${newChurch.code}`);
        console.log(`Subaccount: ${newChurch.subaccountCode}`);
        console.log("-----------------------------");

    } catch (error) {
        console.error("\n❌ ERROR:");
        if (error.response) {
            console.error("Paystack says:", error.response.data.message);
        } else {
            console.error(error.message);
        }
    } finally {
        await prisma.$disconnect();
        rl.close();
    }
}

main();