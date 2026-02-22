// File: services/prisma.js
const { PrismaClient } = require('@prisma/client');

// 1. Initialize the base client
const basePrisma = new PrismaClient();

// 2. Attach the Extension
const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ operation, model, args, query }) {
        // A. Let the normal database action happen first
        const result = await query(args);

        // B. Define the mutations we want to track
        const isMutation = ['create', 'update', 'delete'].includes(operation);
        
        // C. IMPORTANT: Never audit the AuditLog table itself to prevent infinite loops!
        if (isMutation && model !== 'AuditLog') {
             try {
                 await basePrisma.auditLog.create({
                     data: {
                         // Default to SYSTEM if adminId isn't passed in the args context
                         adminId: args.ctx?.adminId || 'SYSTEM', 
                         action: operation.toUpperCase(),
                         modelName: model,
                         recordId: result.id,
                         // Store the new resulting data (you can expand this to fetch oldData too)
                         newData: result 
                     }
                 });
             } catch (error) {
                 console.error("Failed to write to AuditLog:", error);
             }
        }
        
        return result;
      },
    },
  },
});

// 3. Export the EXTENDED client to be used across the app
module.exports = prisma;