import { Injectable, Inject, Logger } from '@nestjs/common';
import { ITriggerDlqService } from './interfaces/trigger-dlq.interface.js';
import type {
  TriggerRunParams,
  WebhookRunParams,
} from './trigger-executor.service.js';

@Injectable()
export class TriggerRetryPolicyService {
  constructor(
    @Inject(ITriggerDlqService) private readonly dlqService: ITriggerDlqService,
  ) {}

  async handleRecordIngestFailure(
    params: TriggerRunParams | WebhookRunParams,
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
    let dlqParams: TriggerRunParams | WebhookRunParams = params;
    if ('payload' in params) {
      dlqParams = {
        ...params,
        payload: Array.isArray(params.payload)
          ? remainingRecords
          : params.payload,
      };
    }

    await this.pushToDlq(dlqParams, err);
    throw err;
  }

  async pushToDlq(
    params: TriggerRunParams | WebhookRunParams,
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
      payload: 'payload' in params ? params.payload : undefined,
      failedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
      attempt: 1,
    });
    await this.dlqService.pushJob(job);
  }
}
