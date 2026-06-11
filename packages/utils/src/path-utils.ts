export function isSafeSegment(segment: string): boolean {
  return (
    segment !== '' &&
    segment !== '__proto__' &&
    segment !== 'prototype' &&
    segment !== 'constructor' &&
    /^[\w-]+$/.test(segment)
  );
}

export function getNestedValue(data: unknown, path: string): unknown {
  const parts = path.replace(/^\$\./, '').split('.');
  let val: unknown = data;
  for (const part of parts) {
    if (!isSafeSegment(part) || val === undefined || val === null) return undefined;
    if (!Object.prototype.hasOwnProperty.call(val, part)) return undefined;
    val = (val as Record<string, unknown>)[part];
  }
  return val;
}

export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.replace(/^\$\./, '').split('.');

  for (const part of parts) {
    if (!isSafeSegment(part)) {
      throw new Error(
        `unsafe path segment "${part}" in destPath "${path}". ` +
          `Segments may not be empty or equal to "__proto__", "prototype", "constructor".`,
      );
    }
  }

  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i] ?? '';
    current = advanceOrCreate(current, part, path);
  }
  current[parts.at(-1) ?? ''] = value;
}

function advanceOrCreate(
  current: Record<string, unknown>,
  part: string,
  fullPath: string,
): Record<string, unknown> {
  if (current[part] === undefined || current[part] === null) {
    current[part] = Object.create(null);
  } else if (typeof current[part] !== 'object' || Array.isArray(current[part])) {
    throw new TypeError(
      `intermediate key "${part}" in "${fullPath}" already holds a ` +
        `non-object value (${Array.isArray(current[part]) ? 'Array' : typeof current[part]}). ` +
        `Refusing to overwrite.`,
    );
  }
  return current[part] as Record<string, unknown>;
}
