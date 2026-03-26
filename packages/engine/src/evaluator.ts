export interface Condition {
    field: string;
    op: string;
    value: any;
}

/**
 * Evaluates a set of sync conditions against a normalized data record.
 * 
 * @param conditions Array of condition rules
 * @param data The normalized JSON record
 * @returns true if the data satisfies all conditions, otherwise false
 */
export function evaluateConditions(conditions: Condition[], data: any): boolean {
  if (!conditions || conditions.length === 0) return true;
  for (const cond of conditions) {
      const fieldVal = data[cond.field];
      switch (cond.op) {
          case 'eq':
              if (fieldVal !== cond.value) return false;
              break;
          case 'neq':
              if (fieldVal === cond.value) return false;
              break;
          case 'gt':
              if (fieldVal <= cond.value) return false;
              break;
          case 'lt':
              if (fieldVal >= cond.value) return false;
              break;
          case 'contains':
              if (typeof fieldVal === 'string' || Array.isArray(fieldVal)) {
                  if (!fieldVal.includes(cond.value)) return false;
              } else {
                  return false; // Not searchable
              }
              break;
          default:
              return false; // Unknown ops fail securely
      }
  }
  return true;
}
