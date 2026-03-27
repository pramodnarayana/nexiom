import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { DrizzleDb } from '@nexiom/database';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { TriggerExecutorService } from './trigger-executor.service.js';
import { PieceRegistryService } from '@nexiom/engine';

interface ActiveConnection {
  workspace_id: string;
  app_name: string;
  trigger_name: string;
  object_type: string | null;
  auth: unknown;
  props_value: Record<string, unknown>;
  created_at: string; // keyset cursor field
}

/** Page size for the keyset-paginated connection query. */
const PAGE_SIZE = 200;

/**
 * Cron-driven polling kernel.
 *
 * Every 5 minutes:
 *  1. Pages through active connections using keyset pagination (created_at +
 *     workspace_id) so no single query loads unbounded rows.
 *  2. Dispatches each connection to TriggerExecutorService.runPoll().
 *  3. When runPoll() returns false (lock contention), logs structured telemetry
 *     but does NOT re-queue the connection — the next cron tick will retry it.
 *
 * Connections are processed with bounded parallelism (MAX_CONCURRENCY).
 */
@Injectable()
export class PollerService {
  private readonly logger = new Logger(PollerService.name);
  private readonly MAX_CONCURRENCY = 10;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly executor: TriggerExecutorService,
    private readonly pieceRegistry: PieceRegistryService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async poll(): Promise<void> {
    this.logger.log('Polling cycle started');

    try {
      await this.processAllConnections();
    } catch (err) {
      this.logger.error('Polling cycle error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    this.logger.log('Polling cycle complete');
  }

  // ─── Page-driven execution loop ──────────────────────────────────────────

  private async processAllConnections(): Promise<void> {
    let cursor: { created_at: string; workspace_id: string } | undefined;
    let totalProcessed = 0;

    while (true) {
      const page = await this.fetchActivePollingConnectionsBatch(cursor);
      if (page.length === 0) break;

      totalProcessed += page.length;
      await this.processBatch(page);

      const last = page.at(-1)!;
      cursor = { created_at: last.created_at, workspace_id: last.workspace_id };

      if (page.length < PAGE_SIZE) break; // last page
    }

    if (totalProcessed > 0) {
      this.logger.log(
        `Polling cycle dispatched ${totalProcessed} connection(s)`,
      );
    } else {
      this.logger.debug('No active polling connections found');
    }
  }

  // ─── Batch processing ─────────────────────────────────────────────────────

  private async processBatch(connections: ActiveConnection[]): Promise<void> {
    for (let i = 0; i < connections.length; i += this.MAX_CONCURRENCY) {
      const batch = connections.slice(i, i + this.MAX_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((conn) => this.processConnection(conn)),
      );

      results.forEach((result, idx) => {
        if (result.status === 'rejected') {
          const conn = batch[idx];
          this.logger.error('Connection poll failed', {
            appName: conn?.app_name,
            workspaceId: conn?.workspace_id,
            triggerName: conn?.trigger_name,
            reason:
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
          });
        }
      });
    }
  }

  // ─── Single connection ────────────────────────────────────────────────────

  private async processConnection(conn: ActiveConnection): Promise<void> {
    const trigger = this.pieceRegistry.getTrigger(
      conn.app_name,
      conn.trigger_name,
    );
    if (!trigger || trigger.type !== 'POLLING') return;

    const executed = await this.executor.runPoll({
      trigger,
      appName: conn.app_name,
      triggerName: conn.trigger_name,
      objectType: conn.object_type ?? undefined,
      auth: conn.auth,
      propsValue: conn.props_value,
      workspaceId: conn.workspace_id,
    });

    if (!executed) {
      // Lock was held by another pod — emit observable telemetry so SRE can
      // detect chronic contention and tune cron frequency or concurrency.
      this.logger.warn('Poll skipped — lock contention', {
        appName: conn.app_name,
        triggerName: conn.trigger_name,
        workspaceId: conn.workspace_id,
        reason: 'lock_contention',
      });
    }
  }

  // ─── Keyset-paginated query ───────────────────────────────────────────────

  /**
   * Returns a bounded page of active polling connections ordered by
   * (created_at, workspace_id) for stable keyset pagination.
   *
   * Using keyset instead of OFFSET means each page query is O(log n) and
   * never loads unbounded rows into memory, regardless of total row count.
   */
  async fetchActivePollingConnectionsBatch(after?: {
    created_at: string;
    workspace_id: string;
  }): Promise<ActiveConnection[]> {
    const params: unknown[] = [PAGE_SIZE];
    let where = `ac.trigger_name IS NOT NULL AND ac.status = 'active'`;

    if (after) {
      // Continue from (created_at, workspace_id) keyset
      where += ` AND (ac.created_at, ac.workspace_id) > ($2, $3)`;
      params.push(after.created_at, after.workspace_id);
    }

    const result = await this.db.$client.query<ActiveConnection>(
      `SELECT
                ac.workspace_id,
                ac.app_name,
                ac.trigger_name,
                ac.object_type,
                ac.encrypted_credentials AS auth,
                ac.props_value,
                ac.created_at
             FROM app_credential ac
             WHERE ${where}
             ORDER BY ac.created_at ASC, ac.workspace_id ASC
             LIMIT $1`,
      params,
    );
    return result.rows;
  }
}
