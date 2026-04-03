/**
 * Formula Library — platform-verified transform functions.
 *
 * Every formula available in the Mapping Canvas UI is registered here.
 * The UI renders a dropdown of keys from FORMULA_REGISTRY.
 * MappingEngine calls FORMULA_REGISTRY[name](value, args) at runtime.
 *
 * Rules:
 *  - All formulas must be pure functions (no side effects, no DB calls).
 *  - Unknown formula names throw a clear error — never silently pass through.
 *  - Each formula is independently unit-tested.
 */

export type FormulaFn = (value: unknown, args: Record<string, unknown>) => unknown;

// ─── Individual Formula Implementations ──────────────────────────────────────

/**
 * dateFormat — converts a date string or Date to a specified display format.
 *
 * Supported format tokens (subset):
 *   YYYY — 4-digit year   MM — 2-digit month   DD — 2-digit day
 *   HH   — 24h hour       mm — minutes          ss — seconds
 *
 * @example dateFormat("2024-01-30", { format: "DD/MM/YYYY" }) → "30/01/2024"
 */
export function dateFormat(value: unknown, args: Record<string, unknown>): string {
  const format = String(args['format'] ?? 'YYYY-MM-DD');
  const d = new Date(String(value));
  if (isNaN(d.getTime())) {
    throw new Error(`dateFormat: cannot parse date value "${value}"`);
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return format
    .replace('YYYY', String(d.getFullYear()))
    .replace('MM', pad(d.getMonth() + 1))
    .replace('DD', pad(d.getDate()))
    .replace('HH', pad(d.getHours()))
    .replace('mm', pad(d.getMinutes()))
    .replace('ss', pad(d.getSeconds()));
}

/**
 * concat — joins multiple source field values into a single string.
 *
 * @example concat(["John", "Doe"], { separator: " " }) → "John Doe"
 *
 * Note: the MappingEngine passes the resolved source value as the first
 * argument; for concat, this is expected to be an array resolved by the
 * engine from multiple srcPaths (future: multi-src rule).
 * When called with a scalar, it returns String(value).
 */
export function concat(value: unknown, args: Record<string, unknown>): string {
  const separator = String(args['separator'] ?? '');
  if (Array.isArray(value)) {
    return value.map(String).join(separator);
  }
  return String(value ?? '');
}

/**
 * unitConvert — converts a numeric value between units.
 *
 * Supported conversions:
 *   lbs → kg   |   kg → lbs
 *   mi  → km   |   km → mi
 *   ft  → m    |   m  → ft
 *
 * @example unitConvert(100, { from: "lbs", to: "kg" }) → 45.359
 */
export function unitConvert(value: unknown, args: Record<string, unknown>): number {
  const num = Number(value);
  if (isNaN(num)) {
    throw new Error(`unitConvert: value "${value}" is not numeric`);
  }
  const from = String(args['from'] ?? '');
  const to = String(args['to'] ?? '');
  const key = `${from}→${to}`;
  const factors: Record<string, number> = {
    'lbs→kg': 0.453592,
    'kg→lbs': 2.20462,
    'mi→km': 1.60934,
    'km→mi': 0.621371,
    'ft→m': 0.3048,
    'm→ft': 3.28084,
  };
  const factor = factors[key];
  if (factor === undefined) {
    throw new Error(
      `unitConvert: unsupported conversion "${from}" → "${to}". ` +
      `Supported: ${Object.keys(factors).join(', ')}`,
    );
  }
  return Math.round(num * factor * 1000) / 1000;
}

/**
 * coalesce — returns the first non-null, non-undefined value in an array.
 * Useful for fallback field resolution (try field A, else field B, else default).
 *
 * @example coalesce([null, undefined, "fallback"], {}) → "fallback"
 */
export function coalesce(value: unknown, _args: Record<string, unknown>): unknown {
  if (Array.isArray(value)) {
    return value.find((v) => v !== null && v !== undefined) ?? null;
  }
  return value ?? null;
}

// ─── Registry ────────────────────────────────────────────────────────────────

/**
 * FORMULA_REGISTRY — the authoritative list of all platform-verified formulas.
 *
 * The Mapping Canvas UI reads the keys of this registry to populate
 * the Formula Library dropdown. If a formula is not registered here,
 * it cannot be selected in the UI and cannot be executed at runtime.
 */
export const FORMULA_REGISTRY: Record<string, FormulaFn> = {
  dateFormat,
  concat,
  unitConvert,
  coalesce,
};

/**
 * applyFormula — executes a named formula from the registry.
 * Throws a clear error if the formula name is not registered.
 */
export function applyFormula(
  name: string,
  value: unknown,
  args: Record<string, unknown>,
): unknown {
  const fn = FORMULA_REGISTRY[name];
  if (!fn) {
    throw new Error(
      `applyFormula: unknown formula "${name}". ` +
      `Registered formulas: ${Object.keys(FORMULA_REGISTRY).join(', ')}`,
    );
  }
  return fn(value, args);
}
