"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReplicateQBObject = ReplicateQBObject;
/**
 * Extracts a QuickBooks entity from the webhook payload.
 * QuickBooks CDC payload contains entities under "entities" array.
 */
async function ReplicateQBObject(payload) {
    if (!payload || typeof payload !== 'object') {
        return null;
    }
    // Typical QB payload wrapper from our webhook ingress might look like { name: 'Customer', id: '123', operation: 'Create', ... }
    const p = payload;
    // Note: The actual shape depends on how the QB piece parses the webhook in the gateway.
    // For now, we assume a generic normalized format passed down from L1.
    const entityType = p.name || p.type;
    const entityId = p.id;
    if (!entityType || !entityId) {
        return null;
    }
    return {
        entityType,
        entityId,
        data: p,
    };
}
