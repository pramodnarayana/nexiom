import type { Config } from 'drizzle-kit';
import { config } from 'dotenv';
import { resolve } from 'node:path';

// drizzle-kit runs from packages/database/ — load the DATABASE_URL from the
// api's .env file (or the root .env) since there is no local .env here.
const monorepoRoot = resolve(process.cwd(), '../..');
config({ path: resolve(monorepoRoot, 'apps/api/.env'), override: false });
config({ path: resolve(monorepoRoot, '.env'), override: false });

if (!process.env.DATABASE_URL) {
    throw new Error(
        'DATABASE_URL is not set. Make sure apps/api/.env exists with a valid DATABASE_URL.',
    );
}

export default {
    schema: './dist/index.js',
    out: './drizzle',
    dialect: 'postgresql',
    dbCredentials: {
        url: process.env.DATABASE_URL,
    },
} satisfies Config;
