import { QueueName } from "@soopa/queue";
import type { DrizzleDb } from "@soopa/database";
import { credentials } from "@soopa/database";
import { eq } from "drizzle-orm";
import type { OutboxRow } from "../core/ports/outbound/outbox-repository.port.js";

export interface OutboxTypeConfig {
  queueName: QueueName;
  onPermanentFailure?: (row: OutboxRow, globalDb: DrizzleDb) => Promise<void>;
}

export const ENTITY_TYPE_CONFIG_MAP: Record<string, OutboxTypeConfig> = {
  SCHEMA_PROVISION: {
    queueName: QueueName.SchemaProvisionQueue,
    onPermanentFailure: async (row, globalDb) => {
      const outboxRow = row as OutboxRow & {
        entityId?: string;
        entity_id?: string;
      };
      const id = outboxRow.entityId || outboxRow.entity_id;
      if (id) {
        await globalDb
          .update(credentials)
          .set({ status: "FAILED" })
          .where(eq(credentials.dataSourceId, id));
      }
    },
  },
  APP_CONNECTION: { queueName: QueueName.RegistryReplicationQueue },
  UI_WORKSPACE: { queueName: QueueName.RegistryReplicationQueue },
  INTEGRATION_STITCH: { queueName: QueueName.RegistryReplicationQueue },
  FIELD_MAPPING: { queueName: QueueName.RegistryReplicationQueue },
};
