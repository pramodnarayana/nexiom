import { Injectable, Inject, Logger } from '@nestjs/common';
import { ITriggerDlqService } from './interfaces/trigger-dlq.interface.js';
import type { PollRunParams } from './core/use-cases/run-poll.use-case.js';
import type { WebhookRunParams } from './core/use-cases/run-webhook.use-case.js';

@Injectable()
export class TriggerRetryPolicyService {
  constructor(
    @Inject(ITriggerDlqService) private readonly dlqService: ITriggerDlqService,
  ) {}

  async handleRecordIngestFailure(
    params: PollRunParams | WebhookRunParams,
    fromDlqRetry: boolean,
    records: unknown[],
    currentIndex: number,
    sourceEventId: string,
    err: unknown,
    logger: Logger,
  ): Promise<void> {
    logger.error('Record ingest failed', {
      sourceEventId,
      appName: params.appName,
      triggerName: params.triggerName,
      workspaceId: params.workspaceId,
      error: err instanceof Error ? err.message : String(err),
    });

    if (fromDlqRetry) {
      throw err;
    }

    const remainingRecords = records.slice(currentIndex);
    let dlqParams: Record<string, unknown> = params as unknown as Record<
      string,
      unknown
    >;
    if ('payload' in params) {
      const withPayload = params as unknown as { payload: unknown };
      dlqParams = {
        ...(params as Record<string, unknown>),
        payload: Array.isArray(withPayload.payload)
          ? remainingRecords
          : withPayload.payload,
      };
    }

    await this.pushToDlq(
      dlqParams as unknown as PollRunParams | WebhookRunParams,
      err,
    );
    throw err;
  }

  async pushToDlq(
    params: PollRunParams | WebhookRunParams,
    err: unknown,
  ): Promise<void> {
    const job = JSON.stringify({
      appName: params.appName,
      triggerName: params.triggerName,
      tenantId: params.tenantId,
      workspaceId: params.workspaceId,
      dataSourceId: params.dataSourceId,
      objectType: params.objectType,
      propsValue: params.propsValue,
      auth: params.auth,
      payload:
        'payload' in params
          ? (params as Record<string, unknown>).payload
          : undefined,
      failedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
      attempt: 1,
    });
    await this.dlqService.pushJob(job);
  }
}
