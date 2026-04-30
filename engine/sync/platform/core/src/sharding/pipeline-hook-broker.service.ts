import { Injectable, Logger } from '@nestjs/common';
import { ApplicationLoaderService } from './application-loader.service.js';
import type { ApplicationShardModule } from './application-shard.types.js';

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
   * Derives the shard name from appName + appProfile.
   * Convention: "salesforce-revenova", "salesforce-default", etc.
   */
  private shardName(appName: string, appProfile: string): string {
    return `${appName}-${appProfile}`;
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
    db: unknown,
    schemaName: string,
    replicaId: string,
    entityId: string,
    traceId: string,
    normalizedEntityType: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const shard = await this.loader.load(this.shardName(appName, appProfile));
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
    db: unknown,
    schemaName: string,
    normalizedEntityType: string,
    srcEntityId: string,
  ): Promise<Record<string, unknown>> {
    const shard = await this.loader.load(this.shardName(appName, appProfile));
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
    db: unknown,
    schemaName: string,
  ): Promise<void> {
    // For provisioning, the shard name is appName-appName (the domain shard)
    // e.g. "salesforce-salesforce" which owns tms_carrier, tms_tp, etc.
    const shard = await this.loader.load(this.shardName(appName, appName));
    this.logger.log(
      { event: 'hook.provisionDomain', appName, schemaName },
      'Delegating provisionDomain to application shard',
    );
    return shard.provisionDomain(db, schemaName);
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
}
