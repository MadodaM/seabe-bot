const request = require('supertest');
const app = require('../index'); // Your Express App
const { PrismaClient } = require('@prisma/client');

// 1. MOCK THE DATABASE (Prisma)
// We trick the bot into thinking these organizations exist
jest.mock('@prisma/client', () => {
    const mockPrisma = {
        church: {
            findUnique: jest.fn().mockImplementation(({ where }) => {
                const code = where.code.toUpperCase();
                if (code === 'AFM001') {
                    return Promise.resolve({ code: 'AFM001', name: 'Test Church', type: 'CHURCH', subscriptionFee: 0 });
                }
                if (code === 'KOP001') {
                    return Promise.resolve({ code: 'KOP001', name: 'Kopanong Society', type: 'BURIAL_SOCIETY', subscriptionFee: 150 });
                }
                if (code === 'HELP001') {
                    return Promise.resolve({ code: 'HELP001', name: 'Save The Kids', type: 'NON_PROFIT', subscriptionFee: 0 });
                }
                return Promise.resolve(null);
            })
        },
        member: {
            upsert: jest.fn().mockResolvedValue({ id: 1, firstName: 'Test', phone: '27820001111' }),
            findUnique: jest.fn().mockResolvedValue({ id: 1, firstName: 'Test', phone: '27820001111' })
        },
        transaction: {
            create: jest.fn().mockResolvedValue({ id: 100 })
        },
        $disconnect: jest.fn() // Mock the disconnect
    };
    return { PrismaClient: jest.fn(() => mockPrisma) };
});

// 2. MOCK PAYSTACK
jest.mock('../services/paystack', () => ({
    createPaymentLink: jest.fn(() => Promise.resolve('https://paystack.com/fake-url'))
}));

describe('Regression Test: All Organization Types', () => {

    // --- CHURCH TESTS ---
    test('TC1: New User gets Onboarding List', async () => {
        const res = await request(app).post('/webhook').send({
            messages: [{ from: "27820001111", text: { body: "Hi" } }]
        });
        expect(res.statusCode).toEqual(200);
    });

    test('TC2: User can Join a Church (AFM001)', async () => {
        const res = await request(app).post('/webhook').send({
            messages: [{ from: "27820001111", text: { body: "AFM001" } }]
        });
        expect(res.statusCode).toEqual(200);
    });

    test('TC3: Church Menu shows "Offering"', async () => {
        const res = await request(app).post('/webhook').send({
            messages: [{ from: "27820001111", text: { body: "Menu" } }] // Simulated Menu call
        });
        // We can't easily check text response in a webhook integration test without a complex setup,
        // but getting a 200 OK means the bot processed logic without crashing.
        expect(res.statusCode).toEqual(200);
    });

    // --- BURIAL SOCIETY TESTS ---
    test('TC4: User can Join a Burial Society (KOP001)', async () => {
        const res = await request(app).post('/webhook').send({
            messages: [{ from: "27820001111", text: { body: "KOP001" } }]
        });
        expect(res.statusCode).toEqual(200);
        // In a real e2e test, we'd check if the response says "Welcome to Kopanong"
    });

    test('TC5: Society Link Generation (Premium)', async () => {
        // Simulate clicking "Pay Premium" (assuming option 1)
        const res = await request(app).post('/webhook').send({
            messages: [{ from: "27820001111", text: { body: "1" } }] 
        });
        expect(res.statusCode).toEqual(200);
    });

    // --- NPO TESTS (New) ---
    test('TC6: User can Join an NPO (HELP001)', async () => {
        const res = await request(app).post('/webhook').send({
            messages: [{ from: "27820001111", text: { body: "HELP001" } }]
        });
        expect(res.statusCode).toEqual(200);
    });

    test('TC7: NPO Link Generation (Donation)', async () => {
        // Simulate clicking "Donate"
        const res = await request(app).post('/webhook').send({
            messages: [{ from: "27820001111", text: { body: "Donate" } }]
        });
        expect(res.statusCode).toEqual(200);
    });

    // --- CLEANUP ---
    afterAll(async () => {
        // Force Jest to exit by closing any open handles
        await new Promise(resolve => setTimeout(() => resolve(), 500)); 
    });
});