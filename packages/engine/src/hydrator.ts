/**
 * Hydrates a new JSON payload from a source record based on field mapping rules.
 * 
 * @param rules Array of mapping rules { src, dest }
 * @param data The source normalized JSON data
 * @returns An outbound JSON payload structured for the destination
 */
export function hydratePayload(rules: any[], data: any): any {
  const payload: any = {};
  for (const rule of rules) {
     // Simple dot notation for path extraction/setting instead of real JSONPath
     // src: "$.Region", dest: "$.billingRegion"
     const val = data[rule.src.replace('$.', '')];
     if (val !== undefined) {
        payload[rule.dest.replace('$.', '')] = val;
     }
  }
  return Object.keys(payload).length > 0 ? payload : data;
}
