export type CursorStrategy = 'SystemModstamp' | 'LastModifiedDate' | 'CreatedDate' | (string & Record<never, never>);
export type ExecutionPath = 'REST' | 'BULK_V2' | 'CDC';

import { getDb, connectorObjectProfiles } from '@nexiom/database';
import { eq, and } from 'drizzle-orm';

export interface ObjectHint {
    /** Force a specific cursor field instead of auto-selecting. */
    cursorPrecedence?: CursorStrategy[];
    /** Record threshold above which the engine switches to Bulk API 2.0. */
    bulkThreshold?: number;   // default: 5000
    /** Auto-join these child relationship names from DescribeSObject.childRelationships. */
    autoJoin?: string[];
    /** Force a specific execution path (overrides auto-detection). */
    preferPath?: ExecutionPath;
    /** Extra SELECT columns always included regardless of user mappings. */
    requiredFields?: string[];
}

export interface AppHints {
    [objectName: string]: ObjectHint;
}

export interface OptimizationRegistry {
    [appName: string]: AppHints;
}

export const OPTIMIZATION_REGISTRY: OptimizationRegistry = {
    salesforce: {
        Contact: {
            cursorPrecedence: ['SystemModstamp', 'LastModifiedDate'],
            requiredFields: ['Email', 'AccountId'],
        },
        Invoice__c: {
            cursorPrecedence: ['SystemModstamp'],
            autoJoin: ['InvoiceLineItems__r'],
            bulkThreshold: 10_000,
        },
        Opportunity: {
            autoJoin: ['OpportunityLineItems'],
            cursorPrecedence: ['SystemModstamp', 'LastModifiedDate'],
        },
    },
    quickbooks: {
        Invoice: {
            autoJoin: ['Line'],
            // preferPath: 'CDC' — only set if ≥ 5 entity types are polled simultaneously
        },
        Customer: {
            // Customer specific hints if necessary
        }
    },
};

export function defineHints(appName: string, hints: AppHints): void {
    OPTIMIZATION_REGISTRY[appName] = { ...OPTIMIZATION_REGISTRY[appName], ...hints };
}

export class OptimizationService {
    /**
     * Look up execution hints for a specific object.
     *
     * @param appName      - Canonical app name (used for static OPTIMIZATION_REGISTRY fallback).
     * @param objectName   - Vendor object name e.g. 'rtms__Load__c'.
     * @param connectionId - Optional app_connection.id. When provided, queries the DB-backed
     *                       profile cache (scoped per-connection for custom object support).
     *                       When absent, falls straight through to the static registry.
     */
    async getHint(appName: string, objectName: string, connectionId?: string): Promise<ObjectHint | undefined> {
        // Always resolve the static hint first — it is the baseline.
        const staticHint = OPTIMIZATION_REGISTRY[appName]?.[objectName];

        if (connectionId) {
            try {
                const db = getDb();
                const result = await db.select()
                    .from(connectorObjectProfiles)
                    .where(
                        and(
                            eq(connectorObjectProfiles.connectionId, connectionId),
                            eq(connectorObjectProfiles.objectName, objectName)
                        )
                    )
                    .limit(1);

                if (result.length > 0) {
                    // profile stores the full Metadata Discovery payload — do NOT cast
                    // it wholesale to ObjectHint. Pick only the known optimization keys
                    // so discovery data never silently overrides engine behaviour.
                    const raw = result[0].profile as Record<string, unknown>;
                    const dbHint: ObjectHint = {};

                    if (Array.isArray(raw['cursorPrecedence'])) {
                        dbHint.cursorPrecedence = raw['cursorPrecedence'] as CursorStrategy[];
                    }
                    if (typeof raw['bulkThreshold'] === 'number') {
                        dbHint.bulkThreshold = raw['bulkThreshold'];
                    }
                    if (Array.isArray(raw['autoJoin'])) {
                        dbHint.autoJoin = raw['autoJoin'] as string[];
                    }
                    if (typeof raw['preferPath'] === 'string') {
                        dbHint.preferPath = raw['preferPath'] as ExecutionPath;
                    }
                    if (Array.isArray(raw['requiredFields'])) {
                        dbHint.requiredFields = raw['requiredFields'] as string[];
                    }

                    // DB-backed optimization keys take precedence over static registry
                    // for matched keys; static registry fills in any gaps.
                    if (Object.keys(dbHint).length > 0) {
                        return { ...staticHint, ...dbHint };
                    }
                }
            } catch (e) {
                // DB might not be connected or missing environment variables.
                // Safe fallback to static registry.
                console.debug('OptimizationService.getHint: DB lookup failed, falling back to static registry', {
                    appName,
                    objectName,
                    connectionId,
                    err: e instanceof Error ? e.message : String(e),
                });
            }
        }

        return staticHint;
    }
}

export const optimizationService = new OptimizationService();
