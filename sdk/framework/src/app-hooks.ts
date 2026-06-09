import type { AppsConnectorDb } from './db.types.js';

// ---------------------------------------------------------------------------
// Application Hook Registries
//
// @deprecated
// These static in-memory registries are superseded by the dynamic shard
// loading architecture (ApplicationLoaderService + PipelineHookBrokerService).
//
// Pipeline services (ReplicaService, NormalizationService, TargetBuilderService)
// now load application code at runtime via PipelineHookBrokerService and
// no longer call any register* / get* functions from this file.
//
// This file is retained for one release cycle to avoid breaking any external
// consumers. It will be deleted in a future cleanup pass.
// ---------------------------------------------------------------------------

/**
 * Called by NormalizationService (step 3.5) after the generic normalized_entity
 * write. The application implementation writes into its typed per-entity tables
 * (e.g. tms_carrier, tms_tp) inside the same transaction.
 *
 * @deprecated Deprecated — superseded by the dynamic shard loading architecture (ApplicationLoaderService + PipelineHookBrokerService); will be removed in the next release
 */
export type AppNormalizedWriterFn = (
    tx: unknown,
    db: AppsConnectorDb,
    schemaName: string,
    replicaId: string,
    entityId: string,
    traceId: string,
    normalizedEntityType: string,
    data: Record<string, unknown>,
) => Promise<void>;

/**
 * Called by TargetBuilderService to assemble the enriched context from the
 * application's typed normalized tables before field mapping is applied.
 *
 * @deprecated Deprecated — superseded by the dynamic shard loading architecture (ApplicationLoaderService + PipelineHookBrokerService); will be removed in the next release
 */
export type AppTargetBuilderFn = (
    db: AppsConnectorDb,
    schemaName: string,
    normalizedEntityType: string,
    srcEntityId: string,
) => Promise<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Registries
// ---------------------------------------------------------------------------

/**
 * Called once per tenant schema when a stitch for this appName is first activated.
 * The application domain package (e.g. @soopa/domain-tms) creates its typed
 * per-entity tables (tms_carrier, tms_tp, etc.) using IF NOT EXISTS DDL.
 *
 * @deprecated Deprecated — superseded by the dynamic shard loading architecture (ApplicationLoaderService + PipelineHookBrokerService); will be removed in the next release
 */
export type AppDomainProvisionerFn = (
    db: AppsConnectorDb,
    schemaName: string,
) => Promise<void>;

const normalizedWriterRegistry = new Map<string, Map<string, AppNormalizedWriterFn>>();
const targetBuilderRegistry    = new Map<string, Map<string, AppTargetBuilderFn>>();
const domainProvisionerRegistry = new Map<string, AppDomainProvisionerFn>();

/**
 * Registers an application-layer normalized writer.
 * Called from the connector piece's index.ts at module load time.
 *
 * @deprecated Deprecated — superseded by the dynamic shard loading architecture (ApplicationLoaderService + PipelineHookBrokerService); will be removed in the next release
 */
export function registerNormalizedWriter(appName: string, appProfile: string, fn: AppNormalizedWriterFn): void {
    if (!normalizedWriterRegistry.has(appName)) normalizedWriterRegistry.set(appName, new Map());
    const appMap = normalizedWriterRegistry.get(appName)!;
    if (appMap.has(appProfile)) {
        const msg = `Duplicate registration for NormalizedWriter: ${appName}:${appProfile}`;
        if (process.env.NODE_ENV !== 'production') {
            throw new Error(msg);
        }
        console.warn(`[registerNormalizedWriter] ${msg}`);
    }
    appMap.set(appProfile, fn);
}

/**
 * @deprecated Deprecated — superseded by the dynamic shard loading architecture (ApplicationLoaderService + PipelineHookBrokerService); will be removed in the next release
 */
export function getNormalizedWriter(appName: string, appProfile: string | undefined): AppNormalizedWriterFn | undefined {
    if (!appProfile) return undefined;
    return normalizedWriterRegistry.get(appName)?.get(appProfile);
}

/**
 * Registers an application-layer target builder.
 * Called from the connector piece's index.ts at module load time.
 *
 * @deprecated Deprecated — superseded by the dynamic shard loading architecture (ApplicationLoaderService + PipelineHookBrokerService); will be removed in the next release
 */
export function registerTargetBuilder(appName: string, appProfile: string, fn: AppTargetBuilderFn): void {
    if (!targetBuilderRegistry.has(appName)) targetBuilderRegistry.set(appName, new Map());
    const appMap = targetBuilderRegistry.get(appName)!;
    if (appMap.has(appProfile)) {
        const msg = `Duplicate registration for TargetBuilder: ${appName}:${appProfile}`;
        if (process.env.NODE_ENV !== 'production') {
            throw new Error(msg);
        }
        console.warn(`[registerTargetBuilder] ${msg}`);
    }
    appMap.set(appProfile, fn);
}

/**
 * @deprecated Deprecated — superseded by the dynamic shard loading architecture (ApplicationLoaderService + PipelineHookBrokerService); will be removed in the next release
 */
export function getTargetBuilder(appName: string, appProfile: string | undefined): AppTargetBuilderFn | undefined {
    if (!appProfile) return undefined;
    return targetBuilderRegistry.get(appName)?.get(appProfile);
}

/**
 * Registers an application-layer domain provisioner.
 *
 * Called from the connector piece's index.ts at module load time.
 * The platform's workspace activation flow calls this to create the
 * application's domain tables (tms_carrier, tms_tp, etc.) per tenant schema.
 * All DDL inside MUST be idempotent (CREATE TABLE IF NOT EXISTS).
 *
 * @deprecated Deprecated — superseded by the dynamic shard loading architecture (ApplicationLoaderService + PipelineHookBrokerService); will be removed in the next release
 */
export function registerDomainProvisioner(appName: string, fn: AppDomainProvisionerFn): void {
    if (domainProvisionerRegistry.has(appName)) {
        const msg = `Duplicate registration for DomainProvisioner: ${appName}`;
        if (process.env.NODE_ENV !== 'production') {
            throw new Error(msg);
        }
        console.warn(`[registerDomainProvisioner] ${msg}`);
    }
    domainProvisionerRegistry.set(appName, fn);
}

/**
 * @deprecated Deprecated — superseded by the dynamic shard loading architecture (ApplicationLoaderService + PipelineHookBrokerService); will be removed in the next release
 */
export function getDomainProvisioner(appName: string): AppDomainProvisionerFn | undefined {
    return domainProvisionerRegistry.get(appName);
}

/**
 * INTERNAL TEST HELPER — Clears all app hook registries.
 * This function is exported for test isolation only. Do not call in production code.
 *
 * @deprecated Deprecated — superseded by the dynamic shard loading architecture (ApplicationLoaderService + PipelineHookBrokerService); will be removed in the next release
 */
export function __resetAppHookRegistries(): void {
    normalizedWriterRegistry.clear();
    targetBuilderRegistry.clear();
    domainProvisionerRegistry.clear();
}
