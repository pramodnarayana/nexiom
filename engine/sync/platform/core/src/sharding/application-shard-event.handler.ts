import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ApplicationLoaderService } from './application-loader.service.js';
import type { ApplicationShardModule, AppsConnectorDb } from '@soopa/piece-framework';

@Injectable()
export class ApplicationShardEventHandler {
  private readonly logger = new Logger(ApplicationShardEventHandler.name);

  constructor(private readonly loader: ApplicationLoaderService) {}

  private shardName(appName: string, appProfile: string): string {
    return `${appName}/${appProfile}`;
  }

  @OnEvent('shard.extractReplica')
  async handleExtractReplica(payload: {
    appName: string;
    appProfile: string;
    data: unknown;
  }) {
    const shard = await this.loader.load(this.shardName(payload.appName, payload.appProfile));
    return shard.extractReplica(payload.data);
  }

  @OnEvent('shard.normalize')
  async handleNormalize(payload: {
    appName: string;
    appProfile: string;
    replica: { entityType: string; data: Record<string, unknown> };
  }) {
    const shard = await this.loader.load(this.shardName(payload.appName, payload.appProfile));
    return shard.normalize(payload.replica);
  }

  @OnEvent('shard.writeNormalized')
  async handleWriteNormalized(payload: {
    appName: string;
    appProfile: string;
    tx: unknown;
    db: AppsConnectorDb;
    schemaName: string;
    replicaId: string;
    entityId: string;
    traceId: string;
    normalizedEntityType: string;
    data: Record<string, unknown>;
  }) {
    const shard = await this.loader.load(this.shardName(payload.appName, payload.appProfile));
    if (!shard.writeNormalized) return;
    return shard.writeNormalized(
      payload.tx,
      payload.db,
      payload.schemaName,
      payload.replicaId,
      payload.entityId,
      payload.traceId,
      payload.normalizedEntityType,
      payload.data,
    );
  }

  @OnEvent('shard.buildTarget')
  async handleBuildTarget(payload: {
    appName: string;
    appProfile: string;
    db: AppsConnectorDb;
    schemaName: string;
    normalizedEntityType: string;
    srcEntityId: string;
  }) {
    const shard = await this.loader.load(this.shardName(payload.appName, payload.appProfile));
    if (!shard.buildTarget) return {};
    return shard.buildTarget(payload.db, payload.schemaName, payload.normalizedEntityType, payload.srcEntityId);
  }

  @OnEvent('shard.provisionDomain')
  async handleProvisionDomain(payload: {
    appName: string;
    appProfile: string;
    db: AppsConnectorDb;
    schemaName: string;
  }) {
    const shard = await this.loader.load(this.shardName(payload.appName, payload.appProfile));
    if (!shard.provisionDomain) return;
    return shard.provisionDomain(payload.db, payload.schemaName);
  }

  @OnEvent('shard.prepareUpdate')
  async handlePrepareUpdate(payload: {
    appName: string;
    appProfile: string;
    data: Record<string, any>;
    destId?: string;
    destState?: Record<string, any>;
  }) {
    let shard: ApplicationShardModule;
    try {
      shard = await this.loader.load(this.shardName(payload.appName, payload.appProfile));
    } catch (loadErr: any) {
      const errMsg = loadErr instanceof Error ? loadErr.message : String(loadErr);
      if (errMsg.includes('not found') || errMsg.includes('ENOENT')) {
        return payload.data;
      }
      throw loadErr;
    }
    if (!shard.prepareUpdate) return payload.data;
    return shard.prepareUpdate(payload.data, payload.destId, payload.destState);
  }

  @OnEvent('shard.getWebhookResponse')
  async handleGetWebhookResponse(payload: {
    appName: string;
    appProfile: string;
    body: unknown;
    headers: Record<string, string>;
  }) {
    let shard: ApplicationShardModule;
    try {
      shard = await this.loader.load(this.shardName(payload.appName, payload.appProfile));
    } catch (loadErr: any) {
      const errMsg = loadErr instanceof Error ? loadErr.message : String(loadErr);
      if (errMsg.includes('not found') || errMsg.includes('ENOENT')) return null;
      throw loadErr;
    }
    if (!shard.getWebhookResponse) return null;
    return shard.getWebhookResponse(payload.body, payload.headers);
  }

  @OnEvent('shard.activeFetch')
  async handleActiveFetch(payload: {
    appName: string;
    appProfile: string;
    missingDependencies: Array<{ entityType: string; sourceId: string }>;
    dataSourceId: string;
  }) {
    const shard = await this.loader.load(this.shardName(payload.appName, payload.appProfile));
    if (!shard.activeFetch) return;
    return shard.activeFetch(payload.missingDependencies, payload.dataSourceId);
  }

  @OnEvent('shard.reverseLookup')
  async handleReverseLookup(payload: {
    appName: string;
    appProfile: string;
    db: AppsConnectorDb;
    schemaName: string;
    normalizedEntityType: string;
    entityId: string;
  }) {
    const shard = await this.loader.load(this.shardName(payload.appName, payload.appProfile));
    if (!shard.reverseLookup) return [];
    return shard.reverseLookup(payload.db, payload.schemaName, payload.normalizedEntityType, payload.entityId);
  }
}
