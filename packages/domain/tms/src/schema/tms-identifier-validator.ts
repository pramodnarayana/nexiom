/**
 * validateTmsIdentifier
 *
 * Guards all DDL in the TMS domain package against SQL injection and
 * Postgres identifier limits.
 *
 * Rules:
 *  - Must match /^ws_[a-z0-9_]+$/ — the Nexiom tenant schema convention
 *  - Must not exceed 63 characters (Postgres NAMEDATALEN - 1)
 *
 * Mirrors the SAFE_SCHEMA_NAME_RE guard in SqlDatabaseManager so domain
 * DDL has the same protection as the platform DDL layer.
 *
 * @throws {Error} if the identifier is invalid
 */

const SAFE_SCHEMA_NAME_RE = /^ws_[a-z0-9_]+$/;
const PG_IDENTIFIER_MAX   = 63;

export function validateTmsIdentifier(schemaName: string): void {
    if (!SAFE_SCHEMA_NAME_RE.test(schemaName)) {
        throw new Error(
            `[domain-tms] Invalid schemaName "${schemaName}". ` +
            `Expected format: ws_<workspaceId> using only lowercase letters, digits, and underscores.`,
        );
    }
    if (schemaName.length > PG_IDENTIFIER_MAX) {
        throw new Error(
            `[domain-tms] schemaName "${schemaName}" exceeds Postgres identifier limit (${PG_IDENTIFIER_MAX} chars).`,
        );
    }
}
