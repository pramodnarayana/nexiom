/**
 * JSONata Extensions — custom function bindings for Nexiom-specific operations.
 *
 * JSONata's standard library already provides 70+ built-in functions covering:
 *   - String:  $uppercase, $lowercase, $trim, $substring, $join, $split, $replace, ...
 *   - Number:  $number, $abs, $round, $floor, $ceil, $formatNumber, ...
 *   - Date:    $now, $fromMillis, $toMillis, $millis, ...
 *   - Array:   $count, $sum, $min, $max, $average, $sort, $reverse, $map, $filter, ...
 *   - Object:  $keys, $values, $merge, $lookup, $exists, ...
 *   - Boolean: $boolean, $not, $exists, ...
 *
 * This file registers ADDITIONAL functions beyond Jsonata's standard library —
 * Nexiom domain-specific operations that cannot be expressed with existing builtins.
 *
 * Usage in a mapping expression (examples using standard Jsonata builtins):
 *   Date format:  $fromMillis($toMillis(invoiceDate), '[D01]/[M01]/[Y0001]')
 *   Uppercase:    $uppercase(Account.Name)
 *   Concat:       firstName & ' ' & lastName
 *   Math:         $round(amount * 1.2, 2)
 *   Conditional:  status = 'active' ? 'Y' : 'N'
 *   Array map:    LineItems.{ 'desc': description, 'qty': quantity }
 *
 * Adding a new Nexiom extension:
 *   1. Implement the function below.
 *   2. Call expression.registerFunction(name, fn, signature?) inside bindExtensions().
 *   3. Document it in the Formula Library section of sync_strategy.md.
 */

import type jsonata from 'jsonata';

type JsonataExpression = ReturnType<typeof jsonata>;

/**
 * bindExtensions — registers all Nexiom custom functions on a compiled JSONata expression.
 * Called once per expression during compilation in MappingEngine.
 *
 * @param expression  A compiled JSONata expression returned by jsonata(src)
 */
export function bindExtensions(expression: JsonataExpression): void {
  // ── Placeholder — add domain-specific functions here as needed ───────────
  //
  // Example (do not uncomment until needed):
  //
  // expression.registerFunction(
  //   'nexiomConvert',
  //   (value: number, from: string, to: string) => { ... },
  //   '<nss>',   // JSONata type signature: number, string, string
  // );
  //
  // ─────────────────────────────────────────────────────────────────────────
  void expression; // Remove this line once the first extension is added
}
