import type { NormalizedRecord } from '@soopa/piece-framework';

/**
 * QuickBooks objects are usually not normalized into a canonical TMS schema.
 * They stay as raw domain entities for the QB piece.
 */
export async function NormaliseQBObject(
    _entityType: string,
    _data: any
): Promise<NormalizedRecord | null> {
    return null; // Signals to the pipeline to store as RAW canonical type
}
