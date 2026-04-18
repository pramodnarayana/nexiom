import type { NormalizedRecord } from './canonical/index.js';

export type ReplicaExtractorFn = (payload: unknown) => { entityType: string; data: Record<string, unknown> } | null;
export type NormalizerFn = (replica: { entityType: string; data: Record<string, unknown> }) => NormalizedRecord | null;

const extractorRegistry = new Map<string, ReplicaExtractorFn>();
const normalizerRegistry = new Map<string, NormalizerFn>();

/** Creates a deterministic lookup key for a given app and tenant profile */
function buildKey(appName: string, appProfile: string) {
    return `${appName}:${appProfile}`;
}

/** 
 * Registers an application-layer function designed to extract the true 
 * Domain Object structurally from the Raw Webhook envelope (L1 -> L2).
 */
export function registerReplicaExtractor(appName: string, appProfile: string, fn: ReplicaExtractorFn) {
    extractorRegistry.set(buildKey(appName, appProfile), fn);
}

export function getReplicaExtractor(appName: string, appProfile: string): ReplicaExtractorFn | undefined {
    return extractorRegistry.get(buildKey(appName, appProfile));
}

/** 
 * Registers an application-layer normalizer designed to map the structured
 * vendor Domain Object into the Nexiom Standard Canonical Entity (L2 -> L3).
 */
export function registerNormalizer(appName: string, appProfile: string, fn: NormalizerFn) {
    normalizerRegistry.set(buildKey(appName, appProfile), fn);
}

export function getNormalizer(appName: string, appProfile: string): NormalizerFn | undefined {
    return normalizerRegistry.get(buildKey(appName, appProfile));
}
