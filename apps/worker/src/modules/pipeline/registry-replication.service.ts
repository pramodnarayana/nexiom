import { Injectable, Inject, OnModuleInit, Logger } from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import { QueueService, QueueName } from "@soopa/queue";
import { DATABASE_CONNECTION, globalRegistryOutbox } from "@soopa/database";
import type { DrizzleDb } from "@soopa/database";
import {
  DB_MANAGER,
  SchemaPlan,
  getWorkspaceSchemaName,
} from "@soopa/dbmanager";
import type { DatabaseManager } from "@soopa/dbmanager";
import * as schema from "../../db/schema.js";

// ISO 8601 pattern — matches timestamps stored as strings in JSONB
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Drizzle's PgTimestamp.mapToDriverValue calls value.toISOString().
 * After a JSONB round-trip every Date becomes a plain string, so we
 * must rehydrate them before passing the payload to Drizzle.
 *
 * Payloads stored in global_registry_outbox are always written by Drizzle
 * (which returns camelCase keys), so no key-casing conversion is needed.
 */
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

/**
 * Global-Control-Plane-only columns that exist in the global DB's app_connection
 * but are NOT present in the tenant shard's replica table. Strip them before upsert.
 * Keys are camelCase (matching the Drizzle-serialized payload).
 */
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
export class RegistryReplicationService implements OnModuleInit {
  private readonly logger = new Logger(RegistryReplicationService.name);

  constructor(
    private readonly queueService: QueueService,
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {}

  onModuleInit() {
    this.queueService.consume(
      QueueName.RegistryReplicationQueue,
      async (rawMsg) => {
        const msg = rawMsg as { outboxId: string };
        if (!msg.outboxId) {
          this.logger.warn(
            "Invalid message received on RegistryReplicationQueue (missing outboxId)",
          );
          return;
        }
        await this.processMessage(msg.outboxId);
      },
    );
  }

  private async processMessage(outboxId: string): Promise<void> {
    const rows = await this.globalDb
      .select()
      .from(globalRegistryOutbox)
      .where(eq(globalRegistryOutbox.id, outboxId))
      .limit(1);

    if (rows.length === 0) {
      this.logger.warn(`Outbox record ${outboxId} not found. Skipping.`);
      return;
    }

    const row = rows[0];

    try {
      const tenantDb = await this.dbManager.getTenantDb(row.tenantId);

      let operationPerformed = false;
      let attempts = 0;
      // FIELD_MAPPING has a FK dependency on INTEGRATION_STITCH. When both are
      // queued at the same time (e.g. from create-stitch script), the stitch
      // replication message may still be in-flight when the mapping arrives.
      // Give it more retries with a longer backoff to let the parent arrive.
      const maxAttempts = row.entityType === "FIELD_MAPPING" ? 10 : 3;
      const retryDelayMs = row.entityType === "FIELD_MAPPING" ? 2000 : 1000;

      while (attempts < maxAttempts) {
        try {
          await tenantDb.transaction(async (tx) => {
            if (row.action === "UPSERT") {
              const data = rehydrateDates(
                row.payload as Record<string, unknown>,
              );
              if (row.entityType === "APP_CONNECTION") {
                const connData = prepareAppConnectionPayload(data);
                await tx
                  .insert(schema.dataSources)
                  .values(connData as typeof schema.dataSources.$inferInsert)
                  .onConflictDoUpdate({
                    target: [schema.dataSources.id],
                    set: connData as typeof schema.dataSources.$inferInsert,
                  });
                operationPerformed = true;
              } else if (row.entityType === "UI_WORKSPACE") {
                await tx
                  .insert(schema.uiWorkspaces)
                  .values(data as typeof schema.uiWorkspaces.$inferInsert)
                  .onConflictDoUpdate({
                    target: [schema.uiWorkspaces.id],
                    set: data as typeof schema.uiWorkspaces.$inferInsert,
                  });
                operationPerformed = true;
              } else if (row.entityType === "INTEGRATION_STITCH") {
                await tx
                  .insert(schema.integrationStitches)
                  .values(
                    data as typeof schema.integrationStitches.$inferInsert,
                  )
                  .onConflictDoUpdate({
                    target: [schema.integrationStitches.id],
                    set: data as typeof schema.integrationStitches.$inferInsert,
                  });
                operationPerformed = true;
              } else if (row.entityType === "FIELD_MAPPING") {
                await tx
                  .insert(schema.fieldMappings)
                  .values(data as typeof schema.fieldMappings.$inferInsert)
                  .onConflictDoUpdate({
                    target: [schema.fieldMappings.id],
                    set: data as typeof schema.fieldMappings.$inferInsert,
                  });
                operationPerformed = true;
              }
            } else if (row.action === "DELETE") {
              if (row.entityType === "APP_CONNECTION") {
                await tx
                  .delete(schema.dataSources)
                  .where(eq(schema.dataSources.id, row.entityId));
                operationPerformed = true;
              } else if (row.entityType === "UI_WORKSPACE") {
                await tx
                  .delete(schema.uiWorkspaces)
                  .where(eq(schema.uiWorkspaces.id, row.entityId));
                operationPerformed = true;
              } else if (row.entityType === "INTEGRATION_STITCH") {
                await tx
                  .delete(schema.integrationStitches)
                  .where(eq(schema.integrationStitches.id, row.entityId));
                operationPerformed = true;
              } else if (row.entityType === "FIELD_MAPPING") {
                await tx
                  .delete(schema.fieldMappings)
                  .where(eq(schema.fieldMappings.id, row.entityId));
                operationPerformed = true;
              }
            }
          });
          break; // Transaction succeeded, break retry loop!
        } catch (err) {
          attempts++;
          const isFkViolation =
            (err as { code?: string })?.code === "23503" ||
            String(err).includes("foreign key constraint");

          if (isFkViolation && attempts < maxAttempts) {
            this.logger.warn(
              `Foreign key constraint violation during replication of ${row.entityType} ${row.entityId} ` +
                `to tenant ${row.tenantId}. Retrying in ${retryDelayMs}ms (attempt ${attempts}/${maxAttempts})...`,
            );
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          } else {
            throw err; // Rethrow if it's not a FK violation or we ran out of attempts
          }
        }
      }

      // Throw if no operation was performed (unrecognized action or entityType)
      if (!operationPerformed) {
        throw new Error(
          `Unrecognized registry outbox operation: action="${row.action}", entityType="${row.entityType}"`,
        );
      }

      // --- Trigger schema provisioning if an INTEGRATION_STITCH was replicated ---
      // This MUST happen before marking the outbox as SUCCESS so that if provisioning fails,
      // the entire message is retried. Both replication and provisioning are idempotent.
      if (row.entityType === "INTEGRATION_STITCH" && row.action === "UPSERT") {
        const stitch = row.payload as {
          srcDataSourceId: string;
          destDataSourceId: string;
        };

        // Get appNames and metadata for the connections from the local replica to compute schema names
        const dataSources = await tenantDb
          .select({
            id: schema.dataSources.id,
            appName: schema.dataSources.appName,
            metadata: schema.dataSources.metadata,
          })
          .from(schema.dataSources)
          .where(
            inArray(schema.dataSources.id, [
              stitch.srcDataSourceId,
              stitch.destDataSourceId,
            ]),
          );

        // Ensure both stitch data sources are present before provisioning
        const dataSourceIds = new Set(dataSources.map((ds) => ds.id));
        if (
          !dataSourceIds.has(stitch.srcDataSourceId) ||
          !dataSourceIds.has(stitch.destDataSourceId)
        ) {
          throw new Error(
            `Stitch data sources not yet replicated: srcDataSourceId=${stitch.srcDataSourceId}, destDataSourceId=${stitch.destDataSourceId}. Retrying.`,
          );
        }

        for (const ds of dataSources) {
          const schemaName = getWorkspaceSchemaName(ds.id, ds.appName);

          // Pass context explicitly to bypass the O(N) hash-matching loop in SqlDatabaseManager
          const rawAppProfile =
            ds.metadata &&
            typeof ds.metadata === "object" &&
            "appProfile" in ds.metadata
              ? (ds.metadata.appProfile as string)
              : "";
          const appProfile =
            typeof rawAppProfile === "string" && rawAppProfile.trim() !== ""
              ? rawAppProfile.trim()
              : "standard";

          await this.dbManager.applyPlan(
            row.tenantId,
            schemaName,
            SchemaPlan.OUTBOUND_ACTIVE,
            {
              appName: ds.appName,
              appProfile,
            },
          );
          this.logger.debug(
            `Provisioned schema ${schemaName} to OUTBOUND_ACTIVE in tenant ${row.tenantId}`,
          );
        }
      }

      // Mark outbox as success ONLY after everything (including provisioning) succeeds
      await this.globalDb
        .update(globalRegistryOutbox)
        .set({ status: "SUCCESS" })
        .where(eq(globalRegistryOutbox.id, outboxId));

      this.logger.debug(
        `Successfully replicated ${row.entityType} ${row.entityId} to tenant ${row.tenantId}`,
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to replicate ${row.entityType} ${row.entityId} to tenant ${row.tenantId}: ${errorMessage}`,
      );

      // We don't mark the outbox as FAILED here because the BullMQ retry mechanism will re-queue it,
      // and eventually we will either succeed or let the dead-letter queue handle it.
      // But we must throw so BullMQ registers the failure.
      throw err;
    }
  }
}
