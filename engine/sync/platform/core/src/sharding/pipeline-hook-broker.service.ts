import { Injectable, Logger } from '@nestjs/common';
import { ApplicationLoaderService } from './application-loader.service.js';
import type { ApplicationShardModule, AppsConnectorDb } from '@nexiom/piece-framework';

// ---------------------------------------------------------------------------
// PipelineHookBrokerService
//
// The single point of contact between the platform pipeline services and
// application shard code. All pipeline services (ReplicaService,
// NormalizationService, TargetBuilderService, DatabaseManager) call this
// broker — they never import anything from application packages directly.
//
// The broker loads the correct shard module via ApplicationLoaderService,
// then delegates the call to the appropriate exported function.
// ---------------------------------------------------------------------------

@Injectable()
export class PipelineHookBrokerService {
  private readonly logger = new Logger(PipelineHookBrokerService.name);

  constructor(private readonly loader: ApplicationLoaderService) {}

  /**
   * Derives the shard path from appName + appProfile.
   * Convention: "salesforce/revenova", "quickbooks/online", etc.
   */
  private shardName(appName: string, appProfile: string): string {
    return `${appName}/${appProfile}`;
  }

  /**
   * L2 — Extract replica entity from raw inbound payload.
   * Returns null if the payload is not applicable for this app.
   */
  async extractReplica(
    appName: string,
    appProfile: string,
    payload: unknown,
  ): Promise<ReturnType<ApplicationShardModule['extractReplica']>> {
    const shard = await this.loader.load(this.shardName(appName, appProfile));
    this.logger.debug(
      { event: 'hook.extractReplica', appName, appProfile },
      'Delegating extractReplica to application shard',
    );
    return shard.extractReplica(payload);
  }

  /**
   * L3 — Normalize extracted replica into a canonical record.
   * Returns null if normalization is not applicable.
   */
  async normalize(
    appName: string,
    appProfile: string,
    replica: { entityType: string; data: Record<string, unknown> },
  ): Promise<ReturnType<ApplicationShardModule['normalize']>> {
    const shard = await this.loader.load(this.shardName(appName, appProfile));
    this.logger.debug(
      { event: 'hook.normalize', appName, appProfile },
      'Delegating normalize to application shard',
    );
    return shard.normalize(replica);
  }

  /**
   * L3.5 — Write normalized entity into application-owned typed tables.
   * Executes inside the platform's existing DB transaction boundary.
   */
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
    const shard = await this.loader.load(this.shardName(appName, appProfile));
    if (!shard.writeNormalized) {
      return Promise.resolve();
    }
    this.logger.debug(
      { event: 'hook.writeNormalized', appName, appProfile, normalizedEntityType },
      'Delegating writeNormalized to application shard',
    );
    return shard.writeNormalized(tx, db, schemaName, replicaId, entityId, traceId, normalizedEntityType, data);
  }

  /**
   * L4 — Build enriched context for field-mapping rule hydration.
   * Returns empty object if no enrichment is applicable.
   */
  async buildTarget(
    appName: string,
    appProfile: string,
    db: AppsConnectorDb,
    schemaName: string,
    normalizedEntityType: string,
    srcEntityId: string,
  ): Promise<Record<string, unknown>> {
    const shard = await this.loader.load(this.shardName(appName, appProfile));
    if (!shard.buildTarget) {
      return Promise.resolve({});
    }
    this.logger.debug(
      { event: 'hook.buildTarget', appName, appProfile, normalizedEntityType },
      'Delegating buildTarget to application shard',
    );
    return shard.buildTarget(db, schemaName, normalizedEntityType, srcEntityId);
  }

  /**
   * Provision — Idempotent DDL provisioning for application-owned tables.
   * Called once per tenant schema when a stitch is first activated.
   */
  async provisionDomain(
    appName: string,
    appProfile: string,
    db: AppsConnectorDb,
    schemaName: string,
  ): Promise<void> {
    const shard = await this.loader.load(this.shardName(appName, appProfile));
    if (!shard.provisionDomain) {
      return Promise.resolve();
    }
    this.logger.log(
      { event: 'hook.provisionDomain', appName, appProfile, schemaName },
      'Delegating provisionDomain to application shard',
    );
    return shard.provisionDomain(db, schemaName);
  }

  /**
   * Optional — Prepare Update payload.
   * Called before L5 executeAction on UPDATE operations. Allows the application
   * to inject destination-specific IDs or SyncTokens into the payload.
   */
  async prepareUpdate(
    appName: string,
    appProfile: string,
    payload: Record<string, any>,
    destId?: string,
    destState?: Record<string, any>,
  ): Promise<Record<string, any>> {
    let shard: ApplicationShardModule;
    try {
      shard = await this.loader.load(this.shardName(appName, appProfile));
    } catch (loadErr) {
      this.logger.warn(
        { event: 'hook.prepareUpdate.loader_error', appName, appProfile, err: loadErr instanceof Error ? loadErr.message : String(loadErr) },
        `[DEBUG] Failed to load shard ${appName}/${appProfile}. Error: ${loadErr instanceof Error ? loadErr.message : String(loadErr)}`
      );
      // Only return raw payload if the shard is genuinely missing (not found error).
      // For other loader failures (syntax errors, missing dependencies), rethrow to surface the issue.
      const errMsg = loadErr instanceof Error ? loadErr.message : String(loadErr);
      const errCode = (loadErr as any)?.code;
      if (errMsg.includes('not found') || errMsg.includes('Cannot find module') || errCode === 'ENOENT' || errMsg.includes('ENOENT')) {
        this.logger.warn(
          { event: 'hook.prepareUpdate.shard_not_found', appName, appProfile },
          `Shard ${appName}/${appProfile} not found, returning raw payload (no prepareUpdate logic available)`
        );
        return payload;
      }
      // Real failures (syntax, import errors) should propagate
      throw loadErr;
    }

    if (!shard.prepareUpdate) {
      this.logger.warn(
        { event: 'hook.prepareUpdate.missing_export', appName, appProfile, exportedKeys: Object.keys(shard) },
        `[DEBUG] Shard ${appName}/${appProfile} loaded successfully, but 'prepareUpdate' export is missing. Returning raw payload.`
      );
      return payload;
    }

    this.logger.debug(
      { event: 'hook.prepareUpdate', appName, appProfile, destId },
      'Delegating prepareUpdate to application shard',
    );
    return shard.prepareUpdate(payload, destId, destState);
  }

  /**
   * Optional — Get a custom webhook response for vendor-specific ACKs.
   * Returns null if no custom response is needed.
   */
  async getWebhookResponse(
    appName: string,
    appProfile: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<ReturnType<NonNullable<ApplicationShardModule['getWebhookResponse']>> | null> {
    let shard: ApplicationShardModule;
    try {
      shard = await this.loader.load(this.shardName(appName, appProfile));
    } catch (loadErr) {
      // Inspect error to determine if it's a "not found" case
      const errMsg = loadErr instanceof Error ? loadErr.message : String(loadErr);
      if (errMsg.includes('not found') || errMsg.includes('ENOENT')) {
        // Shard does not exist — return null (webhook response is optional)
        return null;
      }
      // Loader error is NOT a "missing shard" — log and rethrow
      this.logger.error(
        { event: 'hook.getWebhookResponse.loader_error', appName, appProfile, err: errMsg },
        'Failed to load shard for getWebhookResponse',
      );
      throw loadErr;
    }

    // Shard loaded successfully — invoke getWebhookResponse if it exists
    if (!shard.getWebhookResponse) {
      return null;
    }

    try {
      return await shard.getWebhookResponse(body, headers);
    } catch (hookErr) {
      // Runtime error in the shard's getWebhookResponse — log and rethrow
      this.logger.error(
        {
          event: 'hook.getWebhookResponse.runtime_error',
          appName,
          appProfile,
          err: hookErr instanceof Error ? hookErr.message : String(hookErr),
        },
        'Shard getWebhookResponse threw an error',
      );
      throw hookErr;
    }
  }
  /**
   * Optional — Active Fetching hook.
   * Given a list of missing dependencies, delegate to the application piece
   * to fetch them from the source system (e.g., using a Composite API) and
   * ingest them into the L1 gateway.
   */
  async activeFetch(
    appName: string,
    appProfile: string,
    missingDependencies: Array<{ entityType: string; sourceId: string }>,
    dataSourceId: string,
  ): Promise<void> {
    const shard = await this.loader.load(this.shardName(appName, appProfile));
    if (!shard.activeFetch) {
      this.logger.debug(
        { event: 'hook.activeFetch.missing', appName, appProfile },
        'Application shard does not implement activeFetch hook',
      );
      return;
    }
    this.logger.log(
      { event: 'hook.activeFetch', appName, appProfile, count: missingDependencies.length },
      'Delegating activeFetch to application shard',
    );
    return shard.activeFetch(missingDependencies, dataSourceId);
  }

  /**
   * Optional — Reverse Lookup hook.
   * After L3 normalization writes a child entity to the database, this hook
   * is called to find any parent entities that might have been paused
   * (DEFERRED_DEPENDENCY) waiting for this child.
   */
  async reverseLookup(
    appName: string,
    appProfile: string,
    db: AppsConnectorDb,
    schemaName: string,
    normalizedEntityType: string,
    entityId: string,
  ): Promise<string[]> {
    const shard = await this.loader.load(this.shardName(appName, appProfile));
    if (!shard.reverseLookup) {
      return [];
    }
    this.logger.debug(
      { event: 'hook.reverseLookup', appName, appProfile, normalizedEntityType },
      'Delegating reverseLookup to application shard',
    );
    return shard.reverseLookup(db, schemaName, normalizedEntityType, entityId);
  }
}
