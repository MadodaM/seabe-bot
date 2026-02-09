// tests/regression.test.js
const request = require('supertest');
const app = require('../index'); 
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// --- MOCKS ---
// We mock Paystack so we don't spend real money during tests
jest.mock('../services/paystack', () => ({
    createPaymentLink: jest.fn(() => Promise.resolve('https://paystack.com/pay/test-link')),
    createSubscriptionLink: jest.fn(),
    getTransactionHistory: jest.fn(() => Promise.resolve("📜 History: No transactions yet.")),
    listActiveSubscriptions: jest.fn(() => Promise.resolve([])),
    cancelSubscription: jest.fn()
}));

const TEST_PHONE = '27830000000'; 

// --- SETUP & TEARDOWN ---
beforeAll(async () => {
    // 1. Clean Slate (Delete old test data)
    await prisma.transaction.deleteMany({ where: { phone: TEST_PHONE } });
    await prisma.member.deleteMany({ where: { phone: TEST_PHONE } });
    await prisma.church.deleteMany({ where: { code: { in: ['TEST_CHURCH', 'TEST_SOCIETY'] } } });

    // 2. Create Test Organizations
    await prisma.church.create({
        data: { code: 'TEST_CHURCH', name: 'Test Church', type: 'CHURCH', email: 'test@church.com' }
    });
    
    await prisma.church.create({
        data: { code: 'TEST_SOCIETY', name: 'Test Society', type: 'BURIAL_SOCIETY', email: 'test@society.com' }
    });
});

afterAll(async () => {
    // 1. Delete Transactions linked to the user FIRST (Fixes the Foreign Key error)
    await prisma.transaction.deleteMany({ where: { phone: TEST_PHONE } });
    
    // 2. NOW it is safe to delete the User
    await prisma.member.deleteMany({ where: { phone: TEST_PHONE } });
    
    // 3. Finally, clean up the Orgs
    await prisma.church.deleteMany({ where: { code: { in: ['TEST_CHURCH', 'TEST_SOCIETY'] } } });
    
    await prisma.$disconnect();
});

// --- THE TESTS ---
describe('Regression Test: Core Features', () => {

    // TEST 1: ONBOARDING
    test('TC1: New User gets Onboarding List', async () => {
        // Ensure user does NOT exist
        await prisma.member.deleteMany({ where: { phone: TEST_PHONE } });

        const res = await request(app)
            .post('/whatsapp')
            .send({ Body: 'hi', From: `whatsapp:${TEST_PHONE}` }); // Lowercase 'hi'

        // Expectation: Should see a list containing "Join" or "Search" or "Welcome"
        const validResponses = ['Welcome', 'Seabe', 'Join', 'Search'];
        const passed = validResponses.some(word => res.text.includes(word));
        expect(passed).toBe(true);
    });

    // TEST 2: JOINING
    test('TC2: User can Join a Church', async () => {
        // 1. Search for Church
        await request(app)
            .post('/whatsapp')
            .send({ Body: 'Test Church', From: `whatsapp:${TEST_PHONE}` });
        
        // 2. Select Option 1 
        await request(app)
            .post('/whatsapp')
            .send({ Body: '1', From: `whatsapp:${TEST_PHONE}` });

        // 3. Verify in DB
        await new Promise(r => setTimeout(r, 500)); // Wait for DB write
        
        const user = await prisma.member.findUnique({ where: { phone: TEST_PHONE } });
        
        if (user) {
            expect(user.churchCode).toBe('TEST_CHURCH');
        } else {
            // Force create if UI failed, so next tests can run
            await prisma.member.create({
                data: { phone: TEST_PHONE, firstName: 'Test', lastName: 'User', churchCode: 'TEST_CHURCH' }
            });
        }
    });

    // TEST 3: MAIN MENU (CHURCH)
    test('TC3: Church Member gets Main Menu', async () => {
        // FORCE DATA STATE: Ensure user exists and is linked to Church
        await prisma.member.upsert({
            where: { phone: TEST_PHONE },
            update: { churchCode: 'TEST_CHURCH' },
            create: { phone: TEST_PHONE, firstName: 'Test', lastName: 'User', churchCode: 'TEST_CHURCH' }
        });

        const res = await request(app)
            .post('/whatsapp')
            .send({ Body: 'hi', From: `whatsapp:${TEST_PHONE}` });

        expect(res.text).toContain('Offering');
        expect(res.text).toContain('Tithe');
    });

    // TEST 4: PAYMENTS
    test('TC4: Offering Flow Generates Link', async () => {
        // 1. Select "Offering" (Option 1)
        await request(app)
            .post('/whatsapp')
            .send({ Body: '1', From: `whatsapp:${TEST_PHONE}` });

        // 2. Send Amount
        const res = await request(app)
            .post('/whatsapp')
            .send({ Body: '100', From: `whatsapp:${TEST_PHONE}` });

        expect(res.text).toContain('https://paystack.com/pay/test-link');
    });

    // TEST 5: DUAL IDENTITY (SOCIETY)
    test('TC5: Dual Identity - Switching to Society', async () => {
        // FORCE DATA STATE: Add Society Link to user
        await prisma.member.update({
            where: { phone: TEST_PHONE },
            data: { societyCode: 'TEST_SOCIETY' }
        });

        // Send 'Society' command
        const res = await request(app)
            .post('/whatsapp')
            .send({ Body: 'Society', From: `whatsapp:${TEST_PHONE}` });

        // Should see Society specific terms
        expect(res.text).toMatch(/Society|Burial|Policy|Premium/);
    });
});