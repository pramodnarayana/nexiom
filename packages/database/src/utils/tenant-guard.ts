import { eq, and, SQL, AnyColumn } from 'drizzle-orm';

/**
 * Short-term Drizzle query wrapper safeguard.
 * Injects the required tenantId filter to emulate application-layer Row-Level Security (RLS).
 * Rejects queries where a tenantId is missing.
 */
export function withTenantGuard(
    tenantColumn: AnyColumn,
    tenantId: string,
    extraConditions?: SQL
): SQL {
    if (!tenantId) {
        throw new Error('FATAL: Attempted multi-tenant database access without a valid tenantId filter.');
    }

    const tenantFilter = eq(tenantColumn, tenantId);

    return extraConditions ? and(tenantFilter, extraConditions)! : tenantFilter;
}
