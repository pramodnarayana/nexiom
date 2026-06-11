import { Injectable, Inject } from "@nestjs/common";
import { eq, inArray, and } from "drizzle-orm";
import { DATABASE_CONNECTION, globalRegistryOutbox } from "@soopa/database";
import type { DrizzleDb } from "@soopa/database";
import { DB_MANAGER } from "@soopa/dbmanager";
import type { DatabaseManager } from "@soopa/dbmanager";
import * as schema from "@soopa/database";
import type {
  IRegistryReplicationPort,
  GlobalOutboxRecord,
  DataSourceMetadata,
} from "@soopa/domain-core";

// ISO 8601 pattern — matches timestamps stored as strings in JSONB
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function rehydrateDates(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && ISO_TIMESTAMP_RE.test(v)) {
      out[k] = new Date(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

const APP_CONNECTION_GLOBAL_ONLY_KEYS = new Set(["schemaName", "schemaPlan"]);

function prepareAppConnectionPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (!APP_CONNECTION_GLOBAL_ONLY_KEYS.has(k)) {
      out[k] = v;
    }
  }
  return out;
}

@Injectable()
export class RegistryReplicationAdapter implements IRegistryReplicationPort {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {}

  async fetchGlobalOutboxRecord(
    outboxId: string,
  ): Promise<GlobalOutboxRecord | null> {
    const rows = await this.globalDb
      .select()
      .from(globalRegistryOutbox)
      .where(eq(globalRegistryOutbox.id, outboxId))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      id: row.id,
      tenantId: row.tenantId,
      entityType: row.entityType,
      entityId: row.entityId,
      action: row.action,
      payload: row.payload as Record<string, unknown> | null,
      status: row.status as GlobalOutboxRecord["status"],
    };
  }

  async replicateEntity(
    tenantId: string,
    action: "UPSERT" | "DELETE",
    entityType:
      | "APP_CONNECTION"
      | "UI_WORKSPACE"
      | "INTEGRATION_STITCH"
      | "FIELD_MAPPING",
    entityId: string,
    payload: Record<string, unknown> | null,
  ): Promise<void> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);

    await tenantDb.transaction(async (tx) => {
      if (action === "UPSERT") {
        if (!payload) {
          throw new Error(
            `UPSERT action requires a payload, but received null for entityType=${entityType}, entityId=${entityId}`,
          );
        }
        const data = rehydrateDates(payload);

        if (entityType === "APP_CONNECTION") {
          const connData = prepareAppConnectionPayload(data);
          await tx
            .insert(schema.dataSources)
            .values(connData as typeof schema.dataSources.$inferInsert)
            .onConflictDoUpdate({
              target: [schema.dataSources.id],
              set: connData as typeof schema.dataSources.$inferInsert,
            });
        } else if (entityType === "UI_WORKSPACE") {
          await tx
            .insert(schema.uiWorkspaces)
            .values(data as typeof schema.uiWorkspaces.$inferInsert)
            .onConflictDoUpdate({
              target: [schema.uiWorkspaces.id],
              set: data as typeof schema.uiWorkspaces.$inferInsert,
            });
        } else if (entityType === "INTEGRATION_STITCH") {
          await tx
            .insert(schema.integrationStitches)
            .values(data as typeof schema.integrationStitches.$inferInsert)
            .onConflictDoUpdate({
              target: [schema.integrationStitches.id],
              set: data as typeof schema.integrationStitches.$inferInsert,
            });
        } else if (entityType === "FIELD_MAPPING") {
          await tx
            .insert(schema.fieldMappings)
            .values(data as typeof schema.fieldMappings.$inferInsert)
            .onConflictDoUpdate({
              target: [schema.fieldMappings.id],
              set: data as typeof schema.fieldMappings.$inferInsert,
            });
        }
      } else if (action === "DELETE") {
        if (entityType === "APP_CONNECTION") {
          await tx
            .delete(schema.dataSources)
            .where(eq(schema.dataSources.id, entityId));
        } else if (entityType === "UI_WORKSPACE") {
          await tx
            .delete(schema.uiWorkspaces)
            .where(eq(schema.uiWorkspaces.id, entityId));
        } else if (entityType === "INTEGRATION_STITCH") {
          await tx
            .delete(schema.integrationStitches)
            .where(eq(schema.integrationStitches.id, entityId));
        } else if (entityType === "FIELD_MAPPING") {
          await tx
            .delete(schema.fieldMappings)
            .where(eq(schema.fieldMappings.id, entityId));
        }
      }
    });
  }

  async getStitchDataSources(
    tenantId: string,
    srcDataSourceId: string,
    destDataSourceId: string,
  ): Promise<DataSourceMetadata[]> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    return tenantDb
      .select({
        id: schema.dataSources.id,
        appName: schema.dataSources.appName,
        metadata: schema.dataSources.metadata,
      })
      .from(schema.dataSources)
      .where(
        and(
          inArray(schema.dataSources.id, [srcDataSourceId, destDataSourceId]),
          eq(schema.dataSources.tenantId, tenantId),
        ),
      );
  }

  async markGlobalOutboxSuccess(outboxId: string): Promise<void> {
    await this.globalDb
      .update(globalRegistryOutbox)
      .set({ status: "SUCCESS" })
      .where(eq(globalRegistryOutbox.id, outboxId));
  }
}
