import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { DATABASE_CONNECTION } from '@soopa/database';
import type { DrizzleDb } from '@soopa/database';
import { QUEUE_SERVICE, QueueName } from '@soopa/queue';
import type { IQueueService, PluginMigrationEvent } from '@soopa/queue';

/**
 * Handles Just-In-Time provisioning of dynamically downloaded domain tables.
 * Iterates through active tenant databases and runs the Drizzle migrator.
 */
@Injectable()
export class MigrationWorkerService implements OnModuleInit {
  private readonly logger = new Logger(MigrationWorkerService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    @Inject(QUEUE_SERVICE) private readonly queueService: IQueueService
  ) {}

  onModuleInit() {
    // Guard against registering migration consumer when tenant handlers are not implemented
    if (!this.areTenantHandlersAvailable()) {
      this.logger.warn(
        'Tenant handlers (getActiveTenants, getTenantDbConnection) are not implemented. ' +
        'Plugin migration consumer will NOT be registered. ' +
        'Set ENABLE_PLUGIN_MIGRATIONS=true when implementations are ready.'
      );
      return;
    }

    this.logger.log('Registering SQS Queue Consumer for Plugin Migrations...');
    this.queueService.consume(
      QueueName.TenantProvisionQueue,
      async (rawMsg: unknown) => {
        const event = rawMsg as PluginMigrationEvent;
        // The queue might be used for other tenant provision events, so check if it's ours
        if (this.isPluginMigrationEvent(event)) {
          await this.runBackgroundMigrations(event);
        } else {
          // Non-plugin messages should not be silently dropped
          // Log and let the message be requeued for other consumers
          this.logger.warn(
            'Received non-plugin migration event on TenantProvisionQueue. Message should be handled by dedicated consumer.',
          );
          throw new Error('Not a plugin migration event - requeue for appropriate handler');
        }
      }
    );
  }

  /**
   * Checks if tenant handlers are available. Returns false if stubbed implementations exist.
   */
  private areTenantHandlersAvailable(): boolean {
    const isGetActiveTenantsStubbed = this.getActiveTenants.toString().includes('is not implemented');
    const isGetTenantDbConnectionStubbed = this.getTenantDbConnection.toString().includes('is not implemented');
    
    if (isGetActiveTenantsStubbed || isGetTenantDbConnectionStubbed) {
      return false;
    }

    return process.env.ENABLE_PLUGIN_MIGRATIONS === 'true';
  }

  /**
   * Type guard to verify if an event is a plugin migration event.
   */
  private isPluginMigrationEvent(event: any): event is PluginMigrationEvent {
    return (
      typeof event === 'object' &&
      event !== null &&
      typeof event.pluginLocation === 'string' &&
      typeof event.pieceName === 'string' &&
      (typeof event.tenantId === 'string' || typeof event.tenantId === 'undefined')
    );
  }

  /**
   * Executes Drizzle migrations for a dynamically loaded piece using SQS Fan-Out.
   */
  async runBackgroundMigrations(event: PluginMigrationEvent) {
    // Guard against executing migrations when tenant handlers are not available
    if (!this.areTenantHandlersAvailable()) {
      this.logger.debug(
        `Cannot run migrations for ${event.pieceName}: tenant handlers are not implemented. ` +
        'Set ENABLE_PLUGIN_MIGRATIONS=true when implementations are ready.'
      );
      return;
    }

    if (!event.tenantId) {
      // --- FAN-OUT MODE ---
      this.logger.log(`[Fan-Out] Starting fan-out for ${event.pieceName} from ${event.pluginLocation}`);
      const activeTenants = await this.getActiveTenants(event.pieceName);

      this.logger.log(`[Fan-Out] Found ${activeTenants.length} active tenants. Dispatching single-tenant SQS messages...`);

      // Dispatch 1 SQS message per tenant. This perfectly parallelizes migrations
      // across all available workers and prevents a single tenant's failure from retrying the entire batch.
      for (const tenant of activeTenants) {
        await this.queueService.send(QueueName.TenantProvisionQueue, {
          ...event,
          tenantId: tenant.id
        });
      }
      this.logger.log(`[Fan-Out] Fan-out complete for ${event.pieceName}.`);
      return;
    }

    // --- WORKER MODE (Single Tenant) ---
    this.logger.log(`[Worker] Executing migration for tenant ${event.tenantId} (Piece: ${event.pieceName})`);
    const migrationsFolder = `${event.pluginLocation}/drizzle/migrations`;

    try {
      const tenantDb = await this.getTenantDbConnection(event.tenantId);
      await migrate(tenantDb, { migrationsFolder });
      this.logger.debug(`[Worker] Successfully migrated tenant: ${event.tenantId}`);
    } catch (error: any) {
      this.logger.error(`[Worker] Failed to migrate tenant ${event.tenantId}: ${error.message}`);
      // Throwing allows SQS to automatically dead-letter queue this specific tenant's job
      // without affecting the migrations of other tenants.
      throw error;
    }
  }

  // Stub helpers - MUST BE IMPLEMENTED BEFORE PRODUCTION USE
  private async getActiveTenants(pieceName: string): Promise<Array<{ id: string }>> {
    // TODO: Implement real tenant resolution logic
    // e.g., SELECT * FROM tenant_connections WHERE piece_id = $1
    throw new Error(
      'getActiveTenants is not implemented. Real tenant resolution must be provided before running plugin migrations in production.',
    );
  }

  private async getTenantDbConnection(connectionUrl: string): Promise<any> {
    // TODO: Implement real tenant database connection management
    // In production, this should resolve from your TenantDatabaseManager connection pool
    throw new Error(
      'getTenantDbConnection is not implemented. Real tenant connection management must be provided before running plugin migrations in production.',
    );
  }
}
