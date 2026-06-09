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
    const entityId = p.id;

    if (typeof entityType !== 'string' || typeof entityId !== 'string') {
        return null;
    }

    return {
        entityType,
        entityId,
        data: p,
    };
}
