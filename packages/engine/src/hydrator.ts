export interface Rule {
  src: string;
  dest: string;
}

function getNestedValue(data: any, path: string): any {
  const parts = path.replace('$.', '').split('.');
  let val = data;
  for (const part of parts) {
    if (val === undefined || val === null) return undefined;
    val = val[part];
  }
  return val;
}

function setNestedValue(obj: any, path: string, value: any): void {
  const parts = path.replace('$.', '').split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) current[parts[i]] = {};
    current = current[parts[i]];
  }
  const lastKey = parts.at(-1);
  if (lastKey !== undefined) current[lastKey] = value;
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
