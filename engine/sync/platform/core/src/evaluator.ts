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
  switch (cond.op) {
    case 'eq':        return fieldVal === cond.value;
    case 'neq':       return fieldVal !== cond.value;
    case 'gt':        return fieldVal > cond.value;
    case 'lt':        return fieldVal < cond.value;
    case 'contains':
      if (typeof fieldVal === 'string' || Array.isArray(fieldVal)) {
        return fieldVal.includes(cond.value);
      }
      return false;
    default:          return false; // unknown ops fail securely
  }
}

/** Supports dot-notation paths (e.g. 'TMS_Type__c' or 'Account.Name'). */
function getNestedValue(data: any, path: string): any {
  const parts = path.split('.');
  let val = data;
  for (const part of parts) {
    if (val === undefined || val === null) return undefined;
    val = val[part];
  }
  return val;
}
