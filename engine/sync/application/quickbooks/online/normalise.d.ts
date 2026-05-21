import type { NormalizedRecord } from '@nexiom/piece-framework';
/**
 * QuickBooks objects are usually not normalized into a canonical TMS schema.
 * They stay as raw domain entities for the QB piece.
 */
export declare function NormaliseQBObject(_entityType: string, _data: any): Promise<NormalizedRecord | null>;
