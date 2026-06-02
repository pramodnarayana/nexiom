import { sql, SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

/**
 * DynamicSchemaBuilder
 *
 * Enterprise-grade query builder that bypasses static Drizzle ORM schemas
 * at runtime. It dynamically constructs parameterized SQL strings
 * for UPSERTs (INSERT ... ON CONFLICT DO UPDATE) based on canonical metadata.
 */
export class DynamicSchemaBuilder {
    /**
     * Validates that a string is a safe SQL identifier.
     * Identifiers must start with a letter or underscore, followed by alphanumerics or underscores.
     */
    private static validateIdentifier(identifier: string, name: string): void {
        const identifierRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
        if (!identifierRegex.test(identifier)) {
            throw new Error(
                `Invalid SQL identifier for ${name}: "${identifier}". ` +
                `Identifiers must match /^[a-zA-Z_][a-zA-Z0-9_]*$/`
            );
        }
    }

    /**
     * Constructs a parameterized UPSERT query.
     *
     * @param schemaName - The database schema (e.g. 'tenant_abc')
     * @param tableName - The physical database table name (e.g. 'tms_carrier')
     * @param uniqueKey - The column name that determines uniqueness (e.g. 'source_id')
     * @param data - The payload to insert/update (camelCase fields mapped to snake_case columns)
     * @param includeReturning - Whether to include RETURNING * clause (default: true)
     * @returns A Drizzle SQL template object ready for execution via db.execute()
     */
    static buildUpsert(
        schemaName: string,
        tableName: string,
        uniqueKey: string,
        data: Record<string, unknown>,
        includeReturning: boolean = true,
        updatedAtColumn: string | null = 'updated_at'
    ): SQL {
        if (!data || Object.keys(data).length === 0) {
            throw new Error('Payload cannot be empty');
        }

        // Validate schema and table name identifiers
        this.validateIdentifier(schemaName, 'schemaName');
        this.validateIdentifier(tableName, 'tableName');
        this.validateIdentifier(uniqueKey, 'uniqueKey');

        // Convert JS camelCase keys to PostgreSQL snake_case columns
        const columns: string[] = [];
        const values: unknown[] = [];

        for (const [key, val] of Object.entries(data)) {
            // Convert 'displayName' to 'display_name'
            const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
            // Validate each derived column name
            this.validateIdentifier(snakeKey, `column (derived from '${key}')`);
            columns.push(snakeKey);
            values.push(val);
        }

        // We must include the uniqueKey if it isn't already present in the data.
        const uniqueKeySnake = uniqueKey.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
        // Validate the derived unique key
        this.validateIdentifier(uniqueKeySnake, `uniqueKey (derived from '${uniqueKey}')`);
        if (!columns.includes(uniqueKeySnake)) {
            throw new Error(`Unique key '${uniqueKey}' is missing from payload`);
        }

        // Build INSERT INTO "schema"."table_name" ("col1", "col2")
        const insertColumns = sql.raw(columns.map(c => `"${c}"`).join(', '));
        
        // Build VALUES ($1, $2) using sql.join
        const insertValues = sql.join(
            values.map(v => sql`${v}`),
            sql`, `
        );

        // Build ON CONFLICT ("unique_key") DO UPDATE SET "col1" = EXCLUDED."col1", ...
        const updateAssignments = sql.join(
            columns
                .filter(c => c !== uniqueKeySnake && c !== 'created_at')
                .map(c => sql.raw(`"${c}" = EXCLUDED."${c}"`)),
            sql`, `
        );

        let onConflictClause: SQL;
        if (updateAssignments.queryChunks.length > 0) {
            if (updatedAtColumn !== null) {
                const updatedAtColumnSnake = updatedAtColumn.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
                this.validateIdentifier(updatedAtColumnSnake, 'updatedAtColumn');
                onConflictClause = sql`ON CONFLICT ("${sql.raw(uniqueKeySnake)}") DO UPDATE SET ${updateAssignments}, "${sql.raw(updatedAtColumnSnake)}" = NOW()`;
            } else {
                onConflictClause = sql`ON CONFLICT ("${sql.raw(uniqueKeySnake)}") DO UPDATE SET ${updateAssignments}`;
            }
        } else {
            onConflictClause = sql`ON CONFLICT ("${sql.raw(uniqueKeySnake)}") DO NOTHING`;
        }

        const returningClause = includeReturning ? sql`RETURNING *` : sql``;

        return sql`
            INSERT INTO ${sql.raw(`"${schemaName}"."${tableName}"`)} (${insertColumns})
            VALUES (${insertValues})
            ${onConflictClause}
            ${returningClause};
        `;
    }
}
