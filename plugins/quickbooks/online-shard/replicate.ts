import type { ReplicaEntityPayload } from '@soopa/piece-framework';

/**
 * Extracts a QuickBooks entity from the webhook payload.
 * QuickBooks CDC payload contains entities under "entities" array.
 */
export async function ReplicateQBObject(payload: unknown): Promise<ReplicaEntityPayload | null> {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    // Typical QB payload wrapper from our webhook ingress might look like { name: 'Customer', id: '123', operation: 'Create', ... }
    const p = payload as Record<string, unknown>;
    
    // Note: The actual shape depends on how the QB piece parses the webhook in the gateway.
    // For now, we assume a generic normalized format passed down from L1.
    const entityType = p.name || p.type;
    let entityId = p.id ?? p.Id;

    // Coerce numeric IDs to strings
    if (typeof entityId === 'number') {
        entityId = String(entityId);
    }

    if (typeof entityType !== 'string' || typeof entityId !== 'string') {
        return null;
    }

    // Reject empty or whitespace-only IDs and types
    if (entityId.trim().length === 0 || entityType.trim().length === 0) {
        return null;
    }

    return {
        entityType,
        entityId,
        data: p,
    };
}
