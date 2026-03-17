const { PrismaClient } = require('@prisma/client');

// Initialize the standard client
const prisma = new PrismaClient();

// 🛡️ SEABE DIGITAL IMMUTABLE LEDGER EXTENSION
const compliantPrisma = prisma.$extends({
  query: {
    transaction: {
      async delete({ args, query }) {
        args.data = { deletedAt: new Date() };
        return prisma.transaction.update(args);
      },
      async deleteMany({ args, query }) {
        args.data = { deletedAt: new Date() };
        return prisma.transaction.updateMany(args);
      },
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