import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { DrizzleDb } from '@nexiom/database';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { TriggerStrategy } from '@nexiom/connections';
import { TriggerExecutorService } from './trigger-executor.service';
import { PieceRegistryService } from './piece-registry.service';

interface ActiveConnection {
  workspace_id: string;
  app_name: string;
  trigger_name: string;
  object_type: string | null;
  auth: unknown;
  props_value: Record<string, unknown>;
}

/**
 * Cron-driven polling kernel.
 *
 * Every 5 minutes:
 *  1. Queries all active connections that have a registered Polling trigger.
 *  2. Dispatches each connection to TriggerExecutorService.runPoll().
 *  3. Each runPoll() acquires its own Redis lock — safe to run across multiple pods.
 *
 * Connections are processed with bounded parallelism (MAX_CONCURRENCY) to
 * avoid overwhelming the database and upstream APIs simultaneously.
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

    let connections: ActiveConnection[];
    try {
      connections = await this.fetchActivePollingConnections();
    } catch (err) {
      this.logger.error('Failed to fetch active connections', {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    if (connections.length === 0) {
      this.logger.debug('No active polling connections found');
      return;
    }

    this.logger.log(
      `Processing ${connections.length} active polling connection(s)`,
    );

    // Bounded concurrency — process MAX_CONCURRENCY connections at a time
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

    this.logger.log('Polling cycle complete');
  }

  private async processConnection(conn: ActiveConnection): Promise<void> {
    const trigger = this.pieceRegistry.getTrigger(
      conn.app_name,
      conn.trigger_name,
    );
    if (!trigger || trigger.type !== TriggerStrategy.POLLING) return;

    await this.executor.runPoll({
      trigger,
      appName: conn.app_name,
      triggerName: conn.trigger_name,
      objectType: conn.object_type ?? undefined,
      auth: conn.auth,
      propsValue: conn.props_value,
      workspaceId: conn.workspace_id,
    });
  }

  private async fetchActivePollingConnections(): Promise<ActiveConnection[]> {
    // Query for connections that have a configured polling trigger.
    // The trigger_name and object_type columns are expected on app_credential
    // (or a future routes/subscriptions table).
    const result = await this.db.$client.query<ActiveConnection>(
      `SELECT
                ac.workspace_id,
                ac.app_name,
                ac.trigger_name,
                ac.object_type,
                ac.encrypted_credentials AS auth,
                ac.props_value
             FROM app_credential ac
             WHERE ac.trigger_name IS NOT NULL
               AND ac.status = 'active'`,
    );
    return result.rows;
  }
}
