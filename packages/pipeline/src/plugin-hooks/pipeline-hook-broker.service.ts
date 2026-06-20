import { Injectable, Logger } from '@nestjs/common';
import {
  getReplicaExtractor,
  getNormalizer,
  getNormalizedWriter,
  getTargetBuilder,
  getDomainProvisioner,
  executeAppWebhookResponses,
} from '@soopa/piece-framework';
import type { ApplicationShardModule, AppsConnectorDb } from '@soopa/piece-framework';

@Injectable()
export class PipelineHookBrokerService {
  private readonly logger = new Logger(PipelineHookBrokerService.name);

  async extractReplica(
    appName: string,
    appProfile: string,
    payload: unknown,
  ): Promise<ReturnType<ApplicationShardModule['extractReplica']>> {
    this.logger.debug({ event: 'hook.extractReplica', appName, appProfile }, 'Executing extractReplica hook');
    const extractor = getReplicaExtractor(appName, appProfile);
    if (extractor) {
      return extractor(payload);
    }
    throw new Error(`[PipelineHookBroker] extractReplica hook not registered for piece: ${appName}`);
  }

  async normalize(
    appName: string,
    appProfile: string,
    replica: { entityType: string; data: Record<string, unknown> },
  ): Promise<ReturnType<ApplicationShardModule['normalize']>> {
    this.logger.debug({ event: 'hook.normalize', appName, appProfile }, 'Executing normalize hook');
    const normalizer = getNormalizer(appName, appProfile);
    if (normalizer) {
      return normalizer(replica);
    }
    throw new Error(`[PipelineHookBroker] normalize hook not registered for piece: ${appName}`);
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
    normalizedEntityType: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    this.logger.debug({ event: 'hook.writeNormalized', appName, appProfile, normalizedEntityType }, 'Executing writeNormalized hook');
    const writer = getNormalizedWriter(appName, appProfile);
    if (writer) {
      await writer(tx, db, schemaName, replicaId, entityId, traceId, normalizedEntityType, data);
      return;
    }
    throw new Error(`[PipelineHookBroker] writeNormalized hook not registered for piece: ${appName}`);
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
    const builder = getTargetBuilder(appName, appProfile);
    if (builder) {
      return builder(db, schemaName, normalizedEntityType, srcEntityId);
    }
    throw new Error(`[PipelineHookBroker] buildTarget hook not registered for piece: ${appName}`);
  }

  async provisionDomain(
    appName: string,
    appProfile: string,
    db: AppsConnectorDb,
    schemaName: string,
  ): Promise<void> {
    this.logger.log({ event: 'hook.provisionDomain', appName, appProfile, schemaName }, 'Executing provisionDomain hook');
    const provisioner = getDomainProvisioner(appName);
    if (provisioner) {
      await provisioner(db, schemaName);
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
  ): Promise<ReturnType<NonNullable<ApplicationShardModule['getWebhookResponse']>> | null> {
    const response = executeAppWebhookResponses(body, headers);
    if (response) {
      return response;
    }
    return null;
  }

  async activeFetch(
    appName: string,
    appProfile: string,
    missingDependencies: Array<{ entityType: string; sourceId: string }>,
    dataSourceId: string,
  ): Promise<void> {
    this.logger.log({ event: 'hook.activeFetch', appName, appProfile, count: missingDependencies.length }, 'activeFetch hook is not implemented in registry yet. Skipping.');
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
