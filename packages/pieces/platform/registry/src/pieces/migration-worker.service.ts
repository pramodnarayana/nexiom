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
    this.logger.log('Registering SQS Queue Consumer for Plugin Migrations...');
    this.queueService.consume(
      QueueName.TenantProvisionQueue,
      async (rawMsg: unknown) => {
        const event = rawMsg as PluginMigrationEvent;
        // The queue might be used for other tenant provision events, so check if it's ours
        if (event.pluginLocation && event.pieceName) {
          await this.runBackgroundMigrations(event);
        }
      }
    );
  }

  /**
   * Executes Drizzle migrations for a dynamically loaded piece using SQS Fan-Out.
   */
  async runBackgroundMigrations(event: PluginMigrationEvent) {
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

  // Mocks for demonstration purposes
  private async getActiveTenants(pieceName: string) {
    // e.g., SELECT * FROM tenant_connections WHERE piece_id = $1
    return [
      { id: 'tenant_1', dbConnectionUrl: 'postgres://localhost/tenant1' },
      { id: 'tenant_2', dbConnectionUrl: 'postgres://localhost/tenant2' }
    ];
  }

  private async getTenantDbConnection(connectionUrl: string): Promise<any> {
    // In production, this would resolve from your TenantDatabaseManager connection pool
    // Returning globalDb here just to satisfy the mock signature
    return this.globalDb;
  }
}
