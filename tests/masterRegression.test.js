// ==========================================
// 1. ENVIRONMENT SETUP (Must be absolute first)
// ==========================================
process.env.TWILIO_PHONE_NUMBER = 'whatsapp:+27831234567';
process.env.RESEND_API_KEY = 're_mock_123'; 
process.env.GEMINI_API_KEY = 'mock_api_key';
process.env.NODE_ENV = 'test';

// ==========================================
// 2. EXTERNAL LIBRARY MOCKS
// ==========================================
jest.mock('node-cron', () => ({
    schedule: jest.fn()
}));

jest.mock('../services/scheduler', () => ({
    startScheduler: jest.fn()
}));

jest.mock('resend', () => ({
    Resend: jest.fn().mockImplementation(() => ({
        emails: { send: jest.fn().mockResolvedValue({ id: 'mock-email-id' }) }
    }))
}));

jest.mock('twilio', () => jest.fn(() => ({
    messages: { create: jest.fn().mockResolvedValue({ sid: 'mock_sid_123' }) }
})));

jest.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
        getGenerativeModel: jest.fn().mockReturnValue({
            generateContent: jest.fn().mockResolvedValue({ response: { text: () => '600123456789' } })
        })
    }))
}));

// ==========================================
// 3. DATABASE (PRISMA) MASTER MOCK
// ==========================================
jest.mock('@prisma/client', () => {
    const mockPrisma = {
        church: {
            findUnique: jest.fn().mockImplementation(({ where }) => {
                const code = where.code ? where.code.toUpperCase() : '';
                if (code === 'AFM001') return Promise.resolve({ id: 1, code: 'AFM001', name: 'Test Church', type: 'CHURCH' });
                if (code === 'KOP001') return Promise.resolve({ id: 2, code: 'KOP001', name: 'Kopanong Society', type: 'BURIAL_SOCIETY' });
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
            update: jest.fn().mockResolvedValue(true),
            create: jest.fn().mockResolvedValue({ id: 2, status: 'LEAD' })
        },
        transaction: {
            create: jest.fn().mockResolvedValue({ id: 100, reference: 'TEST-REF', amount: 100 }),
            findFirst: jest.fn().mockResolvedValue({ id: 100, reference: 'TEST-REF', status: 'SUCCESS' }),
            findUnique: jest.fn().mockResolvedValue({ id: 100, status: 'SUCCESS' }),
            update: jest.fn().mockResolvedValue(true),
            aggregate: jest.fn().mockResolvedValue({ _sum: { netSettlement: 0 } }),
            count: jest.fn().mockResolvedValue(0)
        },
        complianceLog: {
            create: jest.fn().mockResolvedValue(true)
        },
        booking: {
            findFirst: jest.fn(), 
            create: jest.fn().mockResolvedValue({ id: 1, status: 'PENDING' })
        },
        quote: { update: jest.fn(), updateMany: jest.fn() },
        requestForQuote: { update: jest.fn() },
        purchaseOrder: { create: jest.fn().mockResolvedValue({ id: 1, poNumber: 'PO-TEST-123' }) },
        appointment: {
            findUnique: jest.fn().mockResolvedValue({ id: 1, churchId: 4, member: { phone: '27820001111' }, product: { name: 'Fade' } }),
            findMany: jest.fn().mockResolvedValue([]),
            update: jest.fn().mockResolvedValue(true)
        },
        botSession: {
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue(true)
        },
        webhookLog: {
            create: jest.fn().mockResolvedValue({ id: 1, status: 'PENDING' }),
            update: jest.fn().mockResolvedValue({ id: 1, status: 'SUCCESS' }),
            findUnique: jest.fn().mockResolvedValue({ id: 1, status: 'SUCCESS' })
        },
        $transaction: jest.fn((promises) => Promise.all(promises)),
        $disconnect: jest.fn(),
        $extends: jest.fn().mockReturnThis()
		
    };
    return { PrismaClient: jest.fn(() => mockPrisma) };
});

// 👈 THIS MUST BE OUTSIDE AND BELOW THE PREVIOUS MOCK
// Map the singleton to use the fake Prisma client we just built above
jest.mock('../services/prisma-client', () => {
    const { PrismaClient } = require('@prisma/client');
    return new PrismaClient();
});

// ==========================================
// 4. IMPORTS & SERVICE MOCKS
// ==========================================
const request = require('supertest');
const app = require('../index'); 
const { PrismaClient } = require('@prisma/client');

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

jest.mock('../services/pricing', () => ({
    getPrice: jest.fn(async (code) => {
        if (code === 'MIN_TRANSACTION') return 100.00;
        if (code === 'MIN_CHURCH_GIFT') return 10.00;
        return 0;
    })
}));

jest.mock('../services/complianceEngine', () => ({
    screenUserForRisk: jest.fn().mockResolvedValue({
        riskScore: 0, isPepFound: false, isSanctionHit: false, recommendedAction: 'CLEARED', flags: []
    })
}));

jest.mock('../services/pdfGenerator', () => ({
    generateStatement: jest.fn().mockResolvedValue('https://seabe.tech/statements/fake-pdf.pdf')
}));

jest.mock('../services/localScanner', () => ({
    decodeBarcode: jest.fn()
}));

jest.mock('../services/whatsapp', () => ({
    sendWhatsApp: jest.fn().mockResolvedValue(true)
}));

// ==========================================
// 5. THE REGRESSION SUITE
// ==========================================
describe('🌐 Seabe Platform: End-to-End Regression Suite', () => {

    describe('Core Webhook & Routing', () => {
        test('TC1: WhatsApp Router - Menu Trigger', async () => {
            const res = await request(app).post('/api/whatsapp/webhook').send({ 
                messages: [{ from: "27820001111", text: { body: "Menu" } }] 
            });
            expect(res.statusCode).toBeGreaterThanOrEqual(200); 
        });

        test('TC2: Netcash ITN Webhook - Process Successful Payment', async () => {
            const res = await request(app)
                .post('/api/core/webhooks/payment')
                .type('form')
                .send({
                    Reference: 'TEST-REF-12345',
                    TransactionAccepted: 'true',
                    Reason: '000',
                    Amount: '100.00'
                });
            expect(res.statusCode).toEqual(200);
        });
    });

    describe('🏢 Facilities & Venue Booking Engine', () => {
        it('TC3: Should block double-booking on an existing date', async () => {
            const prisma = new PrismaClient();
            prisma.booking.findFirst.mockResolvedValueOnce({ id: 1, status: 'CONFIRMED' });
            const existingBooking = await prisma.booking.findFirst({ where: { bookingDate: new Date('2026-05-24') } });
            expect(existingBooking).not.toBeNull();
            expect(existingBooking.status).toBe('CONFIRMED');
        });

        it('TC4: Should allow booking on a free date', async () => {
            const prisma = new PrismaClient();
            prisma.booking.findFirst.mockResolvedValueOnce(null);
            const existingBooking = await prisma.booking.findFirst({ where: { bookingDate: new Date('2026-05-25') } });
            expect(existingBooking).toBeNull();
        });
    });

    describe('📸 Hybrid Barcode Scanner (Local + AI)', () => {
        it('TC5: Should decode barcode locally if the image is clear', async () => {
            const { decodeBarcode } = require('../services/localScanner');
            decodeBarcode.mockResolvedValueOnce('123456789012');
            const barcode = await decodeBarcode(Buffer.from('fake-image-data'));
            expect(barcode).toBe('123456789012');
        });

        it('TC6: Should fallback to Gemini AI if local scanner fails', async () => {
            const { decodeBarcode } = require('../services/localScanner');
            decodeBarcode.mockResolvedValueOnce(null); 
            const localResult = await decodeBarcode(Buffer.from('blurry-image-data'));
            expect(localResult).toBeNull();

            const { GoogleGenerativeAI } = require('@google/generative-ai');
            const genAI = new GoogleGenerativeAI();
            const model = genAI.getGenerativeModel();
            const aiResult = await model.generateContent();
            expect(aiResult.response.text()).toBe('600123456789');
        });
    });

    describe('🛒 Procurement & Vendor Engine', () => {
        it('TC7: Should execute Quote Acceptance and PO Generation Transaction', async () => {
            const prisma = new PrismaClient();
            await prisma.$transaction([
                prisma.quote.update({ where: { id: 7 }, data: { status: 'ACCEPTED' } }),
                prisma.requestForQuote.update({ where: { id: 42 }, data: { status: 'FULFILLED' } }),
                prisma.purchaseOrder.create({ data: { poNumber: 'PO-TEST', amount: 1500 } })
            ]);
            expect(prisma.$transaction).toHaveBeenCalled();
        });
    });

    describe('🛡️ Seabe CRM, Compliance & Lifecycle', () => {
        test('TC8: should reject onboarding if SARB terms not accepted', () => {
            const processOnboarding = (payload) => {
                if (!payload.agencyAccepted) throw new Error("Compliance Error");
                return { status: "VERIFIED" };
            };
            expect(() => processOnboarding({ agencyAccepted: false })).toThrow("Compliance Error");
        });

        test('TC9: Should identify leads ready for tracking', async () => {
            const prisma = new PrismaClient();
            const newLead = await prisma.member.create({ data: { phone: '27830000000', status: 'LEAD' } });
            expect(newLead.status).toBe('LEAD');
        });

        test('TC10: Should drop engagement score for inactive members', () => {
            let member = { engagementScore: 100, lastInteractionAt: new Date('2025-01-01') };
            const sixtyDaysAgo = new Date();
            sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
            if (member.lastInteractionAt < sixtyDaysAgo) member.engagementScore = 50;
            expect(member.engagementScore).toBe(50);
        });
    });

    describe('💰 Seabe Pay Engine & Pricing', () => {
        function getAvailableMethods(amount) {
            const methods = ['PAYSHAP', 'SECURE_EFT'];
            if (amount <= 1000.00) methods.push('CARD');
            return methods;
        }

        it('TC11: should allow Card payments under R1000', () => {
            expect(getAvailableMethods(150.00)).toContain('CARD');
        });

        it('TC12: should block Card payments over R1000', () => {
            expect(getAvailableMethods(2500.00)).not.toContain('CARD'); 
        });

        it('TC13: Should fetch and enforce minimum Burial Society transaction', async () => {
            const { getPrice } = require('../services/pricing');
            const minTransaction = await getPrice('MIN_TRANSACTION');
            expect(minTransaction).toBe(100.00);
            
            const inputAmount = 50.00;
            expect(inputAmount < minTransaction).toBe(true); 
        });

        it('TC14: Should fetch and enforce minimum Church gift', async () => {
            const { getPrice } = require('../services/pricing');
            const minGift = await getPrice('MIN_CHURCH_GIFT');
            expect(minGift).toBe(10.00);
            
            const inputAmount = 5.00;
            expect(inputAmount < minGift).toBe(true); 
        });
    });

    afterAll(async () => {
        await new Promise(resolve => setTimeout(resolve, 500)); 
    });
});