import {
  Controller,
  Post,
  Param,
  Headers,
  RawBody,
  NotFoundException,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  Logger,
  Inject,
} from '@nestjs/common';
import type { DrizzleDb } from '@nexiom/database';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { TriggerStrategy } from '@nexiom/connections';
import { PieceRegistryService } from './piece-registry.service';
import { TriggerExecutorService } from './trigger-executor.service';

interface ConnectionRow {
  workspace_id: string;
  app_name: string;
  trigger_name: string;
  object_type: string | null;
  auth: unknown;
  props_value: Record<string, unknown>;
  webhook_secret: string | null;
}

/**
 * Receives inbound webhook pushes from source applications.
 *
 * POST /webhooks/:connectionId
 *
 * Flow:
 *  1. Resolve the connection → appName, triggerName, auth from DB.
 *  2. Verify signature via trigger.verifySignature() — returns 401 if invalid.
 *  3. Pass raw body + headers to TriggerExecutorService.runWebhook().
 *  4. Returns 200 immediately; ingestion is handled synchronously before response.
 */
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly pieceRegistry: PieceRegistryService,
    private readonly executor: TriggerExecutorService,
  ) {}

  @Post(':connectionId')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Param('connectionId') connectionId: string,
    @Headers() headers: Record<string, string>,
    @RawBody() rawBody: Buffer,
  ): Promise<{ received: true }> {
    // 1. Resolve connection
    const conn = await this.resolveConnection(connectionId);
    if (!conn) {
      throw new NotFoundException(
        `No active webhook connection found for id: ${connectionId}`,
      );
    }

    // 2. Resolve trigger
    const trigger = this.pieceRegistry.getTrigger(
      conn.app_name,
      conn.trigger_name,
    );
    if (!trigger || trigger.type !== TriggerStrategy.WEBHOOK) {
      throw new NotFoundException(
        `No webhook trigger '${conn.trigger_name}' registered for app '${conn.app_name}'`,
      );
    }

    // 3. Signature verification (throws on failure → 401)
    try {
      await this.executor.runWebhook({
        trigger,
        appName: conn.app_name,
        triggerName: conn.trigger_name,
        objectType: conn.object_type ?? undefined,
        auth: conn.auth,
        propsValue: conn.props_value,
        workspaceId: conn.workspace_id,
        headers,
        rawBody,
        secret: conn.webhook_secret ?? undefined,
      });
    } catch (err) {
      // Re-throw signature errors as 401; anything else surfaces as 500
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error('Webhook processing failed', {
        connectionId,
        appName: conn.app_name,
        triggerName: conn.trigger_name,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    return { received: true };
  }

  private async resolveConnection(
    connectionId: string,
  ): Promise<ConnectionRow | null> {
    const result = await this.db.$client.query<ConnectionRow>(
      `SELECT
                ac.workspace_id,
                ac.app_name,
                ac.trigger_name,
                ac.object_type,
                ac.encrypted_credentials AS auth,
                ac.props_value,
                ac.webhook_secret
             FROM app_credential ac
             WHERE ac.id = $1
               AND ac.status = 'active'
             LIMIT 1`,
      [connectionId],
    );
    return result.rows[0] ?? null;
  }
}
