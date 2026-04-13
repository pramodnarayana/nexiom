/**
 * Generatively prunes data structures, aggressively removing `null`, `undefined`,
 * or empty objects to drastically reduce LLM context token usage.
 * Caches standard URL tracking artifacts and UUID stamps typically not useful for generative insights.
 * Hard caps arrays to top 2 records to prevent 1:N relations from dominating context windows.
 */
export function optimizePayloadTokens(obj: unknown): unknown {
  if (obj === null || obj === undefined || obj === '') return undefined;
  if (typeof obj !== 'object') {
    // String Truncation fallback for root level scalars
    if (typeof obj === 'string' && obj.length > 250) {
      return obj.substring(0, 250) + '...[TRUNC]';
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    // Hard cap exactly to 1 record to prevent token explosions on 1:N graph traversals
    // (Do NOT push string descriptors here, as mixed Object/String arrays instantly crash Gemini's JSON schema parser)
    const sliced = obj.slice(0, 1);
    const cleanedArray = sliced
      .map((v) => optimizePayloadTokens(v))
      .filter((v) => v !== undefined);

    if (cleanedArray.length === 0) return undefined;
    return cleanedArray;
  }

  const pruned: Record<string, unknown> = {};
  let fieldCount = 0;
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    // Drop enterprise system noise fields aggressively (Layer 1 Algorithmic Cleaver)
    if (
      key === 'attributes' ||
      (key.toLowerCase().endsWith('id') && key.toLowerCase() !== 'id' && key.toLowerCase() !== 'internalid') ||
      key.toLowerCase().endsWith('modstamp') ||
      key.toLowerCase() === 'currencyisocode' ||
      key.toLowerCase() === 'url' ||
      key.startsWith('_')
    ) {
      continue;
    }

    // ─── STRICT CAP: Maximum 8 fields per object ───
    if (fieldCount >= 8) {
      continue;
    }

    let val = optimizePayloadTokens((obj as Record<string, unknown>)[key]);

    // Truncate massively bloated string payloads
    if (typeof val === 'string' && val.length > 80) {
      val = val.substring(0, 80) + '...';
    }

    if (val !== undefined) {
      // If it's an object and completely empty after pruning, don't include it
      if (
        typeof val === 'object' &&
        val !== null &&
        Object.keys(val).length === 0
      ) {
        continue;
      }
      pruned[key] = val;
      fieldCount++;
    }
  }

  return Object.keys(pruned).length > 0 ? pruned : undefined;
}
