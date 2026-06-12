/**
 * MappingEngine — Standard Execution Engine.
 *
 * The single entry point for transforming a Canonical Composite JSON into a
 * target payload. Called by FanOutService (L4, apps/worker) in place of the
 * legacy hydratePayload() function.
 *
 * ## Flow
 *
 *   For each MappingRule (in order):
 *     a. If `expression` is set  → evaluate the JSONata expression against
 *        compositeJson. Result is written to destPath.
 *     b. If no `expression`      → extract value at srcPath from compositeJson,
 *        write to destPath (simple copy).
 *   Then: pass payload through ConfigApplicator (StitchConfig behavioral flags).
 *
 * ## JSONata
 *
 *   JSONata expressions have full access to the compositeJson context:
 *     - Reference any field:   Account.Name, Load.TotalWeight
 *     - Use built-in functions: $uppercase(name), $round(amount, 2)
 *     - Format dates:           $fromMillis($toMillis(invoiceDate), '[D01]/[M01]/[Y0001]')
 *     - Concatenate:            firstName & ' ' & lastName
 *     - Conditionals:           status = 'active' ? 'Y' : 'N'
 *     - Array transforms:       LineItems.{ 'desc': description, 'qty': quantity }
 *
 * ## Performance
 *
 *   JSONata expressions are compiled once on first use and cached per engine
 *   instance. For long-lived worker processes, the same compiled expression
 *   is reused across all records in a batch.
 *
 * ## Side effects
 *
 *   None. This engine is a pure function of its inputs. No DB access, no
 *   network calls, no global state mutation.
 */

import jsonata from 'jsonata';
import { apply as applyConfig } from './config-applicator.js';
import { bindExtensions } from './jsonata-extensions.js';
import type { MappingInput, MappingResult } from './mapping.types.js';

// ─── Path Utilities (proto-safe) ─────────────────────────────────────────────
// Inlined locally until T055 Phase 1 moves packages/engine → engine/platform/core/path-utils.
// FIXME(T055-P1): replace with import from '@soopa/utils/path-utils'

function isSafeSegment(segment: string): boolean {
  return (
    segment !== '' &&
    segment !== '__proto__' &&
    segment !== 'prototype' &&
    segment !== 'constructor' &&
    /^[\w-]+$/.test(segment)
  );
}

function getNestedValue(data: unknown, path: string): unknown {
  const parts = path.replace(/^\$\./, '').split('.');
  let val: unknown = data;
  for (const part of parts) {
    if (!isSafeSegment(part) || val === undefined || val === null) return undefined;
    if (!Object.prototype.hasOwnProperty.call(val, part)) return undefined;
    val = (val as Record<string, unknown>)[part];
  }
  return val;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.replace(/^\$\./, '').split('.');

  for (const part of parts) {
    if (!isSafeSegment(part)) {
      throw new Error(
        `MappingEngine: unsafe path segment "${part}" in destPath "${path}". ` +
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
      `MappingEngine: intermediate key "${part}" in "${fullPath}" already holds a ` +
        `non-object value (${Array.isArray(current[part]) ? 'Array' : typeof current[part]}). ` +
        `Refusing to overwrite.`,
    );
  }
  return current[part] as Record<string, unknown>;
}

function cloneMappedValue(val: unknown): unknown {
  if (typeof val === 'object' && val !== null) {
    return structuredClone(val);
  }
  return val;
}

// ─── Expression Cache ─────────────────────────────────────────────────────────

type CompiledExpression = ReturnType<typeof jsonata>;

/**
 * Compile a JSONata expression string and bind Soopa extensions.
 * Throws if the expression has a syntax error (fail-fast at compile time).
 */
function compile(src: string): CompiledExpression {
  const expr = jsonata(src);
  bindExtensions(expr);
  return expr;
}

// ─── MappingEngine ────────────────────────────────────────────────────────────

export const MAX_EXPRESSION_CACHE = 1000;

export class MappingEngine {
  /**
   * Per-instance expression cache (bounded LRU).
   * Key: raw expression string  Value: compiled JSONata expression.
   * Worker processes reuse one MappingEngine instance across a batch,
   * so a given expression is compiled at most once per worker lifetime.
   */
  private readonly cache = new Map<string, CompiledExpression>();
  
  /** Maximum number of expressions to cache in order to limit memory growth. */
  private readonly maxCacheSize: number;

  constructor(maxCacheSize: number = MAX_EXPRESSION_CACHE) {
    if (typeof maxCacheSize !== 'number' || Number.isNaN(maxCacheSize)) {
      this.maxCacheSize = 1;
      return;
    }
    const size = Math.floor(maxCacheSize);
    this.maxCacheSize = size <= 0 ? 1 : Math.min(size, MAX_EXPRESSION_CACHE);
  }

  private getExpression(src: string): CompiledExpression {
    let expr = this.cache.get(src);
    if (!expr) {
      expr = compile(src);
      if (this.cache.size >= this.maxCacheSize) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey !== undefined) {
          this.cache.delete(oldestKey);
        }
      }
      this.cache.set(src, expr);
    } else {
      // LRU refresh: mark as recently used
      this.cache.delete(src);
      this.cache.set(src, expr);
    }
    return expr;
  }

  /**
   * build — transforms compositeJson into a target payload.
   *
   * @param input  { compositeJson, mappingRules, stitchConfig }
   * @returns      Promise<{ payload, warnings }>
   */
  async build(input: MappingInput): Promise<MappingResult> {
    const { compositeJson, mappingRules, stitchConfig } = input;
    const payload: Record<string, unknown> = Object.create(null);
    const warnings: string[] = [];

    for (const rule of mappingRules) {
      let value: unknown;

      if (rule.expression !== undefined) {
        if (typeof rule.expression !== 'string' || rule.expression.trim() === '') {
          warnings.push(
            `MappingEngine: invalid or empty expression for destPath "${rule.destPath}" ` +
              `— field skipped.`,
          );
          continue;
        }
        // ── JSONata path ──────────────────────────────────────────────────────
        let expr: CompiledExpression;
        try {
          expr = this.getExpression(rule.expression);
        } catch (err) {
          // Compile-time syntax error — skip field, emit warning
          warnings.push(
            `MappingEngine: invalid JSONata expression for destPath "${rule.destPath}" ` +
              `— ${(err as Error).message}. Field skipped.`,
          );
          continue;
        }

        try {
          value = await expr.evaluate(compositeJson);
        } catch (err) {
          warnings.push(
            `MappingEngine: JSONata evaluation failed for destPath "${rule.destPath}" ` +
              `— ${(err as Error).message}. Field skipped.`,
          );
          continue;
        }

        if (value === undefined) {
          warnings.push(
            `MappingEngine: expression for destPath "${rule.destPath}" evaluated to ` +
              `undefined — field skipped.`,
          );
          continue;
        }
      } else {
        // ── Simple copy path ────────────────────────────────────────────────
        value = getNestedValue(compositeJson, rule.srcPath);
        if (value === undefined) {
          warnings.push(
            `MappingEngine: srcPath "${rule.srcPath}" resolved to undefined — field skipped.`,
          );
          continue;
        }
      }

      try {
        setNestedValue(payload, rule.destPath, cloneMappedValue(value));
      } catch (err) {
        warnings.push(
          `MappingEngine: could not write to destPath "${rule.destPath}" ` +
            `— ${(err as Error).message}. Field skipped.`,
        );
      }
    }

    // Apply StitchConfig behavioral flags (run after all field mapping)
    const { warnings: configWarnings } = applyConfig(payload, stitchConfig);
    warnings.push(...configWarnings);

    return { payload, warnings };
  }
}

/** Singleton instance — import this in FanOutService instead of `new MappingEngine()` */
export const mappingEngine = new MappingEngine();
