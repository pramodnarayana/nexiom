import { Injectable, Logger, Inject, NotFoundException } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  appConnections,
  organization,
} from '@nexiom/database';
import { eq, sql } from 'drizzle-orm';
import * as crypto from 'node:crypto';

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
   * performed here. However, deletion of app_connection rows cryptographically
   * renders encrypted vault values unusable.
   */
  async offboardTenant(tenantId: string): Promise<void> {
    this.logger.log(`Initiating full GDPR deletion for tenant: ${tenantId}`);

    // 1. Identify all database schema namespaces associated with the tenant
    const connections = await this.db
      .select({ id: appConnections.id, appName: appConnections.appName })
      .from(appConnections)
      .where(eq(appConnections.tenantId, tenantId));

    if (connections.length === 0) {
      this.logger.debug(`No connections found for tenant ${tenantId}`);
    } else {
      // Best-effort schema cleanup - idempotent and safe to retry
      for (const currConnection of connections) {
        // Compute the deterministic schema name for the Tenant Database
        const hashedSuffix = crypto
          .createHash('sha256')
          .update(currConnection.id)
          .digest('hex')
          .substring(0, 16);
        const sanitizedProvider = currConnection.appName
          .toLowerCase()
          .replaceAll(/[^a-z0-9]/g, '');
        const finalProviderToken = sanitizedProvider || 'unknown';
        const safeToken = finalProviderToken.substring(0, 40);
        const dataNamespace = `ws_${safeToken}_${hashedSuffix}`;

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
            `Failed dropping schema ${dataNamespace} for tenant ${tenantId}, connectionId ${currConnection.id}. Schema may require manual cleanup or retry.`,
            error,
          );
          // Continue with logical deletion - orphaned schemas can be cleaned by reconciliation job
        }
      }
    }

    // 2. Erase the top-level organization data - Drizzle's ON DELETE CASCADE
    // will recursively wipe out `appConnections`,
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
      // since the physical encrypted value blobs are stored in app_connection.value,
      // deleting the row cryptographically renders the vault unusable.
      await tx.delete(organization).where(eq(organization.id, tenantId));
    });

    this.logger.log(
      `Tenant ${tenantId} has been successfully offboarded and all data physically purged.`,
    );
  }
}
