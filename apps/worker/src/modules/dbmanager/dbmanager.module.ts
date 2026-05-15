import { Module, Global } from "@nestjs/common";
import { TenantDatabaseManager, DB_MANAGER } from "@nexiom/dbmanager";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";
import { DbModule } from "../../db/db.module.js";
import { DATABASE_CONNECTION } from "@nexiom/database";
import type { DrizzleDb } from "@nexiom/database";

@Global()
@Module({
  imports: [DbModule],
  providers: [
    {
      provide: DB_MANAGER,
      useFactory: (drizzleDb: DrizzleDb) => {
        return new TenantDatabaseManager(
          drizzleDb,
          (connectionString: string) => {
            const pool = new Pool({
              connectionString,
              // Tenant pools are scoped to pipeline event processing.
              // max:5 is sufficient — tenant DBs handle one pipeline at a time.
              // Budget: 100 tenants × 5 = 500 max connections (well within limits).
              max: 5,
              idleTimeoutMillis: 60_000,
              connectionTimeoutMillis: 5_000,
              keepAlive: true,
              keepAliveInitialDelayMillis: 10_000,
            });

            pool.on("error", (err) => {
              console.error(
                `Unexpected error on idle tenant DB client [${connectionString.split("/").pop()}]`,
                err,
              );
            });

            return drizzle(pool, { schema }) as unknown as DrizzleDb;
          },
        );
      },
      inject: [DATABASE_CONNECTION],
    },
  ],
  exports: [DB_MANAGER],
})
export class DbManagerModule {}
