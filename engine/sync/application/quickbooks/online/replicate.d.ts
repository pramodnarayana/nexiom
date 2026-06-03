import type { ReplicaEntityPayload } from '@soopa/piece-framework';
/**
 * Extracts a QuickBooks entity from the webhook payload.
 * QuickBooks CDC payload contains entities under "entities" array.
 */
export declare function ReplicateQBObject(payload: unknown): Promise<ReplicaEntityPayload | null>;
