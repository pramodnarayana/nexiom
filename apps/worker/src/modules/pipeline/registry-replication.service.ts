import { Injectable, Inject, OnModuleInit, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { QueueService, QueueName } from "@nexiom/queue";
import { DATABASE_CONNECTION, globalRegistryOutbox } from "@nexiom/database";
import type { DrizzleDb } from "@nexiom/database";
import { DB_MANAGER } from "@nexiom/dbmanager";
import type { DatabaseManager } from "@nexiom/dbmanager";
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
      const maxAttempts = 3;
      const retryDelayMs = 1000;

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
                  .insert(schema.appConnections)
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                  .values(connData as any)
                  .onConflictDoUpdate({
                    target: [schema.appConnections.id],
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    set: connData as any,
                  });
                operationPerformed = true;
              } else if (row.entityType === "INTEGRATION_STITCH") {
                await tx
                  .insert(schema.integrationStitches)
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                  .values(data as any)
                  .onConflictDoUpdate({
                    target: [schema.integrationStitches.id],
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    set: data as any,
                  });
                operationPerformed = true;
              } else if (row.entityType === "FIELD_MAPPING") {
                await tx
                  .insert(schema.fieldMappings)
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                  .values(data as any)
                  .onConflictDoUpdate({
                    target: [schema.fieldMappings.id],
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    set: data as any,
                  });
                operationPerformed = true;
              }
            } else if (row.action === "DELETE") {
              if (row.entityType === "APP_CONNECTION") {
                await tx
                  .delete(schema.appConnections)
                  .where(eq(schema.appConnections.id, row.entityId));
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

      // Mark outbox as success
      await this.globalDb
        .update(globalRegistryOutbox)
        .set({ status: "SUCCESS" })
        .where(eq(globalRegistryOutbox.id, outboxId));

      this.logger.debug(
        `Successfully replicated ${row.entityType} ${row.entityId} to tenant ${row.tenantId}`,
      );
    } catch (err) {
      const lastError = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to replicate ${row.entityType} ${row.entityId} to tenant ${row.tenantId}: ${lastError}`,
      );

      // We don't mark the outbox as FAILED here because the BullMQ retry mechanism will re-queue it,
      // and eventually we will either succeed or let the dead-letter queue handle it.
      // But we must throw so BullMQ registers the failure.
      throw err;
    }
  }
}
