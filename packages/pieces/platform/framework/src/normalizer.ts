import type { NormalizedRecord } from './canonical/index.js';

export type ReplicaExtractorFn = (payload: unknown) => { entityType: string; data: Record<string, unknown> } | null;
export type NormalizerFn = (replica: { entityType: string; data: Record<string, unknown> }) => NormalizedRecord | null;

// Use nested Map structure to avoid key collisions when inputs contain ":"
const extractorRegistry = new Map<string, Map<string, ReplicaExtractorFn>>();
const normalizerRegistry = new Map<string, Map<string, NormalizerFn>>();

/**
 * Registers an application-layer function designed to extract the true
 * Domain Object structurally from the Raw Webhook envelope (L1 -> L2).
 */
export function registerReplicaExtractor(appName: string, appProfile: string, fn: ReplicaExtractorFn) {
    if (!extractorRegistry.has(appName)) {
        extractorRegistry.set(appName, new Map());
    }
    const appMap = extractorRegistry.get(appName)!;
    if (appMap.has(appProfile)) {
        console.warn(`[registerReplicaExtractor] Overwriting existing extractor for ${appName}:${appProfile}`);
    }
    appMap.set(appProfile, fn);
}

export function getReplicaExtractor(appName: string, appProfile: string): ReplicaExtractorFn | undefined {
    return extractorRegistry.get(appName)?.get(appProfile);
}

/**
 * Registers an application-layer normalizer designed to map the structured
 * vendor Domain Object into the Nexiom Standard Canonical Entity (L2 -> L3).
 */
export function registerNormalizer(appName: string, appProfile: string, fn: NormalizerFn) {
    if (!normalizerRegistry.has(appName)) {
        normalizerRegistry.set(appName, new Map());
    }
    const appMap = normalizerRegistry.get(appName)!;
    if (appMap.has(appProfile)) {
        console.warn(`[registerNormalizer] Overwriting existing normalizer for ${appName}:${appProfile}`);
    }
    appMap.set(appProfile, fn);
}

export function getNormalizer(appName: string, appProfile: string): NormalizerFn | undefined {
    return normalizerRegistry.get(appName)?.get(appProfile);
}