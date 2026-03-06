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
    async getHint(appName: string, objectName: string): Promise<ObjectHint | undefined> {
        try {
            const db = getDb();
            const result = await db.select()
                .from(connectorObjectProfiles)
                .where(
                    and(
                        eq(connectorObjectProfiles.appName, appName),
                        eq(connectorObjectProfiles.objectName, objectName)
                    )
                )
                .limit(1);

            if (result.length > 0) {
                return result[0].profile as ObjectHint;
            }
        } catch (e) {
            console.debug('Failed to fetch ObjectHint from Database:', e);
            // DB might not be connected or missing environment variables.
            // Safe fallback to static registry.
        }

        return OPTIMIZATION_REGISTRY[appName]?.[objectName];
    }
}

export const optimizationService = new OptimizationService();
