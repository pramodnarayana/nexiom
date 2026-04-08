export type CursorStrategy = 'SystemModstamp' | 'LastModifiedDate' | 'CreatedDate' | (string & Record<never, never>);
export type ExecutionPath = 'REST' | 'BULK_V2' | 'CDC';
const VALID_EXECUTION_PATHS: ReadonlySet<string> = new Set<ExecutionPath>(['REST', 'BULK_V2', 'CDC']);
export interface ConnectionHintResolver {
    (appName: string, objectName: string, connectionId: string): Promise<ObjectHint | undefined>;
}

let customResolver: ConnectionHintResolver | null = null;
export function setOptimizationResolver(resolver: ConnectionHintResolver) {
    customResolver = resolver;
}
export function clearOptimizationResolver() {
    customResolver = null;
}

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

        if (connectionId && customResolver) {
            try {
                const dbHint = await customResolver(appName, objectName, connectionId);
                if (dbHint && Object.keys(dbHint).length > 0) {
                    return { ...staticHint, ...dbHint };
                }
            } catch (e) {
                console.debug('OptimizationService.getHint: custom resolver failed, falling back to static registry', {
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