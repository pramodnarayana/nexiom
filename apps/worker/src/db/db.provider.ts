import { Logger, Provider } from "@nestjs/common";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { join } from "node:path";
import * as schema from "./schema.js";

import { DATABASE_CONNECTION } from "@nexiom/database";

const logger = new Logger("DatabaseProvider");

/**
 * Resolves the absolute path to the drizzle migrations folder.
 * Uses process.cwd() which is always the apps/worker/ project root
 * regardless of whether the code runs as ESM source or compiled CJS in dist/.
 */
function migrationsPath(): string {
  return join(process.cwd(), "drizzle");
}

export const databaseProvider: Provider = {
  provide: DATABASE_CONNECTION,
  useFactory: async () => {
    const connectionString =
      process.env.DATABASE_POOLED_URL ?? process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "FATAL: DATABASE_POOLED_URL or DATABASE_URL is not defined. Set at least one in your .env before starting the server.",
      );
    }

    const pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    const db = drizzle(pool, { schema });

    // ─────────────────────────────────────────────────────────────────────────
    // Auto-apply all pending Drizzle migrations before any NestJS service
    // initializes. This is the enterprise-grade alternative to manually running
    // `pnpm db:migrate` and eliminates the class of bugs where the app boots
    // with a schema that is behind the codebase.
    //
    // Behaviour:
    //   • Already-applied migrations are skipped (idempotent).
    //   • A failed migration throws and prevents the app from starting.
    //   • No hardcoded table list — Drizzle tracks state in __drizzle_migrations.
    //
    // Production guidance:
    //   For large databases where ALTER TABLE locks are a concern, run migrations
    //   as a pre-deployment init container / CI step rather than here. In that
    //   case this call becomes a sub-millisecond no-op (all migrations already
    //   applied), preserving the safety guarantee at zero cost.
    // ─────────────────────────────────────────────────────────────────────────
    const migrationsFolder = migrationsPath();
    logger.log(`Applying pending migrations from: ${migrationsFolder}`);

    try {
      await migrate(db, { migrationsFolder });
      logger.log("Database migrations up to date.");
    } catch (error) {
      try {
        await pool.end();
      } catch (closeError) {
        logger.error(
          "Failed to cleanly close database pool on fatal migration error",
          closeError,
        );
      }
      logger.fatal(
        "FATAL: Database migration failed. The server will not start with an inconsistent schema.",
        error,
      );
      process.exit(1);
    }

    return db;
  },
};
