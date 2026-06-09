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
    let rawEntityType = p.name || p.type;
    let rawEntityId = p.id ?? p.Id;

    // Coerce numeric IDs to strings
    if (typeof rawEntityId === 'number') {
        rawEntityId = String(rawEntityId);
    }

    if (typeof rawEntityType !== 'string' || typeof rawEntityId !== 'string') {
        return null;
    }

    const entityType = rawEntityType.trim();
    const entityId = rawEntityId.trim();

    // Reject empty or whitespace-only IDs and types
    if (entityId.length === 0 || entityType.length === 0) {
        return null;
    }

    return {
        entityType,
        entityId,
        data: p,
    };
}
