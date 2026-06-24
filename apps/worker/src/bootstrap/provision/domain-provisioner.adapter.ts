import { Injectable, Inject, Logger } from "@nestjs/common";
import type { DomainProvisionerPort } from "@soopa/provision";
import { PieceRegistryService } from "@soopa/piece-registry";
import { DB_MANAGER } from "@soopa/dbmanager";
import type { DatabaseManager } from "@soopa/dbmanager";
import { MIGRATION_RUNNER } from "@soopa/migrator";
import type { MigrationRunnerPort } from "@soopa/migrator";

@Injectable()
export class DomainProvisionerAdapter implements DomainProvisionerPort {
  private readonly logger = new Logger(DomainProvisionerAdapter.name);

  constructor(
    private readonly pieceRegistry: PieceRegistryService,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
    @Inject(MIGRATION_RUNNER) private readonly migrator: MigrationRunnerPort,
  ) {}

  async provisionDomainSchema(
    tenantId: string,
    schemaName: string,
    appName: string,
  ): Promise<void> {
    const piece = this.pieceRegistry.getPiece(appName);
    if (!piece) {
      throw new Error(
        `Piece ${appName} not found in registry. Cannot provision domain schema.`,
      );
    }

    if (!piece.migrationsFolder) {
      this.logger.debug(
        `Piece ${appName} does not define a migrationsFolder. Skipping domain provisioning.`,
      );
      return;
    }

    this.logger.log(
      `Running domain migrations for ${appName} in schema ${schemaName} (tenant ${tenantId})`,
    );
    const db = await this.dbManager.getTenantDb(tenantId);
    await this.migrator.runMigrations(db, {
      migrationsFolder: piece.migrationsFolder,
      searchPath: schemaName,
    });
    this.logger.log(`Successfully provisioned domain tables for ${appName}`);
  }
}
