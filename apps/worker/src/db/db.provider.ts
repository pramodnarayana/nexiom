import { Logger, Provider } from "@nestjs/common";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

import { DATABASE_CONNECTION } from "@nexiom/database";

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
    });

    const db = drizzle(pool, { schema });

    logger.log("Database connection pool established successfully.");

    return db;
  },
};
