export interface Rule {
  src: string;
  dest: string;
}

/**
 * Returns true for identifiers that are safe to use as object keys.
 * Rejects: empty strings, __proto__, prototype, constructor, and any
 * segment containing characters outside printable ASCII word chars.
 */
function isSafeSegment(segment: string): boolean {
  if (segment === '' || segment === '__proto__' || segment === 'prototype' || segment === 'constructor') {
    return false;
  }
  // Only allow word characters and hyphens (printable, no control chars or brackets)
  return /^[\w-]+$/.test(segment);
}

function getNestedValue(data: any, path: string): any {
  const parts = path.replace(/^\$\./, '').split('.');
  let val = data;
  for (const part of parts) {
    if (!isSafeSegment(part)) return undefined; // silently skip unsafe paths on read
    if (val === undefined || val === null) return undefined;
    val = val[part];
  }
  return val;
}

function setNestedValue(obj: any, path: string, value: any): void {
  const parts = path.replace(/^\$\./, '').split('.');
  // Validate every segment upfront — reject unsafe identifiers before any mutation
  for (const part of parts) {
    if (!isSafeSegment(part)) {
      throw new Error(
        `setNestedValue: unsafe path segment "${part}" in path "${path}" — ` +
        `segments may not be empty, "__proto__", "prototype", "constructor", ` +
        `or contain non-word characters.`,
      );
    }
  }
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined || current[part] === null) {
      current[part] = Object.create(null);
    } else if (typeof current[part] !== 'object' || Array.isArray(current[part])) {
      throw new TypeError(
        `setNestedValue: intermediate key "${part}" in path "${path}" already holds a ` +
        `non-object value (${Array.isArray(current[part]) ? 'Array' : typeof current[part]}). ` +
        `Refusing to overwrite.`,
      );
    }
    current = current[part];
  }
  const lastKey = parts.at(-1)!;
  current[lastKey] = value;
}

/**
 * Hydrates a new JSON payload from a source record based on field mapping rules.
 * 
 * @param rules Array of mapping rules { src, dest }
 * @param data The source normalized JSON data
 * @returns An outbound JSON payload structured for the destination
 */
export function hydratePayload(
  rules?: Rule[],
  data: Record<string, any> = {},
  markUnmapped: boolean = false
): any {
  rules = rules || [];
  const payload: any = {};
  for (const rule of rules) {
    const val = getNestedValue(data, rule.src);
    if (val !== undefined) {
      setNestedValue(payload, rule.dest, val);
    }
  }
  if (Object.keys(payload).length > 0) return payload;
  if (markUnmapped) return { _unmapped: true, ...data };
  return data;
}
