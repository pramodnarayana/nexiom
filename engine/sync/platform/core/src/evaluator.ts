export interface Condition {
    field: string;
    op: string;
    value: any;
    /** 'AND' chains this condition with the previous one. 'OR' starts a new OR-group. */
    logic?: 'AND' | 'OR';
}

/**
 * Evaluates a set of sync conditions against a normalized data record.
 *
 * Logic model (matches SQL precedence):
 *   - Conditions with logic='AND' (or no logic) are AND-chained within the current group.
 *   - A condition with logic='OR' ends the current group and starts a new OR-group.
 *   - The stitch fires if ANY group evaluates to true (groups are OR-combined).
 *
 * Examples:
 *   [TMS_Type=Carrier(AND), TMS_Type=Factoring(OR)] → (TMS_Type=Carrier) OR (TMS_Type=Factoring)
 *   [Status=Active(AND), Region=US(AND)]             → Status=Active AND Region=US  (classic AND-only)
 */
export function evaluateConditions(conditions: Condition[], data: any): boolean {
  if (!conditions || conditions.length === 0) return true;

  // ── Split into OR-groups ─────────────────────────────────────────────────
  // Each group is a list of conditions that must ALL pass (AND within the group).
  // A new group starts at the first condition and at every condition where logic='OR'.
  const groups: Condition[][] = [];
  let current: Condition[] = [];

  for (const cond of conditions) {
    if (cond.logic === 'OR' && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(cond);
  }
  if (current.length > 0) groups.push(current);

  // The stitch fires if any group passes.
  return groups.some((group) => group.every((cond) => testCondition(cond, data)));
}

function testCondition(cond: Condition, data: any): boolean {
  const fieldVal = getNestedValue(data, cond.field);

  // Coerce cond.value (always a string from the UI) to the runtime type of fieldVal.
  let coercedValue: any = cond.value;

  if (fieldVal !== null && fieldVal !== undefined) {
    const fieldType = typeof fieldVal;

    if (fieldType === 'number' && typeof cond.value === 'string') {
      const parsed = Number(cond.value);
      coercedValue = isNaN(parsed) ? cond.value : parsed;
    } else if (fieldType === 'boolean' && typeof cond.value === 'string') {
      const lower = cond.value.toLowerCase();
      if (lower === 'true') coercedValue = true;
      else if (lower === 'false') coercedValue = false;
    }
    // For string fieldVal or other types, leave coercedValue as-is.
  }

  switch (cond.op) {
    case 'eq':        return fieldVal === coercedValue;
    case 'neq':       return fieldVal !== coercedValue;
    case 'gt':        return fieldVal > coercedValue;
    case 'lt':        return fieldVal < coercedValue;
    case 'contains':
      if (typeof fieldVal === 'string' || Array.isArray(fieldVal)) {
        return fieldVal.includes(coercedValue);
      }
      return false;
    default:          return false; // unknown ops fail securely
  }
}

/**
 * Validates that a path segment is safe for property access.
 * Rejects prototype pollution vectors: __proto__, constructor, prototype,
 * empty strings, and segments with non-word characters.
 */
function isSafeSegment(segment: string): boolean {
  if (segment === '' || segment === '__proto__' || segment === 'prototype' || segment === 'constructor') {
    return false;
  }
  // Only allow word characters, hyphens, and underscores.
  return /^[\w-]+$/.test(segment);
}

/** Supports dot-notation paths (e.g. 'TMS_Type__c' or 'Account.Name'). */
function getNestedValue(data: any, path: string): any {
  const parts = path.split('.');
  let val = data;
  for (const part of parts) {
    if (!isSafeSegment(part)) return undefined; // Reject unsafe segments.
    if (val === undefined || val === null) return undefined;
    if (typeof val !== 'object') return undefined; // Guard against non-object access.
    val = val[part];
  }
  return val;
}