import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { QueueService, QueueName } from "@nexiom/queue";
import { Client as PgClient, Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProvisionDatabaseEvent } from "./provision-database.event.js";

/**
 * TenantProvisionWorker
 *
 * Consumes messages from the TenantProvisionQueue and physically provisions
 * isolated Postgres databases for each tenant slot in the warm pool.
 *
 * Separation of concerns:
 *  - This worker is the ONLY process with CREATEDB privileges.
 *  - The API control plane (CapacityManagerService) dispatches messages but
 *    never directly executes DDL.
 *
 * A single failed provision is retried by SQS up to maxReceiveCount times
 * before routing to the DLQ for operator alerting.
 */
@Injectable()
export class TenantProvisionWorker implements OnModuleInit {
  private readonly logger = new Logger(TenantProvisionWorker.name);

  constructor(private readonly queueService: QueueService) {}

  onModuleInit() {
    this.queueService.consume(
      QueueName.TenantProvisionQueue,
      async (event: ProvisionDatabaseEvent) => {
        this.logger.log(
          `Received ProvisionDatabaseEvent — poolSlotId=${event.poolSlotId}`,
        );
        await this.provision(event);
      },
    );
  }

  /**
   * Provisions a new database in the warm pool:
   *  1. CREATE DATABASE nexiom_tenant_<poolSlotId>
   *  2. Run all tenant-schema Drizzle migrations
   *  3. Register it in tenant_storage_registry with status=WARM
   */
  private async provision(event: ProvisionDatabaseEvent): Promise<void> {
    const { poolSlotId, hostUrl } = event;
    const dbName = `nexiom_tenant_${poolSlotId.replace(/-/g, "_")}`;

    // ── Step 1: CREATE DATABASE ────────────────────────────────────────────
    await this.createDatabase(dbName);

    // ── Step 2: Run tenant-schema migrations ──────────────────────────────
    await this.runMigrations(dbName, hostUrl);

    // ── Step 3: Register as WARM in the global registry ───────────────────
    await this.registerWarmSlot(poolSlotId);

    this.logger.log(
      `✓ Warm database ready — poolSlotId=${poolSlotId}, dbName=${dbName}`,
    );
  }

  private async createDatabase(dbName: string): Promise<void> {
    // Sanitize: only alphanumeric + underscores to prevent SQL injection
    if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
      throw new Error(`Invalid tenant database name: "${dbName}"`);
    }

    const adminClient = new PgClient({
      connectionString: process.env.DATABASE_URL,
    });
    await adminClient.connect();

    try {
      const existing = await adminClient.query(
        `SELECT 1 FROM pg_database WHERE datname = $1`,
        [dbName],
      );
      if ((existing.rowCount ?? 0) === 0) {
        await adminClient.query(`CREATE DATABASE "${dbName}"`);
        this.logger.log(`  ✓ Created database: ${dbName}`);
      } else {
        this.logger.warn(`  ⚠️  Database already exists: ${dbName}`);
      }
    } finally {
      await adminClient.end();
    }
  }

  private async runMigrations(dbName: string, hostUrl: string): Promise<void> {
    const tenantUrl = `${hostUrl.replace(/\/$/, "")}/${dbName}`;

    const rootDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../",
    );
    const migrationsFolder = path.join(
      rootDir,
      "packages/database/drizzle/tenant",
    );

    const pool = new Pool({ connectionString: tenantUrl, max: 2 });
    try {
      const db = drizzle(pool);
      await migrate(db, { migrationsFolder });
      this.logger.log(`  ✓ Migrations applied to: ${dbName}`);
    } finally {
      await pool.end();
    }
  }

  private async registerWarmSlot(poolSlotId: string): Promise<void> {
    const adminClient = new PgClient({
      connectionString: process.env.DATABASE_URL,
    });
    await adminClient.connect();

    try {
      // Update the INITIALIZING slot to WARM
      await adminClient.query(
        `UPDATE tenant_storage_registry
         SET status = 'WARM', updated_at = NOW()
         WHERE tenant_id = $1`,
        [`WARM-${poolSlotId}`],
      );
      this.logger.log(
        `  ✓ Registered WARM slot in registry: WARM-${poolSlotId}`,
      );
    } finally {
      await adminClient.end();
    }
  }
}
