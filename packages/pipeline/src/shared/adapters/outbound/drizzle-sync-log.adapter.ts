import { Injectable, Inject } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { buildTenantSchema, assertValidSchemaName } from "@soopa/database";
import { DB_MANAGER, type DatabaseManager } from "@soopa/dbmanager";
import { SyncLogRepositoryPort } from '../../../shared/ports/sync-log.repository.port.js';

@Injectable()
export class DrizzleSyncLogRepositoryAdapter implements SyncLogRepositoryPort {
  constructor(
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {}

  async writeSyncLog(
    tenantId: string,
    schemaName: string,
    traceId: string,
    routeId: string | null,
    layer: "L3" | "L4" | "L5" | "L6",
    status: "PROCESSING" | "SUCCESS" | "FAIL" | "SKIPPED",
    durationMs: number,
    errorMessage?: string,
    tx?: any
  ): Promise<void> {
    const doInsert = async (transaction: any) => {
      const { syncLog } = buildTenantSchema(schemaName);
      await transaction
        .insert(syncLog)
        .values({
          traceId,
          routeId,
          layer,
          status,
          durationMs,
          errorMessage,
        })
        .onConflictDoNothing();
    };

    if (tx) {
      await doInsert(tx);
    } else {
      const tenantDb = await this.dbManager.getTenantDb(tenantId);
      
      await tenantDb.transaction(async (transaction) => {
        assertValidSchemaName(schemaName);
        await transaction.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
        );
        await doInsert(transaction);
      });
    }
  }

  async hasCompletedSyncLog(
    tenantId: string,
    schemaName: string,
    traceId: string,
    routeId: string,
    layer: string,
  ): Promise<boolean> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    const { syncLog } = buildTenantSchema(schemaName);
    
    return await tenantDb.transaction(async (tx) => {
      assertValidSchemaName(schemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
      );
      
      const logs = await tx
        .select()
        .from(syncLog)
        .where(
          sql`${syncLog.traceId} = ${traceId} AND ${syncLog.routeId} = ${routeId} AND ${syncLog.layer} = ${layer} AND ${syncLog.status} != 'RETRY'`,
        )
        .limit(1);
        
      return logs.length > 0;
    });
  }
}
