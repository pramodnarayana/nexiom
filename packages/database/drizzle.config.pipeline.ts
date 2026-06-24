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

if (!process.env.DATABASE_URL) {
    throw new Error('[drizzle.config.pipeline] DATABASE_URL is not set.');
}

export default {
    schema: ['./dist/schema/tenant/pipeline-static.js'],
    out: './drizzle/pipeline',
    dialect: 'postgresql',
    dbCredentials: {
        url: process.env.DATABASE_URL,
    },
} satisfies Config;
