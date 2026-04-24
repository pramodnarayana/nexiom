/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Inject, Logger } from "@nestjs/common";
import { DATABASE_CONNECTION } from "@nexiom/database";
import type { DrizzleDb } from "@nexiom/database";
import { getTargetBuilder } from "@nexiom/piece-framework";
import type { Rule } from "@nexiom/engine";
import { hydratePayload } from "@nexiom/engine";

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

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  async buildPayload(
    schemaName: string,
    appName: string,
    appProfile: string,
    normalizedEntityType: string,
    srcEntityId: string | undefined,
    normalizedData: Record<string, unknown>,
    rules: Rule[],
  ): Promise<Record<string, unknown>> {
    // ── 1. Attempt app-registered enrichment ─────────────────────────────────
    const appBuilder = getTargetBuilder(appName, appProfile);

    let enrichedContext = normalizedData;

    if (appBuilder && srcEntityId) {
      try {
        const appContext = await appBuilder(
          this.db,
          schemaName,
          normalizedEntityType,
          srcEntityId,
        );

        if (Object.keys(appContext).length > 0) {
          // Merge: top-level normalizedData fields + app-enriched aliases
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
            "Enrichment context assembled from app hook",
          );
        } else {
          this.logger.debug(
            {
              event: "target_builder.empty_context",
              appName,
              normalizedEntityType,
              srcEntityId,
            },
            "App target builder returned empty context — using normalizedData",
          );
        }
      } catch (err) {
        const errPayload =
          err instanceof Error
            ? { message: err.message, stack: err.stack }
            : err;
        this.logger.warn(
          {
            event: "target_builder.hook_failed",
            appName,
            normalizedEntityType,
            srcEntityId,
            err: errPayload,
          },
          "App target builder hook failed — falling back to normalizedData",
        );
      }
    } else if (appBuilder && !srcEntityId) {
      this.logger.debug(
        {
          event: "target_builder.missing_src_entity_id",
          appName,
          normalizedEntityType,
          appProfile,
          srcEntityId,
        },
        "App builder registered but srcEntityId is undefined — skipping enrichment",
      );
    } else if (!appBuilder) {
      this.logger.debug(
        { event: "target_builder.no_hook", appName, appProfile },
        "No app target builder registered — applying rules to normalizedData directly",
      );
    }

    // ── 2. Apply field mapping rules ─────────────────────────────────────────
    if (rules.length === 0) return enrichedContext;
    return hydratePayload(rules, enrichedContext) as Record<string, unknown>;
  }
}
