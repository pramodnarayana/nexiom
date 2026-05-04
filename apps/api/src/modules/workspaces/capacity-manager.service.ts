import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DATABASE_CONNECTION } from '@nexiom/database';
import type { DrizzleDb } from '@nexiom/database';
import { QueueService, QueueName, type ProvisionDatabaseEvent } from '@nexiom/queue';
import { sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

/** The minimum number of WARM databases we always want in the pool. */
const WARM_POOL_TARGET = 5;

/**
 * CapacityManagerService
 *
 * Runs as part of the API control plane. Monitors the size of the warm
 * database pool and publishes ProvisionDatabaseEvent messages to the
 * TenantProvisionQueue whenever the pool dips below the target threshold.
 *
 * The actual DDL work (CREATE DATABASE + migrations) is performed by the
 * isolated `tenant-provisioner` microservice, which is the only process
 * with CREATEDB privileges.
 */
@Injectable()
export class CapacityManagerService {
  private readonly logger = new Logger(CapacityManagerService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly queueService: QueueService,
  ) {}

  /**
   * Runs every minute to replenish the warm pool.
   * Also fires once on module init (via OnModuleInit) to fill the pool
   * immediately on API startup.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async replenishPool(): Promise<void> {
    try {
      const warmCount = await this.countWarm();
      const deficit = WARM_POOL_TARGET - warmCount;

      if (deficit <= 0) {
        this.logger.debug(
          `Warm pool is healthy — ${warmCount}/${WARM_POOL_TARGET} slots available.`,
        );
        return;
      }

      this.logger.log(
        `Warm pool below threshold — ${warmCount}/${WARM_POOL_TARGET}. Dispatching ${deficit} provision job(s).`,
      );

      const hostUrl = this.deriveHostUrl();

      for (let i = 0; i < deficit; i++) {
        const poolSlotId = uuidv4();
        const event: ProvisionDatabaseEvent = { poolSlotId, hostUrl };
        const dbName = `nexiom_tenant_${poolSlotId.replace(/-/g, '_')}`;

        // 1. Dispatch the job first (if this fails, we don't create orphaned rows)
        await this.queueService.send(QueueName.TenantProvisionQueue, event);

        // 2. Insert INITIALIZING slot only after successful queue send
        await this.db.execute(
          sql`INSERT INTO tenant_storage_registry
              (tenant_id, database_name, database_host_url, region_context, status, created_at, updated_at)
              VALUES (
                ${'WARM-' + poolSlotId},
                ${dbName},
                ${hostUrl},
                ${process.env.REGION_CONTEXT ?? 'local'},
                'INITIALIZING',
                NOW(),
                NOW()
              )`,
        );

        this.logger.debug(`  → Queued provision job: poolSlotId=${poolSlotId}`);
      }
    } catch (err) {
      this.logger.error('CapacityManager: pool replenishment failed', err);
    }
  }

  /** Counts how many WARM + INITIALIZING slots are currently in the registry. */
  private async countWarm(): Promise<number> {
    const result = await this.db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count
          FROM tenant_storage_registry
          WHERE status IN ('WARM', 'INITIALIZING')`,
    );
    return parseInt(result.rows[0]?.count ?? '0', 10);
  }

  /**
   * Derives the base host URL (no database name, no credentials) from DATABASE_URL.
   * This is sent in the queue message so the tenant-provisioner knows
   * which Postgres cluster to provision on. Credentials are stripped for security.
   */
  private deriveHostUrl(): string {
    const raw = process.env.DATABASE_URL ?? '';
    try {
      const parsed = new URL(raw);
      return `${parsed.protocol}//${parsed.hostname}${parsed.port ? ':' + parsed.port : ''}`;
    } catch (err) {
      throw new Error(
        `Failed to parse DATABASE_URL: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
