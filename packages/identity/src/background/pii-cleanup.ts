import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Logger } from "@nestjs/common";
import { lt, and, isNotNull, or, inArray } from "drizzle-orm";
import * as schema from "../schema.js";

/**
 * Anonymizes PII (IP Address, User Agent) from old sessions.
 * Scheduled to run daily.
 */
export async function runPIICleanup(
  db: NodePgDatabase<typeof schema>,
  logger: Logger,
): Promise<void> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  logger.log(
    `Starting PII Cleanup for sessions older than ${thirtyDaysAgo.toISOString()}`,
  );

  let totalAnonymized = 0;
  const BATCH_SIZE = 10000;
  const BATCH_DELAY_MS = 100; // Delay between batches to reduce database pressure
  const MAX_ITERATIONS = 1000; // Safety limit: 10M sessions max
  let iterations = 0;

  try {
    while (true) {
      // 1. Find a batch of IDs to update
      // We select IDs first to keep the transaction short and memory usage low
      const sessionsToUpdate = await db
        .select({ id: schema.session.id })
        .from(schema.session)
        .where(
          and(
            lt(schema.session.createdAt, thirtyDaysAgo),
            or(
              isNotNull(schema.session.ipAddress),
              isNotNull(schema.session.userAgent),
            ),
          ),
        )
        .limit(BATCH_SIZE);

      if (sessionsToUpdate.length === 0) {
        break;
      }

      const ids = sessionsToUpdate.map((s) => s.id);

      // 2. Update the batch and get actual affected rows
      const start = Date.now();
      const updatedRows = await db
        .update(schema.session)
        .set({
          ipAddress: null,
          userAgent: null,
          updatedAt: new Date(),
        })
        .where(inArray(schema.session.id, ids))
        .returning({ id: schema.session.id });

      // Use actual affected row count from the database operation
      // This is more accurate than ids.length in case of concurrent deletions
      const affectedCount = updatedRows.length;
      totalAnonymized += affectedCount;

      const duration = Date.now() - start;
      logger.debug(
        `Anonymized batch of ${affectedCount} sessions in ${duration}ms`,
      );

      // Small delay between batches to reduce database pressure
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));

      // Safety check: prevent infinite loops
      iterations++;
      if (iterations >= MAX_ITERATIONS) {
        logger.warn(
          `Reached maximum iteration limit (${MAX_ITERATIONS}). Stopping cleanup.`,
        );
        break;
      }
    }

    logger.log(`PII Cleanup complete. Anonymized ${totalAnonymized} sessions.`);
  } catch (error) {
    logger.error(
      "PII Cleanup failed",
      error instanceof Error ? error.stack : undefined,
    );
    throw error;
  }
}
