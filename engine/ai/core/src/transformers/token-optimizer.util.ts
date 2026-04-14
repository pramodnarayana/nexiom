/**
 * Generatively prunes data structures, aggressively removing `null`, `undefined`,
 * or empty objects to drastically reduce LLM context token usage.
 * Caches standard URL tracking artifacts and UUID stamps typically not useful for generative insights.
 * Hard caps arrays to top 1 record to prevent 1:N relations from dominating context windows.
 */
export function optimizePayloadTokens(obj: unknown, seen?: WeakSet<object>): unknown {
  if (obj === null || obj === undefined || obj === '') return undefined;
  if (typeof obj !== 'object') {
    // String Truncation fallback for root level scalars
    if (typeof obj === 'string' && obj.length > 250) {
      return obj.substring(0, 250) + '...[TRUNC]';
    }
    return obj;
  }

  // Initialize seen set on first call to detect cycles
  if (!seen) {
    seen = new WeakSet<object>();
  }

  // Cycle detection: if we've already seen this object, return undefined to prevent stack overflow
  if (seen.has(obj)) {
    return undefined;
  }

  // Mark this object as seen before recursing
  seen.add(obj);

  // Type guards for built-in non-plain objects
  if (obj instanceof Date) {
    seen.delete(obj);
    return obj.toISOString();
  }
  if (obj instanceof URL) {
    seen.delete(obj);
    return obj.toString();
  }
  if (obj instanceof Map) {
    const optimizedEntries = Array.from(obj.entries())
      .slice(0, 1)
      .map(([k, v]) => [optimizePayloadTokens(k, seen), optimizePayloadTokens(v, seen)]);
    seen.delete(obj);
    return optimizedEntries;
  }
  if (obj instanceof Set) {
    const optimizedValues = Array.from(obj)
      .slice(0, 1)
      .map((v) => optimizePayloadTokens(v, seen));
    seen.delete(obj);
    return optimizedValues;
  }
  if (obj instanceof Error) {
    seen.delete(obj);
    return { message: obj.message, stack: obj.stack };
  }

  if (Array.isArray(obj)) {
    // Hard cap exactly to 1 record to prevent token explosions on 1:N graph traversals
    // (Do NOT push string descriptors here, as mixed Object/String arrays instantly crash Gemini's JSON schema parser)
    const sliced = obj.slice(0, 1);
    const cleanedArray = sliced
      .map((v) => optimizePayloadTokens(v, seen))
      .filter((v) => v !== undefined);

    // Remove from seen to prevent aliasing issues
    seen.delete(obj);

    if (cleanedArray.length === 0) return undefined;
    return cleanedArray;
  }

  const pruned: Record<string, unknown> = {};
  let fieldCount = 0;
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    // Drop enterprise system noise fields aggressively (Layer 1 Algorithmic Cleaver)
    const lowerKey = key.toLowerCase();
    if (
      key === 'attributes' ||
      ((key.endsWith('Id') || key.endsWith('ID') || lowerKey.endsWith('_id')) && lowerKey !== 'id' && lowerKey !== 'internalid') ||
      lowerKey.endsWith('modstamp') ||
      lowerKey === 'currencyisocode' ||
      lowerKey === 'url' ||
      key.startsWith('_')
    ) {
      continue;
    }

    // ─── STRICT CAP: Maximum 8 fields per object ───
    if (fieldCount >= 8) {
      continue;
    }

    let val = optimizePayloadTokens((obj as Record<string, unknown>)[key], seen);

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

  // Remove from seen to prevent aliasing issues
  seen.delete(obj);

  return Object.keys(pruned).length > 0 ? pruned : undefined;
}