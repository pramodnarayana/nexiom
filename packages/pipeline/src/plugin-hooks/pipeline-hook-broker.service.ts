import { Injectable, Logger } from '@nestjs/common';
import type { PluginPipelineHooks, AppsConnectorDb } from '@soopa/piece-framework';
import { PieceRegistryService } from '@soopa/piece-registry';

@Injectable()
export class PipelineHookBrokerService {
  private readonly logger = new Logger(PipelineHookBrokerService.name);

  constructor(private readonly pieceRegistry: PieceRegistryService) {}

  private getHooks(appName: string, hookName: string): PluginPipelineHooks {
    const piece = this.pieceRegistry.getPiece(appName) as unknown as { appHooks?: PluginPipelineHooks };
    if (!piece) {
      throw new Error(`[PipelineHookBroker] Piece not found in registry: ${appName}`);
    }
    const hooks = piece.appHooks;
    if (!hooks) {
      throw new Error(`[PipelineHookBroker] PluginPipelineHooks not defined for piece: ${appName}. Cannot execute ${hookName}.`);
    }
    return hooks;
  }

  async extractReplica(
    appName: string,
    appProfile: string,
    payload: unknown,
    context?: { objectType?: string | null },
  ): Promise<ReturnType<PluginPipelineHooks['extractReplica']>> {
    this.logger.debug({ event: 'hook.extractReplica', appName, appProfile }, 'Executing extractReplica hook');
    const hooks = this.getHooks(appName, 'extractReplica');
    if (!hooks.extractReplica) {
      throw new Error(`[PipelineHookBroker] extractReplica hook not implemented by piece: ${appName}`);
    }
    return hooks.extractReplica(payload, context);
  }

  async normalize(
    appName: string,
    appProfile: string,
    replica: { entityType: string; data: Record<string, unknown> },
  ): Promise<ReturnType<PluginPipelineHooks['normalize']>> {
    this.logger.debug({ event: 'hook.normalize', appName, appProfile }, 'Executing normalize hook');
    const hooks = this.getHooks(appName, 'normalize');
    if (!hooks.normalize) {
      return null;
    }
    return hooks.normalize(replica);
  }

  async writeNormalized(
    appName: string,
    appProfile: string,
    tx: unknown,
    db: AppsConnectorDb,
    schemaName: string,
    replicaId: string,
    entityId: string,
    traceId: string,
    dataSourceId: string,
    normalizedEntityType: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    this.logger.debug({ event: 'hook.writeNormalized', appName, appProfile, normalizedEntityType }, 'Executing writeNormalized hook');
    const hooks = this.getHooks(appName, 'writeNormalized');
    if (!hooks.writeNormalized) {
      throw new Error(`[PipelineHookBroker] writeNormalized hook not implemented by piece: ${appName}`);
    }
    await hooks.writeNormalized(tx, db, schemaName, replicaId, entityId, traceId, dataSourceId, normalizedEntityType, data);
  }

  async buildTarget(
    appName: string,
    appProfile: string,
    db: AppsConnectorDb,
    schemaName: string,
    normalizedEntityType: string,
    srcEntityId: string,
  ): Promise<Record<string, unknown>> {
    this.logger.debug({ event: 'hook.buildTarget', appName, appProfile, normalizedEntityType }, 'Executing buildTarget hook');
    const hooks = this.getHooks(appName, 'buildTarget');
    if (!hooks.buildTarget) {
      throw new Error(`[PipelineHookBroker] buildTarget hook not implemented by piece: ${appName}`);
    }
    return hooks.buildTarget(db, schemaName, normalizedEntityType, srcEntityId);
  }

  async provisionDomain(
    appName: string,
    appProfile: string,
    db: AppsConnectorDb,
    schemaName: string,
  ): Promise<void> {
    this.logger.log({ event: 'hook.provisionDomain', appName, appProfile, schemaName }, 'Executing provisionDomain hook');
    const hooks = this.getHooks(appName, 'provisionDomain');
    if (hooks.provisionDomain) {
      await hooks.provisionDomain(db, schemaName);
      return;
    }
    this.logger.debug({ event: 'hook.provisionDomain', appName, appProfile }, 'No domain provisioner registered. Skipping.');
  }

  async prepareUpdate(
    appName: string,
    appProfile: string,
    payload: Record<string, any>,
    destId?: string,
    destState?: Record<string, any>,
  ): Promise<Record<string, any>> {
    this.logger.debug({ event: 'hook.prepareUpdate', appName, appProfile, destId }, 'prepareUpdate hook is not implemented in registry yet. Passing through.');
    return payload;
  }

  async getWebhookResponse(
    appName: string,
    appProfile: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<ReturnType<NonNullable<PluginPipelineHooks['getWebhookResponse']>> | null> {
    const hooks = this.getHooks(appName, 'getWebhookResponse');
    if (hooks.getWebhookResponse) {
      return hooks.getWebhookResponse(body, headers);
    }
    return null;
  }

  async activeFetch(
    appName: string,
    appProfile: string,
    missingDependencies: Array<{ entityType: string; sourceId: string }>,
    dataSourceId: string,
  ): Promise<void> {
    const hooks = this.getHooks(appName, 'activeFetch');
    if (!hooks.activeFetch) {
      throw new Error(`[PipelineHookBroker] activeFetch hook is not implemented by piece: ${appName}`);
    }
    return hooks.activeFetch(missingDependencies, dataSourceId);
  }

  async reverseLookup(
    appName: string,
    appProfile: string,
    db: AppsConnectorDb,
    schemaName: string,
    normalizedEntityType: string,
    entityId: string,
  ): Promise<string[]> {
    this.logger.debug({ event: 'hook.reverseLookup', appName, appProfile, normalizedEntityType }, 'reverseLookup hook is not implemented in registry yet. Skipping.');
    return [];
  }
}
