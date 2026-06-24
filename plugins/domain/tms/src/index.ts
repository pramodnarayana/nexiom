// TMS Domain Layer — @soopa/domain-tms
// Shared across ALL TMS source connectors (Revenova, McLeod, TMW…).

export * from './schema/tms-schema.js';
export * from './schema/tms-identifier-validator.js';
export * from './tms-normalized-writer.js';
export * from './tms-target-builder.js';

import { join } from 'path';

export function getTmsMigrationsFolder(): string {
    // When compiled, index.js is in dist/. We need to go up one level to domain/tms and into drizzle/migrations.
    return join(__dirname, '../drizzle/migrations');
}
