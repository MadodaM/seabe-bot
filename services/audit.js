// services/audit.js
// FICA Centralized Audit Logging Service

const { PrismaClient } = require('@prisma/client');
const prisma = require('./prisma-client');

/**
 * Creates an immutable audit trail for sensitive administrative actions.
 * * @param {Object} entry
 * @param {string} entry.actorId - Who did it? (Admin ID, Phone, or 'SYSTEM')
 * @param {string} entry.role - 'SUPER_ADMIN', 'CHURCH_ADMIN', 'SYSTEM'
 * @param {string} entry.action - e.g., 'UPDATE_FEE', 'APPROVE_KYB'
 * @param {string} entry.entity - The database table affected (e.g., 'ServicePrice')
 * @param {string} entry.entityId - The specific ID or Code of the row changed
 * @param {Object} [entry.metadata] - JSON object containing { oldVal, newVal }
 * @param {string} [entry.ipAddress] - Network IP for security tracing
 */
async function logAction(entry) {
    try {
        await prisma.auditLog.create({
            data: {
                actorId: String(entry.actorId),
                role: entry.role || 'SYSTEM',
                action: entry.action,
                entity: entry.entity,
                entityId: String(entry.entityId),
                metadata: entry.metadata || {},
                ipAddress: entry.ipAddress || null
            }
        });
        
        console.log(`📝 Audit Logged: [${entry.action}] by ${entry.actorId}`);
    } catch (error) {
        console.error('❌ CRITICAL: Failed to write to Audit Log:', error);
        // We catch the error so a logging failure doesn't crash the user's transaction,
        // but it is heavily logged to the console for DevOps to investigate.
    }
}

module.exports = { logAction };