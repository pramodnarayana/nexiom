import { Module, Global } from "@nestjs/common";
import { TenantDatabaseManager } from "@nexiom/dbmanager";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";
import { DbModule } from "../../db/db.module.js";
import { DATABASE_CONNECTION } from "@nexiom/database";
import type { DrizzleDb } from "@nexiom/database";

export const DB_MANAGER = "DATABASE_MANAGER";

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
              max: 20,
              idleTimeoutMillis: 30_000,
              connectionTimeoutMillis: 5_000,
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
