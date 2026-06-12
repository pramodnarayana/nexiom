import { Injectable, Inject, Logger } from '@nestjs/common';
import type { Trigger } from '@soopa/piece-framework';
import type { TriggerGatewayRepositoryPort } from '../ports/outbound/trigger-gateway-repository.port.js';
import type { TriggerStorageResolverPort } from '../ports/outbound/trigger-storage-resolver.port.js';
import type { DatabaseProvisionerPort } from '../ports/outbound/database-provisioner.port.js';
import { KeyValueTriggerStore } from '../../key-value-trigger-store.js';
import type { IKeyValueStore } from '@soopa/cache';
import { SchemaPlan } from '@soopa/dbmanager';

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
    @Inject('TRIGGER_GATEWAY_REPOSITORY_PORT')
    private readonly gatewayRepo: TriggerGatewayRepositoryPort,
    @Inject('TRIGGER_STORAGE_RESOLVER_PORT')
    private readonly storageResolver: TriggerStorageResolverPort,
    @Inject('DATABASE_PROVISIONER_PORT')
    private readonly dbProvisioner: DatabaseProvisionerPort,
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

    let wroteRegistryRow = false;
    let registeredPublication = false;
    let resolvedSchemaName: string | undefined;

    try {
      resolvedSchemaName = await this.storageResolver.resolveSchemaName(
        params.dataSourceId,
      );

      await this.dbProvisioner.applyPlan({
        tenantId: params.tenantId,
        schemaName: resolvedSchemaName,
        schemaPlan: SchemaPlan.OUTBOUND_ACTIVE,
        appName: params.appName,
        appProfile: params.appProfile,
      });

      await this.dbProvisioner.registerPublication(resolvedSchemaName);
      registeredPublication = true;

      await params.trigger.onEnable?.(context);

      wroteRegistryRow = true;
      await this.gatewayRepo.updateSchemaPlan(
        params.dataSourceId,
        SchemaPlan.OUTBOUND_ACTIVE,
      );
    } catch (err) {
      if (wroteRegistryRow) {
        try {
          await this.gatewayRepo.updateSchemaPlan(
            params.dataSourceId,
            SchemaPlan.NAMESPACE_ONLY,
          );
        } catch (revertErr: unknown) {
          this.logger.error(
            'Failed to revert schemaPlan after onEnable failure',
            { error: revertErr },
          );
        }
      }

      if (registeredPublication && resolvedSchemaName) {
        try {
          await this.dbProvisioner.unregisterPublication(resolvedSchemaName);
        } catch (pubRevertErr: unknown) {
          this.logger.error(
            'Failed to revert publication registration after onEnable failure',
            { error: pubRevertErr },
          );
        }
      }

      throw err;
    }
  }
}
