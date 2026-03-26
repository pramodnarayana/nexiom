/**
 * Evaluates a set of sync conditions against a normalized data record.
 * 
 * @param conditions Array of condition rules { field, op, value }
 * @param data The normalized JSON record
 * @returns true if the data satisfies all conditions, otherwise false
 */
export function evaluateConditions(conditions: Record<string, any>[], data: any): boolean {
  if (!conditions || conditions.length === 0) return true;
  for (const cond of conditions) {
      const fieldVal = data[cond.field];
      if (cond.op === 'eq' && fieldVal !== cond.value) return false;
      if (cond.op === 'neq' && fieldVal === cond.value) return false;
      if (cond.op === 'gt' && fieldVal <= cond.value) return false;
      if (cond.op === 'lt' && fieldVal >= cond.value) return false;
      if (cond.op === 'contains' && typeof fieldVal === 'string' && !fieldVal.includes(cond.value)) return false;
  }
  return true;
}
