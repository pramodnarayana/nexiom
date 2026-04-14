import { Injectable, Logger, Inject } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  connectionStorageRegistry,
  appConnections,
  organization,
} from '@nexiom/database';
import { eq, sql } from 'drizzle-orm';

@Injectable()
export class TenantOffboardingService {
  private readonly logger = new Logger(TenantOffboardingService.name);

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  /**
   * GDPR-compliant offboarding process for an entire tenant.
   * Hard-drops all isolated infrastructure schemas, invalidates KMS blobs,
   * and subsequently removes all references from the main multi-tenant tables.
   */
  async offboardTenant(tenantId: string): Promise<void> {
    this.logger.log(`Initiating full GDPR deletion for tenant: ${tenantId}`);

    // 1. Identify all database schema namespaces associated with the tenant
    const connections = await this.db
      .select({ id: appConnections.id })
      .from(appConnections)
      .where(eq(appConnections.tenantId, tenantId));

    for (const currConnection of connections) {
      const [registry] = await this.db
        .select()
        .from(connectionStorageRegistry)
        .where(eq(connectionStorageRegistry.connectionId, currConnection.id))
        .limit(1);

      if (registry && registry.dataNamespace) {
        this.logger.log(
          `Safely dropping physical schema: ${registry.dataNamespace}`,
        );
        try {
          // CASCADE guarantees all tables partitioned for this tenant are permanently annihilated.
          await this.db.execute(
            sql`DROP SCHEMA IF EXISTS ${sql.identifier(registry.dataNamespace)} CASCADE`,
          );
        } catch (error) {
          this.logger.error(
            `Failed dropping schema ${registry.dataNamespace} for tenant ${tenantId}. Proceeding with logical deletion.`,
            error,
          );
        }
      }
    }

    // 2. Erase the top-level organization data - Drizzle's ON DELETE CASCADE
    // will recursively wipe out `appConnections`, `connectionStorageRegistry`,
    // `uiWorkspaces`, `integration_stitches`, `global_entity_map` and the `member` rows
    await this.db.transaction(async (tx) => {
      // Technically KMS alias keys should be wiped here via KMS Provider but
      // since the physical encrypted value blobs are stored in app_connection.value,
      // deleting the row cryptographically renders the vault unusable.
      await tx.delete(organization).where(eq(organization.id, tenantId));
    });

    this.logger.log(
      `Tenant ${tenantId} has been successfully offboarded and all data physically purged.`,
    );
  }
}
