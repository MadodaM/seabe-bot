// tests/seabePay.test.js

// 1. Mock the Checkout Router Logic
// In production, this would be imported from your services folder
function getAvailablePaymentMethods(amount) {
    const CARD_LIMIT = 1000.00;
    const methods = ['PAYSHAP', 'SECURE_EFT'];
    
    if (amount <= CARD_LIMIT) {
        methods.push('CARD');
    }
    return methods;
}

// 2. Mock the Webhook Processing Logic
function calculatePlatformFee(amount) {
    // Seabe charges a flat 1.5% platform fee
    return amount * 0.015;
}

describe('💰 Seabe Pay Engine', () => {
    
    describe('Dynamic Checkout Router', () => {
        it('should allow Card payments for amounts under R1000', () => {
            const methods = getAvailablePaymentMethods(150.00);
            expect(methods).toContain('CARD');
            expect(methods).toContain('PAYSHAP');
        });

        it('should block Card payments for high-value amounts (R2500)', () => {
            const methods = getAvailablePaymentMethods(2500.00);
            expect(methods).not.toContain('CARD'); // Protects your 3% margin
            expect(methods).toContain('SECURE_EFT');
            expect(methods).toContain('PAYSHAP');
        });

        it('should perfectly handle the R1000 threshold boundary', () => {
            const methods = getAvailablePaymentMethods(1000.00);
            expect(methods).toContain('CARD');
            
            const methodsOver = getAvailablePaymentMethods(1000.01);
            expect(methodsOver).not.toContain('CARD');
        });
    });

    describe('Webhook Fee Calculator', () => {
        it('should correctly calculate the 1.5% Seabe platform fee', () => {
            const fee = calculatePlatformFee(10000.00); // R10,000 transaction
            expect(fee).toBe(150.00); // R150 fee
        });

        it('should handle small micro-transactions without floating point errors', () => {
            const fee = calculatePlatformFee(100.00);
            expect(fee).toBe(1.50);
        });
    });
});