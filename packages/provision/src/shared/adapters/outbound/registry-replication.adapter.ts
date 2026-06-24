import { Injectable, Inject } from "@nestjs/common";
import { eq, inArray, notInArray, and } from "drizzle-orm";
import { DATABASE_CONNECTION, globalRegistryOutbox, assertValidSchemaName } from "@soopa/database";
import type { DrizzleDb } from "@soopa/database";
import { DB_MANAGER } from "@soopa/dbmanager";
import type { DatabaseManager, SchemaPlan } from "@soopa/dbmanager";
import * as schema from "@soopa/database";
import type {
  RegistryReplicationPort,
  GlobalOutboxRecord,
  DataSourceMetadata,
} from '../../ports/registry-replication.port.js';

// ISO 8601 pattern — matches timestamps stored as strings in JSONB
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function rehydrateDates(obj: unknown): any {
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj === "string" && ISO_TIMESTAMP_RE.test(obj)) {
    return new Date(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => rehydrateDates(item));
  }
  
  if (typeof obj === "object" && !(obj instanceof Date)) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = rehydrateDates(v);
    }
    return out;
  }
  
  return obj;
}



@Injectable()
export class RegistryReplicationAdapter implements RegistryReplicationPort {
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
    action: "UPSERT" | "DELETE" | "APPLY",
    entityType:
      | "APP_CONNECTION"
      | "UI_WORKSPACE"
      | "UI_WORKSPACE_DATA_SOURCE"
      | "INTEGRATION_STITCH"
      | "FIELD_MAPPING"
      | "SCHEMA_PROVISION",
    entityId: string,
    payload: Record<string, unknown> | null,
  ): Promise<void> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);

    await tenantDb.transaction(async (tx) => {
      if (action === "APPLY" || entityType === "SCHEMA_PROVISION") {
        throw new Error(
          `Unhandled action and entityType combination: action=${action}, entityType=${entityType}`
        );
      }

      if (action === "UPSERT") {
        if (!payload) {
          throw new Error(
            `UPSERT action requires a payload, but received null for entityType=${entityType}, entityId=${entityId}`,
          );
        }
        const data: Record<string, unknown> = rehydrateDates(payload);

        let nestedMappings: unknown[] | undefined = undefined;
        if (entityType === "INTEGRATION_STITCH" && data.fieldMappings !== undefined) {
          nestedMappings = data.fieldMappings as unknown[];
          delete data.fieldMappings;
        }
        
        // Workaround for Drizzle ORM bug: .onConflictDoUpdate({ set: data }) does NOT automatically 
        // stringify objects for jsonb columns, causing the pg driver to crash.
        for (const [key, value] of Object.entries(data)) {
            if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
                data[key] = JSON.stringify(value);
            }
        }

        if (entityType === "APP_CONNECTION") {
          await tx
            .insert(schema.dataSources)
            .values(data as typeof schema.dataSources.$inferInsert)
            .onConflictDoUpdate({
              target: [schema.dataSources.id],
              set: data as typeof schema.dataSources.$inferInsert,
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

          if (Array.isArray(nestedMappings)) {
            const incomingCanonicals = nestedMappings
              .map((m: unknown) => (m as { sourceCanonical?: string }).sourceCanonical)
              .filter((c): c is string => typeof c === 'string' && c.length > 0);

            const stitchId = data.id as string;

            if (incomingCanonicals.length > 0) {
              await tx
                .delete(schema.fieldMappings)
                .where(
                  and(
                    eq(schema.fieldMappings.stitchId, stitchId),
                    notInArray(schema.fieldMappings.sourceCanonical, incomingCanonicals),
                  ),
                );
            } else {
              await tx
                .delete(schema.fieldMappings)
                .where(eq(schema.fieldMappings.stitchId, stitchId));
            }

            for (const mapping of nestedMappings) {
              // The workaround above didn't touch mapping.mappingRules, so we need to stringify it manually 
              // for Drizzle ORM if it's an object/array.
              const m = mapping as Record<string, unknown>;
              const mappingRules = m.mappingRules;
              const stringifiedRules =
                mappingRules !== null && typeof mappingRules === 'object'
                  ? JSON.stringify(mappingRules)
                  : mappingRules;

              const payloadToUpsert = { ...m, mappingRules: stringifiedRules } as typeof schema.fieldMappings.$inferInsert;

              await tx
                .insert(schema.fieldMappings)
                .values(payloadToUpsert)
                .onConflictDoUpdate({
                  target: [schema.fieldMappings.stitchId, schema.fieldMappings.sourceCanonical],
                  set: payloadToUpsert,
                });
            }
          }
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
        organizationId: schema.dataSources.organizationId,
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

  async activateConnection(tenantId: string, connectionId: string, schemaPlan: SchemaPlan): Promise<void> {
    await this.globalDb.transaction(async (tx) => {
      // Verify and update data source
      const [updatedDataSource] = await tx
        .update(schema.dataSources)
        .set({ schemaPlan })
        .where(
          and(
            eq(schema.dataSources.id, connectionId),
            eq(schema.dataSources.tenantId, tenantId),
          ),
        )
        .returning();

      if (!updatedDataSource) {
        throw new Error(
          `Connection ${connectionId} not found or does not belong to tenant ${tenantId}`,
        );
      }

      // Update credentials to ACTIVE
      await tx
        .update(schema.credentials)
        .set({ status: 'ACTIVE' })
        .where(eq(schema.credentials.dataSourceId, connectionId));

      // Push updated data source to tenant outbox so replication picks up SCHEMA_ACTIVE
      await tx.insert(globalRegistryOutbox).values({
        tenantId,
        entityType: 'APP_CONNECTION',
        entityId: connectionId,
        action: 'UPSERT',
        payload: updatedDataSource,
      });
    });
  }

  async registerCdcTables(tenantId: string, schemaName: string): Promise<void> {
    assertValidSchemaName(schemaName);
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    const { sql } = await import("drizzle-orm");

    // Add each table individually to ensure idempotency
    const tables = ['inbound_outbox', 'replica_outbox', 'normalized_outbox'];

    for (const table of tables) {
      await tenantDb.execute(sql`
        DO $$
        BEGIN
          BEGIN
            ALTER PUBLICATION platform_cdc
              ADD TABLE ${sql.raw('"' + schemaName + '"')}.${sql.raw(table)};
          EXCEPTION WHEN duplicate_object THEN
            -- Ignore gracefully if already added
          END;
        END $$;
      `);
    }
  }
}
