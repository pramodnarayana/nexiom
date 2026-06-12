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
import { RunWebhookUseCase } from './core/use-cases/run-webhook.use-case.js';
import type { TriggerAppConnectionRepositoryPort } from './core/ports/outbound/trigger-app-connection-repository.port.js';
import { PieceRegistryService } from '@soopa/piece-registry';

/**
 * Receives inbound webhook pushes from source applications.
 *
 * POST /webhooks/:dataSourceId
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
    @Inject('TRIGGER_APP_CONNECTION_REPOSITORY_PORT')
    private readonly connectionRepo: TriggerAppConnectionRepositoryPort,
    private readonly pieceRegistry: PieceRegistryService,
    private readonly runWebhookUseCase: RunWebhookUseCase,
  ) {}

  @Post(':dataSourceId')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Param('dataSourceId') dataSourceId: string,
    @Headers() headers: Record<string, string>,
    @RawBody() rawBody: Buffer,
  ): Promise<{ received: true }> {
    const conn = await this.connectionRepo.findActiveConnection(dataSourceId);
    if (!conn) {
      throw new NotFoundException(
        `No active webhook connection found for id: ${dataSourceId}`,
      );
    }

    const trigger = this.pieceRegistry.getTrigger(
      conn.appName,
      conn.triggerName,
    );
    if (!trigger || trigger.type !== 'WEBHOOK') {
      throw new NotFoundException(
        `No webhook trigger '${conn.triggerName}' registered for app '${conn.appName}'`,
      );
    }

    try {
      await this.runWebhookUseCase.execute({
        trigger,
        appName: conn.appName,
        triggerName: conn.triggerName,
        objectType: conn.objectType,
        auth: conn.auth,
        propsValue: conn.propsValue,
        tenantId: conn.tenantId,
        workspaceId: conn.workspaceId,
        dataSourceId,
        headers,
        rawBody,
        secret: conn.webhookSecret,
      });
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error('Webhook processing failed', {
        dataSourceId,
        appName: conn.appName,
        triggerName: conn.triggerName,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    return { received: true };
  }
}
