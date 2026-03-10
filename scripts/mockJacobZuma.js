// scripts/mockJacobZuma.js
// Simulates an end-to-end webhook payment from a Sanctioned individual
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const axios = require('axios');

async function runTest() {
    console.log("\n🚨 INITIATING FICA RISK ENGINE MOCK TEST...\n");

    try {
        // 1. Get any organization to attach this to
        const church = await prisma.church.findFirst();
        if (!church) throw new Error("No organizations found in DB.");

        // 2. Create the 'Sanctioned' Member
        const testPhone = "27820000000"; // Replace with your own number if you want the WhatsApp receipt!
        const member = await prisma.member.create({
            data: {
                firstName: "Jacob",
                lastName: "Zuma",
                phone: testPhone,
                idNumber: "4204125033080", 
                churchCode: church.code,
                status: "ACTIVE"
            }
        });
        console.log(`👤 Created mock member: ${member.firstName} ${member.lastName} (ID: ${member.id})`);

        // 3. Create a PENDING transaction in the Master Ledger
        const mockRef = `TEST-PEP-${Date.now()}`;
        const tx = await prisma.transaction.create({
            data: {
                reference: mockRef,
                amount: 1500.00,
                status: "PENDING",
                method: "PAYMENT_LINK",
                phone: member.phone,
                churchCode: church.code,
                memberId: member.id,
                date: new Date()
            }
        });
        console.log(`🧾 Created PENDING transaction: ${mockRef}`);

        // 4. Fire the Webhook Payload!
        console.log(`\n🚀 Firing ITN Webhook Payload to server...`);
        
        // IMPORTANT: Ensure your local server is running on port 3000!
        const targetUrl = "http://localhost:3000/api/core/webhooks/payment";

        const payload = new URLSearchParams({
            p2: mockRef,
            p4: "1500.00",
            TransactionAccepted: "true",
            Reason: "000",
            BypassKey: process.env.ADMIN_SECRET || 'secret_token_123' // The backdoor key
        }).toString();

        await axios.post(targetUrl, payload, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        console.log(`✅ Webhook fired successfully!\n`);
        
        console.log(`👀 GO CHECK YOUR DASHBOARDS:`);
        console.log(`1. Super Admin -> Compliance: Transaction should be RED (Flagged)`);
        console.log(`2. Client Admin -> Ledger: Transaction should show Gross vs Net splits.`);
        
    } catch (e) {
        console.error("❌ Mock Test failed:", e.message);
    } finally {
        await prisma.$disconnect();
    }
}

runTest();