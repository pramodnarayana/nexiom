import { Injectable, Inject, Logger } from '@nestjs/common';
import type { Trigger } from '@soopa/piece-framework';
import type { TriggerGatewayRepositoryPort } from '../ports/outbound/trigger-gateway-repository.port.js';
import type { TriggerStorageResolverPort } from '../ports/outbound/trigger-storage-resolver.port.js';
import { IDistributedLockService } from '../../interfaces/distributed-lock.interface.js';
import { TriggerPayloadTransformer } from '../../trigger-payload-transformer.js';
import { TriggerRetryPolicyService } from '../../trigger-retry-policy.service.js';
import { KeyValueTriggerStore } from '../../key-value-trigger-store.js';
import type { IKeyValueStore } from '@soopa/cache';

export interface PollRunParams {
  trigger: Trigger;
  appName: string;
  triggerName: string;
  objectType: string | undefined;
  auth: unknown;
  propsValue: Record<string, unknown>;
  tenantId: string;
  workspaceId: string;
  dataSourceId: string;
}

@Injectable()
export class RunPollUseCase {
  private readonly logger = new Logger(RunPollUseCase.name);
  private readonly LOCK_TTL_MS = 5 * 60 * 1000;

  constructor(
    @Inject('TRIGGER_GATEWAY_REPOSITORY_PORT')
    private readonly gatewayRepo: TriggerGatewayRepositoryPort,
    @Inject('TRIGGER_STORAGE_RESOLVER_PORT')
    private readonly storageResolver: TriggerStorageResolverPort,
    @Inject(IDistributedLockService)
    private readonly lockService: IDistributedLockService,
    private readonly retryPolicyService: TriggerRetryPolicyService,
    private readonly payloadTransformer: TriggerPayloadTransformer,
    @Inject('KEY_VALUE_STORE') private readonly kvStore: IKeyValueStore,
  ) {}

  async execute(params: PollRunParams, fromDlqRetry = false): Promise<boolean> {
    const lockKey = `lock:poll:${params.workspaceId}:${params.triggerName}`;
    const token = await this.lockService.acquireLock(lockKey, this.LOCK_TTL_MS);

    if (!token) {
      this.logger.debug('Skipping poll — lock already held', {
        workspaceId: params.workspaceId,
        triggerName: params.triggerName,
      });
      return false;
    }

    try {
      await this.executeAndIngest(params, fromDlqRetry);
      return true;
    } finally {
      await this.lockService.releaseLock(lockKey, token);
    }
  }

  private async executeAndIngest(
    params: PollRunParams,
    fromDlqRetry: boolean,
  ): Promise<void> {
    const store = new KeyValueTriggerStore(
      this.kvStore,
      params.workspaceId,
      params.appName,
      params.objectType,
      params.triggerName,
    );

    const context = {
      auth: params.auth,
      propsValue: params.propsValue,
      store,
      payload: undefined,
      metadata: {
        workspaceId: params.workspaceId,
        triggerName: params.triggerName,
        appName: params.appName,
        objectType: params.objectType,
      },
    };

    let records: unknown[];

    try {
      records = await params.trigger.run(context);
    } catch (err) {
      if (fromDlqRetry) throw err;

      this.logger.error('trigger.run() failed — pushing to DLQ', {
        appName: params.appName,
        triggerName: params.triggerName,
        workspaceId: params.workspaceId,
        error: err instanceof Error ? err.message : String(err),
      });
      await this.retryPolicyService.pushToDlq(params, err);
      return;
    }

    if (records.length === 0) return;

    const schemaName = await this.storageResolver.resolveSchemaName(
      params.dataSourceId,
    );

    let currentIndex = 0;

    for (const record of records) {
      const sourceEventId = this.payloadTransformer.buildSourceEventId(
        params.workspaceId,
        params.triggerName,
        record,
      );

      try {
        const didInsert = await this.gatewayRepo.insertGatewayRow(schemaName, {
          dataSourceId: params.dataSourceId,
          objectType: params.objectType,
          payload: record,
          extReqId: sourceEventId,
        });

        if (didInsert) {
          const sourceCursor =
            this.payloadTransformer.extractRecordCursor(record);
          if (sourceCursor !== undefined) {
            await store.put('last_cursor', sourceCursor);
          }
        }
      } catch (err) {
        await this.retryPolicyService.handleRecordIngestFailure(
          params,
          fromDlqRetry,
          records,
          currentIndex,
          sourceEventId,
          err,
          this.logger,
        );
      }

      currentIndex++;
    }
  }
}
