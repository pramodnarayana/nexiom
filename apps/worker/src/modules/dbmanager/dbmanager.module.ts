import { Module, Global } from "@nestjs/common";
import {
  TenantDatabaseManager,
  DB_MANAGER,
  type CredentialResolver,
} from "@nexiom/dbmanager";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";
import { DbModule } from "../../db/db.module.js";
import { DATABASE_CONNECTION } from "@nexiom/database";
import type { DrizzleDb } from "@nexiom/database";

import {
  ApplicationLoaderModule,
  PipelineHookBrokerService,
} from "@nexiom/engine";

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
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error("DATABASE_URL is required to build credential resolver");
  }

  let userInfo = "";
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

@Global()
@Module({
  imports: [DbModule, ApplicationLoaderModule],
  providers: [
    {
      provide: DB_MANAGER,
      useFactory: (drizzleDb: DrizzleDb, broker: PipelineHookBrokerService) => {
        const domainProvisionerResolver = (
          appName: string,
          appProfile: string,
        ) => {
          return async (tenantDb: DrizzleDb, schemaName: string) => {
            try {
              await broker.provisionDomain(
                appName,
                appProfile,
                tenantDb,
                schemaName,
              );
            } catch (err) {
              console.error(
                `Broker provisionDomain failed for ${appName}/${appProfile}:`,
                err,
              );
              throw err;
            }
          };
        };

        return new TenantDatabaseManager(
          drizzleDb,
          (connectionString: string) => {
            const pool = new Pool({
              connectionString,
              // Keep pool size small since the worker maintains connections across many tenants.
              // Budget: 100 tenants × 5 = 500 max connections (well within limits).
              max: 5,
              idleTimeoutMillis: 60_000,
              connectionTimeoutMillis: 5_000,
              keepAlive: true,
              keepAliveInitialDelayMillis: 10_000,
            });

            pool.on("error", (err) => {
              let dbName = connectionString;
              try {
                const url = new URL(connectionString);
                dbName =
                  url.pathname.replace(/^\/+/, "") ||
                  url.searchParams.get("dbname") ||
                  connectionString;
              } catch {
                // Fall back to original connectionString if URL parsing fails
              }
              console.error(
                `Unexpected error on idle tenant DB client [${dbName}]`,
                err,
              );
            });

            return drizzle(pool, { schema }) as unknown as DrizzleDb;
          },
          domainProvisionerResolver, // domainProvisionerResolver
          undefined, // logger
          buildCredentialResolver(), // inject auth from env at connection time
        );
      },
      inject: [DATABASE_CONNECTION, PipelineHookBrokerService],
    },
  ],
  exports: [DB_MANAGER],
})
export class DbManagerModule {}
