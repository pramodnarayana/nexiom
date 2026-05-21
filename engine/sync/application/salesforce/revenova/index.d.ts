import { ReplicateRevenovaObject } from './replicate.js';
export declare const extractReplica: typeof ReplicateRevenovaObject;
export declare const normalize: (replica: {
    entityType: string;
    data: Record<string, unknown>;
}) => Promise<{
    canonicalType: import("@nexiom/piece-framework").NormalizedEntityType;
    data: Record<string, unknown>;
} | null>;
export declare const writeNormalized: import("@nexiom/piece-framework").AppNormalizedWriterFn;
export declare const buildTarget: import("@nexiom/piece-framework").AppTargetBuilderFn;
export declare const provisionDomain: typeof import("@nexiom/domain-tms").provisionTmsTables;
