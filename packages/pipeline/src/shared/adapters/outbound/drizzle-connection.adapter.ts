import { Injectable, Inject } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE_CONNECTION, dataSources } from "@soopa/database";
import type { DrizzleDb } from "@soopa/database";
import { ConnectionRepositoryPort, ConnectionMetadata } from '../../../shared/ports/connection.repository.port.js';
import { DB_MANAGER, type DatabaseManager } from "@soopa/dbmanager";

@Injectable()
export class DrizzleConnectionRepositoryAdapter implements ConnectionRepositoryPort {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {}

  async getGlobalConnectionMeta(dataSourceId: string): Promise<{ tenantId: string } | null> {
    const connectionMeta = await this.globalDb
      .select({ tenantId: dataSources.tenantId })
      .from(dataSources)
      .where(eq(dataSources.id, dataSourceId))
      .limit(1)
      .then((rows) => rows[0]);

    return connectionMeta || null;
  }

  async getTenantConnectionMeta(dataSourceId: string, tenantId: string): Promise<ConnectionMetadata | null> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    
    const srcConnRows = await tenantDb
      .select({
        appName: dataSources.appName,
        tenantId: dataSources.tenantId,
        metadata: dataSources.metadata,
      })
      .from(dataSources)
      .where(eq(dataSources.id, dataSourceId))
      .limit(1);

    if (!srcConnRows.length) {
      return null;
    }

    const metadata = srcConnRows[0].metadata as Record<string, unknown> | null;
    const trimmedAppProfile = typeof metadata?.appProfile === "string" ? metadata.appProfile.trim() : "";
    const appProfile = trimmedAppProfile !== "" ? trimmedAppProfile : "standard";

    return {
      tenantId: srcConnRows[0].tenantId,
      appName: srcConnRows[0].appName,
      appProfile,
    };
  }
}
