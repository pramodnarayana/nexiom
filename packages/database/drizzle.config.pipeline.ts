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

const pipelineDbUrl = process.env.TENANT_DATABASE_URL || process.env.DATABASE_URL;
if (!pipelineDbUrl) {
    throw new Error('[drizzle.config.pipeline] Neither TENANT_DATABASE_URL nor DATABASE_URL is set.');
}

export default {
    schema: ['./dist/schema/tenant/pipeline-static.js'],
    out: './drizzle/pipeline',
    dialect: 'postgresql',
    dbCredentials: {
        url: pipelineDbUrl,
    },
} satisfies Config;
