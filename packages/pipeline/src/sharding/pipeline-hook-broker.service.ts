import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { ApplicationShardModule, AppsConnectorDb } from '@soopa/piece-framework';

@Injectable()
export class PipelineHookBrokerService {
  private readonly logger = new Logger(PipelineHookBrokerService.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  async extractReplica(
    appName: string,
    appProfile: string,
    payload: unknown,
  ): Promise<ReturnType<ApplicationShardModule['extractReplica']>> {
    this.logger.debug({ event: 'hook.extractReplica', appName, appProfile }, 'Emitting extractReplica event');
    const [result] = await this.eventEmitter.emitAsync('shard.extractReplica', { appName, appProfile, data: payload });
    return result;
  }

  async normalize(
    appName: string,
    appProfile: string,
    replica: { entityType: string; data: Record<string, unknown> },
  ): Promise<ReturnType<ApplicationShardModule['normalize']>> {
    this.logger.debug({ event: 'hook.normalize', appName, appProfile }, 'Emitting normalize event');
    const [result] = await this.eventEmitter.emitAsync('shard.normalize', { appName, appProfile, replica });
    return result;
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
    this.logger.debug({ event: 'hook.writeNormalized', appName, appProfile, normalizedEntityType }, 'Emitting writeNormalized event');
    await this.eventEmitter.emitAsync('shard.writeNormalized', {
      appName, appProfile, tx, db, schemaName, replicaId, entityId, traceId, normalizedEntityType, data
    });
  }

  async buildTarget(
    appName: string,
    appProfile: string,
    db: AppsConnectorDb,
    schemaName: string,
    normalizedEntityType: string,
    srcEntityId: string,
  ): Promise<Record<string, unknown>> {
    this.logger.debug({ event: 'hook.buildTarget', appName, appProfile, normalizedEntityType }, 'Emitting buildTarget event');
    const [result] = await this.eventEmitter.emitAsync('shard.buildTarget', {
      appName, appProfile, db, schemaName, normalizedEntityType, srcEntityId
    });
    return result ?? {};
  }

  async provisionDomain(
    appName: string,
    appProfile: string,
    db: AppsConnectorDb,
    schemaName: string,
  ): Promise<void> {
    this.logger.log({ event: 'hook.provisionDomain', appName, appProfile, schemaName }, 'Emitting provisionDomain event');
    await this.eventEmitter.emitAsync('shard.provisionDomain', { appName, appProfile, db, schemaName });
  }

  async prepareUpdate(
    appName: string,
    appProfile: string,
    payload: Record<string, any>,
    destId?: string,
    destState?: Record<string, any>,
  ): Promise<Record<string, any>> {
    this.logger.debug({ event: 'hook.prepareUpdate', appName, appProfile, destId }, 'Emitting prepareUpdate event');
    const [result] = await this.eventEmitter.emitAsync('shard.prepareUpdate', {
      appName, appProfile, data: payload, destId, destState
    });
    return result ?? payload;
  }

  async getWebhookResponse(
    appName: string,
    appProfile: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<ReturnType<NonNullable<ApplicationShardModule['getWebhookResponse']>> | null> {
    const [result] = await this.eventEmitter.emitAsync('shard.getWebhookResponse', {
      appName, appProfile, body, headers
    });
    return result ?? null;
  }

  async activeFetch(
    appName: string,
    appProfile: string,
    missingDependencies: Array<{ entityType: string; sourceId: string }>,
    dataSourceId: string,
  ): Promise<void> {
    this.logger.log({ event: 'hook.activeFetch', appName, appProfile, count: missingDependencies.length }, 'Emitting activeFetch event');
    await this.eventEmitter.emitAsync('shard.activeFetch', {
      appName, appProfile, missingDependencies, dataSourceId
    });
  }

  async reverseLookup(
    appName: string,
    appProfile: string,
    db: AppsConnectorDb,
    schemaName: string,
    normalizedEntityType: string,
    entityId: string,
  ): Promise<string[]> {
    this.logger.debug({ event: 'hook.reverseLookup', appName, appProfile, normalizedEntityType }, 'Emitting reverseLookup event');
    const [result] = await this.eventEmitter.emitAsync('shard.reverseLookup', {
      appName, appProfile, db, schemaName, normalizedEntityType, entityId
    });
    return result ?? [];
  }
}
