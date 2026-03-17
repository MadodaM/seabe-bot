const { PrismaClient } = require('@prisma/client');

const prisma = require('./services/prisma-client');

// 🛡️ SEABE DIGITAL IMMUTABLE LEDGER EXTENSION
// This intercepts all queries to ensure SARB 5-Year compliance.
const compliantPrisma = prisma.$extends({
  query: {
    transaction: {
      // 1. Intercept DELETE commands and turn them into Soft Deletes
      async delete({ args, query }) {
        // Instead of deleting, we update the 'deletedAt' timestamp
        args.data = { deletedAt: new Date() };
        return prisma.transaction.update(args);
      },
      
      async deleteMany({ args, query }) {
        args.data = { deletedAt: new Date() };
        return prisma.transaction.updateMany(args);
      },

      // 2. Filter out soft-deleted records from normal queries 
      // so your UI doesn't show them, even though they still exist in the DB.
      async findMany({ args, query }) {
        args.where = { ...args.where, deletedAt: null };
        return query(args);
      },
      
      async findUnique({ args, query }) {
        args.where = { ...args.where, deletedAt: null };
        return query(args);
      },

      async findFirst({ args, query }) {
        args.where = { ...args.where, deletedAt: null };
        return query(args);
      },
    },
  },
});

module.exports = compliantPrisma;