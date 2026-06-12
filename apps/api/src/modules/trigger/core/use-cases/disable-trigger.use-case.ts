import { Injectable, Inject, Logger } from '@nestjs/common';
import type { Trigger } from '@soopa/piece-framework';
import { KeyValueTriggerStore } from '../../key-value-trigger-store.js';
import type { IKeyValueStore } from '@soopa/cache';

export interface DisableTriggerParams {
  trigger: Trigger;
  appName: string;
  triggerName: string;
  objectType: string | undefined;
  auth: unknown;
  propsValue: Record<string, unknown>;
  workspaceId: string;
}

@Injectable()
export class DisableTriggerUseCase {
  private readonly logger = new Logger(DisableTriggerUseCase.name);

  constructor(
    @Inject('KEY_VALUE_STORE') private readonly kvStore: IKeyValueStore,
  ) {}

  async execute(params: DisableTriggerParams): Promise<void> {
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

    try {
      await params.trigger.onDisable?.(context);
    } catch (err) {
      this.logger.error('onDisable failed', {
        appName: params.appName,
        triggerName: params.triggerName,
        workspaceId: params.workspaceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
