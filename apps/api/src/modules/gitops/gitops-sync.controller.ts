import {
  Controller,
  Post,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { GitopsWebhookGuard } from './gitops-webhook.guard.js';
import { QueueService, QueueName } from '@nexiom/queue';

/**
 * GitopsSyncController
 *
 * Receives webhook notifications from GitHub/GitLab when application code
 * is pushed to the integrations repository. Publishes a message to the
 * GitopsQueue so the worker can immediately run git pull and hot-reload
 * the updated application shard — without waiting for the 5-minute cron.
 *
 * Register this endpoint in GitHub:
 *   Settings → Webhooks → Payload URL:
 *     https://api.nexiom.io/internal/gitops/sync
 *   Secret: <GITOPS_WEBHOOK_SECRET>
 *   Content type: application/json
 *   Events: Just the push event
 */
@Controller('internal/gitops')
@UseGuards(GitopsWebhookGuard)
export class GitopsSyncController {
  private readonly logger = new Logger(GitopsSyncController.name);

  constructor(private readonly queueService: QueueService) {}

  /**
   * POST /internal/gitops/sync
   *
   * Accepts a push notification from GitHub/GitLab and triggers an
   * immediate shard synchronization in the worker.
   *
   * Returns 202 Accepted immediately — the sync is performed asynchronously
   * by the worker consuming the GitopsQueue.
   */
  @Post('sync')
  @HttpCode(HttpStatus.ACCEPTED)
  async triggerSync(): Promise<{ accepted: boolean }> {
    this.logger.log(
      'GitOps webhook received — publishing sync request to GitopsQueue',
    );

    await this.queueService.send(QueueName.GitopsQueue, {
      triggeredAt: new Date().toISOString(),
      source: 'webhook',
    });

    return { accepted: true };
  }
}
