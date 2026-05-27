import { sql, SQL, and, or, type Column } from 'drizzle-orm';

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'contains'
  | 'startsWith';

export interface FilterRule {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

export interface FilterGroup {
  logic: 'and' | 'or';
  rules: (FilterRule | FilterGroup)[];
}

export function isFilterGroup(obj: unknown): obj is FilterGroup {
  if (typeof obj !== 'object' || obj === null) return false;
  const g = obj as FilterGroup;
  return (g.logic === 'and' || g.logic === 'or') && Array.isArray(g.rules);
}

export function validateFilterGroup(obj: unknown): boolean {
  if (!isFilterGroup(obj)) return false;
  for (const rule of obj.rules) {
    if (isFilterGroup(rule)) {
      if (!validateFilterGroup(rule)) return false;
    } else {
      if (!rule || typeof rule !== 'object') return false;
      const r = rule as unknown as Record<string, unknown>;
      if (typeof r.field !== 'string' || !r.field) return false;
      const op = r.operator;
      if (
        typeof op !== 'string' ||
        ![
          'eq',
          'neq',
          'gt',
          'gte',
          'lt',
          'lte',
          'in',
          'contains',
          'startsWith',
        ].includes(op)
      )
        return false;
      if (op === 'in' && !Array.isArray(r.value)) return false;
    }
  }
  return true;
}

export function buildDrizzleFilter(
  ast: FilterGroup | FilterRule | undefined,

  table: any,
): SQL | undefined {
  if (!ast) return undefined;

  if (isFilterGroup(ast)) {
    const parts = ast.rules
      .map((rule) => buildDrizzleFilter(rule, table))
      .filter((s): s is SQL => s !== undefined);
    if (parts.length === 0) return undefined;
    return ast.logic === 'or' ? or(...parts) : and(...parts);
  }

  const rule = ast;
  let rawField = rule.field;
  const standardCols = [
    'id',
    'traceId',
    'dataSourceId',
    'routeId',
    'status',
    'createdAt',
    'updatedAt',
    'objectType',
    'entityType',
    'canonicalType',
  ];

  if (!rawField.includes('.') && !standardCols.includes(rawField)) {
    const jsonbColName = 'data' in table ? 'data' : 'payload';
    rawField = `${jsonbColName}.${rawField}`;
  }

  const parts = rawField.split('.');
  const baseColName = parts[0];

  let fieldExpr: SQL | Column;
  let isJsonb = false;

  if (
    (baseColName === 'data' ||
      baseColName === 'payload' ||
      baseColName === 'response') &&
    parts.length > 1
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const jsonbCol = table[baseColName] as Column | undefined;
    if (!jsonbCol) return undefined;

    // Validate path segments to prevent SQL injection
    const pathSegments = parts.slice(1);
    const allowedPathRegex = /^[A-Za-z0-9_-]+$/;
    for (const segment of pathSegments) {
      if (!allowedPathRegex.test(segment)) {
        return undefined; // Reject invalid path segments
      }
    }

    // Use parameterized SQL fragments for safe ARRAY construction
    const pathFragments = pathSegments.map((p) => sql`${p}`);
    // We cast the jsonb extraction to text so we can compare it easily
    fieldExpr = sql`${jsonbCol}#>>ARRAY[${sql.join(pathFragments, sql`, `)}]`;
    isJsonb = true;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const col = table[baseColName] as Column | undefined;
    if (!col) return undefined;
    fieldExpr = col;
  }

  const val = rule.value;
  let cmpExpr = fieldExpr;
  if (isJsonb && ['gt', 'gte', 'lt', 'lte'].includes(rule.operator)) {
    if (typeof val === 'number') {
      cmpExpr = sql`(${fieldExpr})::numeric`;
    } else if (typeof val === 'string' && /^\\d{4}-\\d{2}-\\d{2}T/.test(val)) {
      cmpExpr = sql`(${fieldExpr})::timestamptz`;
    }
  }

  switch (rule.operator) {
    case 'eq':
      return sql`${fieldExpr} = ${val}`;
    case 'neq':
      return sql`${fieldExpr} != ${val}`;
    case 'gt':
      return sql`${cmpExpr} > ${val}`;
    case 'gte':
      return sql`${cmpExpr} >= ${val}`;
    case 'lt':
      return sql`${cmpExpr} < ${val}`;
    case 'lte':
      return sql`${cmpExpr} <= ${val}`;
    case 'in':
      if (!Array.isArray(val) || val.length === 0) return sql`false`;
      return sql`${fieldExpr} IN (${sql.join(
        val.map((v) => sql`${v}`),
        sql`, `,
      )})`;
    case 'contains':
      return sql`${fieldExpr} ILIKE ${'%' + String(val) + '%'}`;
    case 'startsWith':
      return sql`${fieldExpr} ILIKE ${String(val) + '%'}`;
    default:
      return undefined;
  }
}
