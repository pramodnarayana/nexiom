import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { DATABASE_CONNECTION, tenantStorageRegistry } from '@soopa/database';
import type { DrizzleDb } from '@soopa/database';
import { QUEUE_SERVICE, QueueName } from '@soopa/queue';
import type { IQueueService, PluginMigrationEvent } from '@soopa/queue';
import { DB_MANAGER } from '@soopa/dbmanager';
import type { DatabaseManager } from '@soopa/dbmanager';
import { MIGRATION_RUNNER, MigrationRunnerPort } from '@soopa/migrator';

/**
 * Handles Just-In-Time provisioning of dynamically downloaded domain tables.
 *
 * This service is ONLY registered by {@link PiecesModule.withMigrations}, which is
 * imported exclusively by app modules where ENABLE_PLUGIN_MIGRATIONS=true. There is
 * no runtime guard or introspection — if this service exists in the NestJS container
 * it means migrations are intentionally enabled for this process.
 *
 * Queue contract:
 *  - Fan-out message (no tenantId): dispatches one single-tenant message per active tenant.
 *  - Worker message (with tenantId): runs Drizzle migrator for that specific tenant.
 *  - Non-plugin message: throws so SQS requeues it for the appropriate consumer.
 */
@Injectable()
export class MigrationWorkerService implements OnModuleInit {
  private readonly logger = new Logger(MigrationWorkerService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
    @Inject(QUEUE_SERVICE) private readonly queueService: IQueueService,
    @Inject(MIGRATION_RUNNER) private readonly migrator: MigrationRunnerPort,
  ) {}

  onModuleInit(): void {
    this.logger.log('Registering SQS Queue Consumer for Plugin Migrations...');
    this.queueService.consume(
      QueueName.TenantProvisionQueue,
      async (rawMsg: unknown) => {
        if (this.isPluginMigrationEvent(rawMsg)) {
          await this.runBackgroundMigrations(rawMsg);
        } else {
          // Non-plugin messages must not be silently dropped — throw so SQS
          // requeues the message for the appropriate consumer.
          this.logger.warn(
            'Received non-plugin migration event on TenantProvisionQueue. ' +
              'Message will be requeued for the appropriate handler.',
          );
          throw new Error(
            'Not a plugin migration event — requeue for appropriate handler.',
          );
        }
      },
    );
  }

  /**
   * Type guard: narrows `unknown` to `PluginMigrationEvent`.
   * Accepts `unknown` (not `any`) so TypeScript enforces exhaustive narrowing.
   */
  private isPluginMigrationEvent(event: unknown): event is PluginMigrationEvent {
    if (typeof event !== 'object' || event === null) return false;
    const e = event as Record<string, unknown>;
    return (
      typeof e['pluginLocation'] === 'string' &&
      typeof e['pieceName'] === 'string'
    );
  }

  /**
   * Executes Drizzle migrations for a dynamically loaded piece using SQS Fan-Out.
   *
   * Fan-out mode (no tenantId): iterates all active tenants and dispatches one
   * single-tenant SQS message each, so individual tenant failures are independently
   * retried by SQS without blocking the whole batch.
   *
   * Worker mode (tenantId present): runs migrations for the specified tenant.
   * Throws on failure so SQS routes the message to the DLQ for operator alerting.
   */
  async runBackgroundMigrations(event: PluginMigrationEvent): Promise<void> {
    if (!event.tenantId) {
      // ── Fan-out mode ──────────────────────────────────────────────────────
      this.logger.log(
        `[Fan-Out] Starting fan-out for ${event.pieceName} from ${event.pluginLocation}`,
      );
      const activeTenants = await this.getActiveTenants();
      this.logger.log(
        `[Fan-Out] Found ${activeTenants.length} active tenants. Dispatching single-tenant SQS messages...`,
      );

      for (const tenant of activeTenants) {
        await this.queueService.send(QueueName.TenantProvisionQueue, {
          ...event,
          tenantId: tenant.id,
        });
      }
      this.logger.log(`[Fan-Out] Fan-out complete for ${event.pieceName}.`);
      return;
    }

    // ── Worker mode (single tenant) ───────────────────────────────────────
    this.logger.log(
      `[Worker] Executing migration for tenant ${event.tenantId} (Piece: ${event.pieceName})`,
    );
    const migrationsFolder = `${event.pluginLocation}/drizzle/migrations`;

    try {
      const tenantDb = await this.getTenantDbConnection(event.tenantId);
      await this.migrator.runMigrations(tenantDb, { migrationsFolder });
      this.logger.debug(
        `[Worker] Successfully migrated tenant: ${event.tenantId}`,
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[Worker] Failed to migrate tenant ${event.tenantId}: ${msg}`,
      );
      // Re-throw so SQS dead-letter-queues this tenant's job independently.
      throw error;
    }
  }

  private async getActiveTenants(): Promise<Array<{ id: string }>> {
    return this.globalDb
      .select({ id: tenantStorageRegistry.tenantId })
      .from(tenantStorageRegistry);
  }

  private async getTenantDbConnection(tenantId: string): Promise<DrizzleDb> {
    return this.dbManager.getTenantDb(tenantId);
  }
}
