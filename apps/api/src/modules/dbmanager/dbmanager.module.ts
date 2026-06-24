import { Module, Global } from '@nestjs/common';
import {
  TenantDatabaseManager,
  DB_MANAGER,
  type CredentialResolver,
} from '@soopa/dbmanager';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@soopa/database';
import { DatabaseModule } from '@soopa/database';
import { DATABASE_CONNECTION } from '@soopa/database';
import type { DrizzleDb } from '@soopa/database';

import { PiecesModule } from '@soopa/piece-registry';

/**
 * Builds a CredentialResolver from the current process's DATABASE_URL.
 *
 * The tenant_storage_registry stores only host topology (no credentials).
 * At connection time, this resolver injects the auth from DATABASE_URL
 * into the credential-less registry host URL.
 *
 * In production, replace with a secrets manager lookup (AWS Secrets Manager,
 * HashiCorp Vault, etc.) keyed on the host or region context.
 */
function buildCredentialResolver(): CredentialResolver {
  const rawUrl = process.env.DATABASE_URL ?? '';
  let userInfo = '';
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username) {
      userInfo = parsed.password
        ? `${parsed.username}:${parsed.password}@`
        : `${parsed.username}@`;
    }
  } catch {
    // If DATABASE_URL is malformed, fall back to passing the host URL as-is.
  }

  return (hostUrl: string): string => {
    if (!userInfo) return hostUrl;
    // Only inject if the stored URL has no userinfo already.
    try {
      const parsed = new URL(hostUrl);
      if (!parsed.username) {
        return hostUrl.replace(
          `${parsed.protocol}//`,
          `${parsed.protocol}//${userInfo}`,
        );
      }
    } catch {
      // Non-parseable hostUrl — return unchanged.
    }
    return hostUrl;
  };
}

import {
  MIGRATION_RUNNER,
  MigratorModule,
  MigrationRunnerPort,
} from '@soopa/migrator';

@Global()
@Module({
  imports: [DatabaseModule, PiecesModule, MigratorModule],
  providers: [
    {
      provide: DB_MANAGER,
      useFactory: (drizzleDb: DrizzleDb, migrator: MigrationRunnerPort) => {
        return new TenantDatabaseManager(
          drizzleDb,
          (connectionString: string) => {
            const pool = new Pool({
              connectionString,
              max: 20,
              idleTimeoutMillis: 30_000,
              connectionTimeoutMillis: 5_000,
            });
            return drizzle(pool, { schema }) as unknown as DrizzleDb;
          },
          migrator,
          undefined, // logger — use default
          buildCredentialResolver(), // inject auth from env at connection time
        );
      },
      inject: [DATABASE_CONNECTION, MIGRATION_RUNNER],
    },
  ],
  exports: [DB_MANAGER],
})
export class DbManagerModule {}
