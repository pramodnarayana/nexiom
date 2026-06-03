import type { NormalizedEntityType } from '@soopa/piece-framework';
export declare const NormaliseRevenovaObject: (replica: {
    entityType: string;
    data: Record<string, unknown>;
}) => Promise<{
    canonicalType: NormalizedEntityType;
    data: Record<string, unknown>;
} | null>;
