import { sql } from 'drizzle-orm';

export type TmsWriterStrategy = (
    tx: { execute: (query: unknown) => Promise<unknown> },
    schemaName: string,
    base: { traceId: string; replicaId: string; sourceId: string; dataSourceId: string },
    data: Record<string, unknown>
) => Promise<void>;

// Helper to convert unknown values to nullable strings
export const str = (v: unknown): string | null => {
    if (typeof v === 'string') return v;
    if (typeof v === 'boolean' || typeof v === 'number') return String(v);
    return null;
};

// Common fields present in all TMS entities
export function commonFields(data: Record<string, unknown>) {
    return {
        displayName: str(data['displayName']),
        tmsType: str(data['tmsType']),
        billingStreet: str(data['billingStreet']),
        billingCity: str(data['billingCity']),
        billingState: str(data['billingState']),
        billingPostalCode: str(data['billingPostalCode']),
        billingCountry: str(data['billingCountry']),
        phone: str(data['phone']),
        fax: str(data['fax']),
        email: str(data['email']),
    };
}

// Generic upsert helper for TMS entities using native drizzle-orm sql
export async function upsert(
    tx: { execute: (query: unknown) => Promise<unknown> },
    schemaName: string,
    tableName: string,
    base: { traceId: string; replicaId: string; sourceId: string; dataSourceId: string },
    extras: Record<string, unknown>
) {
    const values: Record<string, unknown> = { ...base, ...extras };
    const columns = Object.keys(values).filter(k => values[k] !== undefined && values[k] !== null);
    
    // Convert camelCase to snake_case for DB columns
    const snakeCols = columns.map(c => c.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`));
    const colNames = sql.raw(snakeCols.map(c => `"${c}"`).join(', '));
    const placeholders = sql.join(columns.map(c => sql`${values[c]}`), sql`, `);
    
    // ON CONFLICT (source_id) DO UPDATE SET ...
    const updates = snakeCols.map(c => `"${c}" = COALESCE(EXCLUDED."${c}", "${tableName}"."${c}")`).join(', ');
    
    const query = sql`
        INSERT INTO ${sql.identifier(schemaName)}.${sql.identifier(tableName)} (${colNames})
        VALUES (${placeholders})
        ON CONFLICT ("source_id")
        DO UPDATE SET ${sql.raw(updates)};
    `;
    
    await tx.execute(query);
}
