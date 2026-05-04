import type { Config } from 'drizzle-kit';
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const thisDir = dirname(fileURLToPath(import.meta.url));
const monorepoRoot = resolve(thisDir, '../..');

const apiEnv = resolve(monorepoRoot, 'apps/api/.env');
const rootEnv = resolve(monorepoRoot, '.env');

let eitherFound = false;
if (existsSync(apiEnv)) {
    config({ path: apiEnv, override: false });
    eitherFound = true;
}
if (existsSync(rootEnv)) {
    config({ path: rootEnv, override: false });
    eitherFound = true;
}
if (!eitherFound) {
    console.warn(
        `[drizzle.config.tenant] Neither ${apiEnv} nor ${rootEnv} was found. ` +
        `Falling back to process.env.TENANT_DATABASE_URL.`,
    );
}

// Tenant migrations run against a specific tenant DB.
// TENANT_DATABASE_URL must be set to the target tenant's connection string.
// For local dev and drizzle-kit generate, point at any accessible DB.
const tenantDbUrl = process.env.TENANT_DATABASE_URL || process.env.DATABASE_URL;
if (!tenantDbUrl) {
    throw new Error(
        '[drizzle.config.tenant] Neither TENANT_DATABASE_URL nor DATABASE_URL is set.\n' +
        '  Set TENANT_DATABASE_URL to the tenant DB connection string.',
    );
}

// Tenant-specific schema ONLY — connections, stitches, workspaces, cursors, etc.
// Global tables (identity, registry, pieces) are in drizzle.config.ts.
export default {
    schema: './dist/schema/tenant/**/*.js',
    out: './drizzle/tenant',
    dialect: 'postgresql',
    dbCredentials: {
        url: tenantDbUrl,
    },
} satisfies Config;
