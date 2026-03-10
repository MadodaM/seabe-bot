// services/db.js
// Prisma Client wrapped with Automatic Field-Level PII Encryption
const { PrismaClient } = require('@prisma/client');
const { encrypt, decrypt } = require('../utils/crypto');

// Initialize base client
const basePrisma = new PrismaClient();

// Create the Extended Client
const prisma = basePrisma.$extends({
    query: {
        member: {
            // 🔒 ENCRYPT ON WRITE & SEARCH
            async $allOperations({ operation, args, query }) {
                
                // 1. Encrypt incoming data before saving to DB
                if (['create', 'update', 'upsert'].includes(operation) && args.data) {
                    if (args.data.phone) args.data.phone = encrypt(args.data.phone);
                    if (args.data.idNumber) args.data.idNumber = encrypt(args.data.idNumber);
                }
                
                // 2. Encrypt search parameters so "findUnique({ phone: '082' })" still works
                if (args.where) {
                    if (args.where.phone && typeof args.where.phone === 'string') {
                        args.where.phone = encrypt(args.where.phone);
                    }
                    if (args.where.idNumber && typeof args.where.idNumber === 'string') {
                        args.where.idNumber = encrypt(args.where.idNumber);
                    }
                }

                return query(args);
            }
        }
    },
    result: {
        member: {
            // 🔓 DECRYPT ON READ
            // Whenever Prisma returns a member, seamlessly decrypt these fields in memory
            phone: {
                needs: { phone: true },
                compute(member) { return decrypt(member.phone); }
            },
            idNumber: {
                needs: { idNumber: true },
                compute(member) { return decrypt(member.idNumber); }
            }
        }
    }
});

module.exports = prisma;