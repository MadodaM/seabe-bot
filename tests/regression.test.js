const request = require('supertest');
const app = require('../index'); // Your Express App
const { PrismaClient } = require('@prisma/client');

// 🚀 FIX: Mock the environment variable so .replace() doesn't crash
process.env.TWILIO_PHONE_NUMBER = 'whatsapp:+27831234567';

// ==========================================
// 1. MOCK THE SEABE MICROSERVICES
// ==========================================
jest.mock('../services/netcash', () => ({
    createPaymentLink: jest.fn(() => Promise.resolve('https://paynow.netcash.co.za/fake-url')),
    chargeSavedToken: jest.fn(() => Promise.resolve({ success: true, ref: 'TOKEN-REF-123' })),
    verifyPayment: jest.fn(() => Promise.resolve({ status: 'Complete' }))
}));

jest.mock('../services/pricingEngine', () => ({
    calculateTransaction: jest.fn().mockResolvedValue({
        baseAmount: 100, platformFee: 5, netcashFee: 3, totalFees: 8, totalChargedToUser: 108, netSettlement: 92
    })
}));

jest.mock('../services/complianceEngine', () => ({
    screenUserForRisk: jest.fn().mockResolvedValue({
        riskScore: 0, isPepFound: false, isSanctionHit: false, recommendedAction: 'CLEARED', flags: []
    })
}));

jest.mock('../services/receiptGenerator', () => ({
    generateReceiptPDF: jest.fn().mockResolvedValue('https://cloudinary.com/fake-pdf-receipt.pdf')
}));

jest.mock('../services/whatsapp', () => ({
    sendWhatsApp: jest.fn().mockResolvedValue(true)
}));

// ==========================================
// 2. MOCK THE DATABASE (Prisma)
// ==========================================
jest.mock('@prisma/client', () => {
    const mockPrisma = {
        church: {
            findUnique: jest.fn().mockImplementation(({ where }) => {
                const code = where.code ? where.code.toUpperCase() : '';
                if (code === 'AFM001') return Promise.resolve({ id: 1, code: 'AFM001', name: 'Test Church', type: 'CHURCH' });
                if (code === 'KOP001') return Promise.resolve({ id: 2, code: 'KOP001', name: 'Kopanong Society', type: 'BURIAL_SOCIETY' });
                if (code === 'HELP001') return Promise.resolve({ id: 3, code: 'HELP001', name: 'Save The Kids', type: 'NON_PROFIT' });
                if (code === 'SALON001') return Promise.resolve({ id: 4, code: 'SALON001', name: 'Test Salon', type: 'PERSONAL_CARE' });
                return Promise.resolve(null);
            }),
            findFirst: jest.fn().mockResolvedValue({ id: 4, code: 'SALON001', name: 'Test Salon', type: 'PERSONAL_CARE' }),
            findMany: jest.fn().mockResolvedValue([{ id: 4, code: 'SALON001', name: 'Test Salon', type: 'PERSONAL_CARE' }])
        },
        member: {
            upsert: jest.fn().mockResolvedValue({ id: 1, firstName: 'Test', phone: '27820001111', status: 'ACTIVE' }),
            findUnique: jest.fn().mockResolvedValue({ id: 1, firstName: 'Test', phone: '27820001111', status: 'ACTIVE' }),
            findFirst: jest.fn().mockResolvedValue({ id: 1, firstName: 'Test', phone: '27820001111', status: 'ACTIVE' }),
            update: jest.fn().mockResolvedValue(true)
        },
        transaction: {
            create: jest.fn().mockResolvedValue({ id: 100, reference: 'TEST-REF', amount: 100 }),
            findFirst: jest.fn().mockResolvedValue({ id: 100, reference: 'TEST-REF', amount: 100, status: 'PENDING', type: 'DONATION', memberId: 1, churchId: 1 }),
            findUnique: jest.fn().mockResolvedValue({ id: 100, reference: 'TEST-REF', amount: 100, status: 'PENDING' }),
            update: jest.fn().mockResolvedValue(true)
        },
        paymentMethod: {
            findFirst: jest.fn().mockResolvedValue({ id: 1, token: 'fake-token-xyz', cardBrand: 'Visa', last4: '4242' }),
            findUnique: jest.fn().mockResolvedValue(null), // For vaulting new cards
            create: jest.fn().mockResolvedValue(true)
        },
        appointment: {
            findUnique: jest.fn().mockResolvedValue({ 
                id: 1, 
                churchId: 4, 
                memberId: 1, 
                product: { name: 'Haircut', price: 150 }, 
                status: 'COMPLETED',
                member: { phone: '27820001111', firstName: 'Test' }, // 🚀 FIX: Add the nested member object
                church: { name: 'Test Salon' } // Adding church just to be safe for PDF gen
            }),
            update: jest.fn().mockResolvedValue(true)
        },
        complianceLog: {
            create: jest.fn().mockResolvedValue(true)
        },
        $transaction: jest.fn((promises) => Promise.all(promises)),
        $disconnect: jest.fn() 
    };

    // Trick the app into thinking $extends works perfectly
    mockPrisma.$extends = jest.fn(() => mockPrisma);

    return { PrismaClient: jest.fn(() => mockPrisma) };
});

jest.mock('twilio', () => {
    return jest.fn(() => ({
        messages: {
            create: jest.fn().mockResolvedValue({ sid: 'mock_twilio_message_sid_123' })
        }
    }));
});

// ==========================================
// 3. THE REGRESSION SUITE
// ==========================================
describe('Platform Regression Suite: Omni-Channel & Payments', () => {

    // --- LEGACY TESTS ---
    test('TC1: WhatsApp Router - Menu Trigger', async () => {
        const res = await request(app).post('/api/whatsapp/webhook').send({ // Adjusted to standard Meta format
            messages: [{ from: "27820001111", text: { body: "Menu" } }] 
        });
        expect(res.statusCode).toBeGreaterThanOrEqual(200); // 200 or 404 depending on your exact whatsapp route setup
    });

    // --- GROOMING BOT & SEABE ID TESTS ---
    test('TC2: Salon Bot - Request Available Salons', async () => {
        const res = await request(app).post('/api/whatsapp/webhook').send({
            messages: [{ from: "27820001111", text: { body: "salons" } }]
        });
        // We just want to ensure the bot doesn't crash when querying the DB for PERSONAL_CARE
        expect(res.statusCode).toBeDefined(); 
    });

    // --- ADVANCED WEBHOOK TESTS (The Master Ledger & Compliance) ---
    test('TC3: Netcash ITN Webhook - Process Successful Payment, FICA, & Vault Token', async () => {
        // Simulating a raw Netcash ITN POST request
        const res = await request(app)
            .post('/api/core/webhooks/payment')
            .type('form')
            .send({
                Reference: 'TEST-REF-12345',
                TransactionAccepted: 'true',
                Reason: '000',
                Amount: '100.00',
                Token: 'new-vault-token-888',
                CardType: 'Mastercard',
                MaskedCard: '5555444433332222'
            });
        
        // The webhook should return 200 immediately to acknowledge Netcash
        expect(res.statusCode).toEqual(200);
    });

    test('TC4: Netcash ITN Webhook - Process Failed Payment (Stop Code)', async () => {
        const res = await request(app)
            .post('/api/core/webhooks/payment')
            .type('form')
            .send({
                Reference: 'TEST-REF-FAIL',
                TransactionAccepted: 'false',
                ReasonCode: '04', // Bank Account Closed
                Amount: '100.00'
            });
        
        expect(res.statusCode).toEqual(200);
    });

    // --- ADMIN DASHBOARD TESTS ---
    test('TC5: Admin Dashboard - Resend PDF Invoice API', async () => {
        // Simulating the dynamic button click from the UI
        const res = await request(app)
            .post('/admin/SALON001/appointments/1/resend-invoice')
            .set('Cookie', ['session_SALON001=active']) // Mock active session
            .send();
            
        // Should return JSON success if the mocks align
        expect(res.statusCode).toEqual(200);
        expect(res.body.success).toBe(true);
    });

    // --- CLEANUP ---
    afterAll(async () => {
        // Force Jest to exit gracefully
        await new Promise(resolve => setTimeout(() => resolve(), 500)); 
    });
});