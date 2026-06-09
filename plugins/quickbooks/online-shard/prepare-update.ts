/**
 * Injects QuickBooks-specific required fields (Id, SyncToken) into the payload
 * before it is sent to the piece for an Update operation.
 *
 * Rules applied here (in order):
 *  1. Strip internal Nexiom metadata fields (any key prefixed with `_`, e.g. `_routingEnvelope`).
 *     QB rejects these with ValidationFault code 2010 ("unsupported property").
 *  2. Inject `Id` from `destId` so QB treats this as an update, not a create.
 *  3. Inject `SyncToken` from `destState` so QB accepts the optimistic-lock update.
 *     If `destState` has no SyncToken (stale GEM / first sync), omit it and let
 *     the QB piece's auto-refresh rule (isSyncTokenError → fetchFreshSyncToken)
 *     recover from the 400 response automatically.
 */
export async function PrepareQBUpdatePayload(
    payload: Record<string, unknown>,
    destId?: string,
    destState?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    // ── 1. Strip internal pipeline metadata ──────────────────────────────────
    // Keys starting with `_` (e.g. `_routingEnvelope`) are Nexiom-internal and must never
    // be forwarded to any third-party API.
    const finalPayload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
        if (!k.startsWith('_')) {
            finalPayload[k] = v;
        }
    }

    // ── 2. Inject destination entity Id ──────────────────────────────────────
    if (destId) {
        finalPayload['Id'] = destId;
    }

    // ── 3. Inject SyncToken for optimistic-lock updates ───────────────────────
    // QB requires the current SyncToken on every write to an existing entity.
    // `destState` is the raw QB API response body stored in replica_entity.data,
    // shaped as { [EntityType]: { SyncToken: "N", Id: "X", ... } }.
    // We unwrap the entity envelope to find the SyncToken.
    // If it is missing here the QB piece will auto-refresh via GET and retry.
    let syncToken: string | undefined;
    if (destState) {
        // Direct key (legacy or already-unwrapped)
        syncToken = destState['SyncToken'] as string | undefined ?? destState['syncToken'] as string | undefined;
        if (!syncToken) {
            // Unwrap nested entity envelope: { Vendor: { SyncToken: '0' } }
            const entityKey = Object.keys(destState).find(k =>
                k !== 'time' && typeof destState[k] === 'object' && destState[k] !== null
            );
            if (entityKey) {
                const nested = destState[entityKey] as Record<string, unknown>;
                syncToken = nested['SyncToken'] as string | undefined ?? nested['syncToken'] as string | undefined;
            }
        }
    }
    if (syncToken) {
        finalPayload['SyncToken'] = syncToken;
    }

    // ── 4. Inject sparse and domain ──────────────────────────────────────────
    // For QB Online updates, 'sparse' must be true so that fields not provided
    // in the payload are not overwritten with nulls.
    finalPayload['sparse'] = true;
    finalPayload['domain'] = 'QBO';

    return finalPayload;
}
