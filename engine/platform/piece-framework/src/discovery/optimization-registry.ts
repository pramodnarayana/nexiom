export type CursorStrategy = 'SystemModstamp' | 'LastModifiedDate' | 'CreatedDate' | (string & Record<never, never>);
export type ExecutionPath = 'REST' | 'BULK_V2' | 'CDC';
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

function cloneHint(hint: ObjectHint): ObjectHint {
    return {
        ...hint,
        cursorPrecedence: hint.cursorPrecedence ? [...hint.cursorPrecedence] : undefined,
        autoJoin: hint.autoJoin ? [...hint.autoJoin] : undefined,
        requiredFields: hint.requiredFields ? [...hint.requiredFields] : undefined,
    };
}

export const OPTIMIZATION_REGISTRY: OptimizationRegistry = Object.create(null);
OPTIMIZATION_REGISTRY.salesforce = Object.create(null);
OPTIMIZATION_REGISTRY.salesforce.Contact = {
    cursorPrecedence: ['SystemModstamp', 'LastModifiedDate'],
    requiredFields: ['Email', 'AccountId'],
};
OPTIMIZATION_REGISTRY.salesforce.Invoice__c = {
    cursorPrecedence: ['SystemModstamp'],
    autoJoin: ['InvoiceLineItems__r'],
    bulkThreshold: 10_000,
};
OPTIMIZATION_REGISTRY.salesforce.Opportunity = {
    autoJoin: ['OpportunityLineItems'],
    cursorPrecedence: ['SystemModstamp', 'LastModifiedDate'],
};
OPTIMIZATION_REGISTRY.quickbooks = Object.create(null);
OPTIMIZATION_REGISTRY.quickbooks.Invoice = {
    autoJoin: ['Line'],
    // preferPath: 'CDC' — only set if ≥ 5 entity types are polled simultaneously
};
OPTIMIZATION_REGISTRY.quickbooks.Customer = {
    // Customer specific hints if necessary
};

export function defineHints(appName: string, hints: AppHints): void {
    // Initialize app entry if missing
    if (!OPTIMIZATION_REGISTRY[appName]) {
        OPTIMIZATION_REGISTRY[appName] = Object.create(null);
    }

    // Merge each object hint individually to preserve existing properties
    for (const objectName of Object.keys(hints)) {
        const existing = OPTIMIZATION_REGISTRY[appName][objectName];
        const incoming = hints[objectName];

        // Clone both existing and incoming hints before merging
        const clonedExisting = existing ? cloneHint(existing) : {};
        const clonedIncoming = cloneHint(incoming);

        OPTIMIZATION_REGISTRY[appName][objectName] = {
            ...clonedExisting,
            ...clonedIncoming,
        };
    }
}

export class OptimizationService {
    /**
     * Look up execution hints for a specific object.
     *
     * @param appName      - Canonical app name (used for static OPTIMIZATION_REGISTRY fallback).
     * @param objectName   - Vendor object name e.g. 'rtms__Load__c'.
     * @param connectionId - Optional app_connection.id. When provided, the registry consults the
     *                       pluggable ConnectionHintResolver (scoped per-connection for custom object support).
     *                       When absent, it falls back to the static registry.
     */
    async getHint(appName: string, objectName: string, connectionId?: string): Promise<ObjectHint | undefined> {
        // Always resolve the static hint first — it is the baseline.
        const staticHint = OPTIMIZATION_REGISTRY[appName]?.[objectName];

        if (connectionId && customResolver) {
            try {
                const resolverHint = await customResolver(appName, objectName, connectionId);
                if (resolverHint && Object.keys(resolverHint).length > 0) {
                    // Return a defensive copy with cloned arrays
                    return cloneHint({ ...staticHint, ...resolverHint });
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

        // Return a defensive copy of the static hint
        return staticHint ? cloneHint(staticHint) : undefined;
    }
}

export const optimizationService = new OptimizationService();