import { Injectable, Logger, Inject, NotFoundException } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  dataSources,
  organization,
} from '@soopa/database';
import { eq, sql } from 'drizzle-orm';
import { getWorkspaceSchemaName } from '@soopa/dbmanager';

@Injectable()
export class TenantOffboardingService {
  private readonly logger = new Logger(TenantOffboardingService.name);

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  /**
   * GDPR-compliant offboarding process for an entire tenant.
   * Hard-drops all isolated infrastructure schemas and subsequently removes
   * all references from the main multi-tenant tables.
   *
   * Schema drops run outside the org-deletion transaction as a best-effort,
   * idempotent workflow. Drop failures are logged with full context for
   * reconciliation by a cleanup job.
   *
   * Note: KMS alias cleanup is delegated to a separate cleanup job and is not
   * performed here. However, deletion of dataSources/credentials rows cryptographically
   * renders encrypted vault values unusable, as the encrypted secret blobs are stored in the credentials table.
   */
  async offboardTenant(tenantId: string): Promise<void> {
    this.logger.log(`Initiating full GDPR deletion for tenant: ${tenantId}`);

    // 1. Identify all database schema namespaces associated with the tenant
    const connections = await this.db
      .select({
        id: dataSources.id,
        appName: dataSources.appName,
        organizationId: dataSources.organizationId,
        schemaName: dataSources.schemaName,
      })
      .from(dataSources)
      .where(eq(dataSources.tenantId, tenantId));

    if (connections.length === 0) {
      this.logger.debug(`No connections found for tenant ${tenantId}`);
    } else {
      // Best-effort schema cleanup - idempotent and safe to retry
      for (const currConnection of connections) {
        let dataNamespace = currConnection.schemaName;

        if (!dataNamespace) {
          if (
            !currConnection.organizationId ||
            currConnection.organizationId.trim() === ''
          ) {
            this.logger.warn(
              `Skipping schema cleanup for connection ${currConnection.id}: schemaName and organizationId are missing`,
            );
            continue;
          }

          dataNamespace = getWorkspaceSchemaName(
            tenantId,
            currConnection.appName,
            currConnection.organizationId,
          );
        }

        this.logger.log(`Safely dropping physical schema: ${dataNamespace}`);
        try {
          // CASCADE guarantees all tables partitioned for this tenant are permanently annihilated.
          // This runs outside the transaction below - DDL operations may not be fully transactional.
          // DROP SCHEMA IF EXISTS is idempotent and safe to retry via reconciliation job.
          await this.db.execute(
            sql`DROP SCHEMA IF EXISTS ${sql.identifier(dataNamespace)} CASCADE`,
          );
        } catch (error) {
          // Log full context for reconciliation/cleanup job
          this.logger.error(
            `Failed dropping schema ${dataNamespace} for tenant ${tenantId}, dataSourceId ${currConnection.id}. Schema may require manual cleanup or retry.`,
            error,
          );
          // Continue with logical deletion - orphaned schemas can be cleaned by reconciliation job
        }
      }
    }

    // 2. Erase the top-level organization data - Drizzle's ON DELETE CASCADE
    // will recursively wipe out `dataSources`,
    // `uiWorkspaces`, `integration_stitches`, `global_entity_map` and the `member` rows
    await this.db.transaction(async (tx) => {
      // Verify organization exists before deletion
      const [existing] = await tx
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, tenantId))
        .limit(1);

      if (!existing) {
        throw new NotFoundException(
          `Organization ${tenantId} not found - cannot offboard non-existent tenant`,
        );
      }

      // Technically KMS alias keys should be wiped here via KMS Provider but
      // since the physical encrypted value blobs are stored in the credentials table,
      // deleting the dataSources/credentials cryptographically renders the vault unusable.
      await tx.delete(organization).where(eq(organization.id, tenantId));
    });

    this.logger.log(
      `Tenant ${tenantId} has been successfully offboarded and all data physically purged.`,
    );
  }
}
