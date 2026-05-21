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
export declare function PrepareQBUpdatePayload(payload: Record<string, any>, destId?: string, destState?: Record<string, any>): Promise<Record<string, any>>;
