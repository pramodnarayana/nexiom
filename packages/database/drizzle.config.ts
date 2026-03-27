import type { Config } from 'drizzle-kit';
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Expected working directory: packages/database/
// drizzle-kit reads this file from its own location — we use import.meta.url
// so the monorepo root is always correct regardless of where drizzle-kit is
// invoked from (pnpm db:migrate from root, CI, Docker, etc.).
const thisDir = dirname(fileURLToPath(import.meta.url));
const monorepoRoot = resolve(thisDir, '../..');

const apiEnv = resolve(monorepoRoot, 'apps/api/.env');
const rootEnv = resolve(monorepoRoot, '.env');

if (existsSync(apiEnv)) {
    config({ path: apiEnv, override: false });
} else if (existsSync(rootEnv)) {
    config({ path: rootEnv, override: false });
} else {
    // Neither .env file found — fall back to the existing process.env.
    // This is normal in CI/CD where DATABASE_URL is injected via environment.
    console.warn(
        `[drizzle.config] Neither ${apiEnv} nor ${rootEnv} was found. ` +
        `Falling back to process.env.DATABASE_URL. ` +
        `If you are running locally, create apps/api/.env with a DATABASE_URL entry.`,
    );
}

if (!process.env.DATABASE_URL) {
    throw new Error(
        '[drizzle.config] DATABASE_URL is not set.\n' +
        `  Expected .env at: ${apiEnv}\n` +
        `  Fallback .env at: ${rootEnv}\n` +
        '  If running in CI, ensure DATABASE_URL is exported in the environment.',
    );
}

// Schema points to the TypeScript source files directly. drizzle-kit uses
// jiti to parse TypeScript without a prior build step. We use a glob that
// targets individual schema files rather than the barrel index.ts so that
// jiti does not try to resolve the .js-extension re-exports used for ESM
// compatibility at runtime.
export default {
    schema: './src/schema/*.ts',
    out: './drizzle',
    dialect: 'postgresql',
    dbCredentials: {
        url: process.env.DATABASE_URL,
    },
} satisfies Config;
