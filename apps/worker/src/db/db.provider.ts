import { Logger, Provider } from "@nestjs/common";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

import { DATABASE_CONNECTION } from "@soopa/database";

const logger = new Logger("DatabaseProvider");

export const databaseProvider: Provider = {
  provide: DATABASE_CONNECTION,
  useFactory: () => {
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
      // Prevent Postgres from silently closing idle pool connections at the TCP
      // level. Without keepAlive, the server drops the socket after a few minutes
      // of silence and pg-pool doesn't discover this until the next query attempt,
      // causing "Connection terminated unexpectedly" on cron ticks.
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    });

    const db = drizzle(pool, { schema });

    logger.log("Database connection pool established successfully.");

    return db;
  },
};
