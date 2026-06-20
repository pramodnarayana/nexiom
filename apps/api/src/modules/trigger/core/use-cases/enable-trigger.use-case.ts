import { Injectable, Inject, Logger } from '@nestjs/common';
import type { Trigger } from '@soopa/piece-framework';
import type { TriggerStorageResolverPort } from '../ports/outbound/trigger-storage-resolver.port.js';
import { KeyValueTriggerStore } from '../../key-value-trigger-store.js';
import type { IKeyValueStore } from '@soopa/cache';

export interface EnableTriggerParams {
  trigger: Trigger;
  appName: string;
  triggerName: string;
  objectType: string | undefined;
  auth: unknown;
  propsValue: Record<string, unknown>;
  tenantId: string;
  workspaceId: string;
  dataSourceId: string;
  appProfile: string;
}

@Injectable()
export class EnableTriggerUseCase {
  private readonly logger = new Logger(EnableTriggerUseCase.name);

  constructor(
    @Inject('TRIGGER_STORAGE_RESOLVER_PORT')
    private readonly storageResolver: TriggerStorageResolverPort,
    @Inject('KEY_VALUE_STORE') private readonly kvStore: IKeyValueStore,
  ) {}

  async execute(params: EnableTriggerParams): Promise<void> {
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

    // We verify the connection has a valid schema resolved (throws if missing)
    await this.storageResolver.resolveSchemaName(params.dataSourceId);

    // Call out to the third-party provider to actually register the webhook
    await params.trigger.onEnable?.(context);
  }
}
