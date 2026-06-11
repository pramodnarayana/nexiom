import { PipelineHookBrokerService } from "../sharding/pipeline-hook-broker.service.js";
import { Rule, hydratePayload } from "../hydrator.js";
import { Injectable, Inject, Logger } from "@nestjs/common";
import { DATABASE_CONNECTION } from "@soopa/database";
import type { DrizzleDb } from "@soopa/database";



/**
 * TargetBuilderService — L4 Payload Assembly (Platform-Generic)
 *
 * Assembles the outbound payload by:
 *   1. Calling the app-registered AppTargetBuilderFn hook to get an enriched
 *      context (SQL JOINs across app-owned typed tables — e.g. tms_carrier,
 *      tms_tp). The platform knows nothing about those tables.
 *   2. Applying field mapping Rule[] via hydratePayload to build the
 *      destination API payload (e.g. QB Vendor JSON).
 *
 * If no AppTargetBuilderFn is registered for the connection's app, falls back
 * to applying the rules directly against the normalizedData blob.
 */
@Injectable()
export class TargetBuilderService {
  private readonly logger = new Logger(TargetBuilderService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly hookBroker: PipelineHookBrokerService,
  ) {}

  async buildPayload(
    schemaName: string,
    appName: string,
    appProfile: string,
    normalizedEntityType: string,
    srcEntityId: string | undefined,
    normalizedData: Record<string, unknown>,
    rules: Rule[],
  ): Promise<Record<string, unknown>> {
    // ── 1. Attempt app shard enrichment via PipelineHookBrokerService ─────────
    let enrichedContext = normalizedData;

    if (srcEntityId) {
      try {
        const appContext = await this.hookBroker.buildTarget(
          appName,
          appProfile,
          this.db,
          schemaName,
          normalizedEntityType,
          srcEntityId,
        );

        if (appContext && Object.keys(appContext).length > 0) {
          enrichedContext = { ...normalizedData, ...appContext };
          this.logger.debug(
            {
              event: "target_builder.enriched",
              appName,
              normalizedEntityType,
              srcEntityId,
              aliases: Object.keys(appContext).filter(
                (k) => appContext[k] !== null,
              ),
            },
            "Enrichment context assembled from application shard",
          );
        } else {
          this.logger.debug(
            {
              event: "target_builder.empty_context",
              appName,
              normalizedEntityType,
              srcEntityId,
            },
            "Application shard buildTarget returned empty context — using normalizedData",
          );
        }
      } catch (err) {
        this.logger.warn(
          {
            event: "target_builder.hook_failed",
            appName,
            normalizedEntityType,
            srcEntityId,
            err:
              err instanceof Error
                ? { message: err.message, stack: err.stack }
                : err,
          },
          "Application shard buildTarget failed — falling back to normalizedData",
        );
      }
    } else {
      this.logger.debug(
        {
          event: "target_builder.missing_src_entity_id",
          appName,
          normalizedEntityType,
        },
        "srcEntityId is undefined — skipping enrichment",
      );
    }

    // ── 2. Apply field mapping rules ─────────────────────────────────────────
    if (rules.length === 0) {
      throw new Error(
        `No mapping rules configured for ${normalizedEntityType}. Please configure field mappings for this integration before syncing.`,
      );
    }

    const hydrated = hydratePayload(rules, enrichedContext) as Record<
      string,
      unknown
    >;

    // Strip null and undefined properties
    for (const key of Object.keys(hydrated)) {
      if (hydrated[key] == null) {
        delete hydrated[key];
      }
    }

    if (Object.keys(hydrated).length === 0) {
      throw new Error(
        `Mapping rules failed to produce a valid payload for ${normalizedEntityType}. Check your field mapping configuration.`,
      );
    }

    return hydrated;
  }
}
