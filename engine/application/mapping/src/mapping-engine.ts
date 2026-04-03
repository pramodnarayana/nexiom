/**
 * MappingEngine — Standard Execution Engine.
 *
 * The single entry point for transforming a Canonical Composite JSON into a
 * target payload. Called by FanOutService (L4, apps/worker) in place of the
 * legacy hydratePayload() function.
 *
 * Flow:
 *   1. For each MappingRule: resolve srcPath from compositeJson → apply optional
 *      formula → write to destPath in payload.
 *   2. Pass payload through ConfigApplicator to layer StitchConfig behavioral flags.
 *   3. Return { payload, warnings }.
 *
 * The engine is a pure function with no side effects and no DB calls.
 * All required data must be passed in via MappingInput.
 */

import { applyFormula } from './formula-library.js';
import { apply as applyConfig } from './config-applicator.js';
import type { MappingInput, MappingResult } from './mapping.types.js';

// ─── Path Utilities (proto-safe) ─────────────────────────────────────────────
// Duplicated locally so @nexiom/mapping has no compile-time dep on
// @nexiom/engine until T055 Phase 1 physically moves the engine package.
// Once T055 Ph1 is complete, replace these with imports from engine/platform/core/path-utils.

function isSafeSegment(segment: string): boolean {
  if (
    segment === '' ||
    segment === '__proto__' ||
    segment === 'prototype' ||
    segment === 'constructor'
  ) {
    return false;
  }
  return /^[\w-]+$/.test(segment);
}

function getNestedValue(data: unknown, path: string): unknown {
  const parts = path.replace(/^\$\./, '').split('.');
  let val: unknown = data;
  for (const part of parts) {
    if (!isSafeSegment(part)) return undefined;
    if (val === undefined || val === null) return undefined;
    val = (val as Record<string, unknown>)[part];
  }
  return val;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.replace(/^\$\./, '').split('.');
  for (const part of parts) {
    if (!isSafeSegment(part)) {
      throw new Error(
        `MappingEngine: unsafe path segment "${part}" in "${path}" — ` +
          `segments may not be empty, "__proto__", "prototype", "constructor", ` +
          `or contain non-word characters.`,
      );
    }
  }
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (current[part] === undefined || current[part] === null) {
      current[part] = Object.create(null);
    } else if (typeof current[part] !== 'object' || Array.isArray(current[part])) {
      throw new TypeError(
        `MappingEngine: intermediate key "${part}" in "${path}" already holds a ` +
          `non-object value (${Array.isArray(current[part]) ? 'Array' : typeof current[part]}). ` +
          `Refusing to overwrite.`,
      );
    }
    current = current[part] as Record<string, unknown>;
  }
  const lastKey = parts.at(-1)!;
  current[lastKey] = value;
}

// ─── MappingEngine ────────────────────────────────────────────────────────────

export class MappingEngine {
  /**
   * build — transforms compositeJson into a target payload.
   *
   * @param input  { compositeJson, mappingRules, stitchConfig }
   * @returns      { payload, warnings }
   */
  build(input: MappingInput): MappingResult {
    const { compositeJson, mappingRules, stitchConfig } = input;
    const payload: Record<string, unknown> = Object.create(null);
    const warnings: string[] = [];

    // Step 1 — Field Mapping
    for (const rule of mappingRules) {
      let value = getNestedValue(compositeJson, rule.srcPath);

      if (value === undefined) {
        warnings.push(
          `MappingEngine: srcPath "${rule.srcPath}" resolved to undefined — field skipped`,
        );
        continue;
      }

      // Apply formula if specified
      if (rule.formula) {
        try {
          value = applyFormula(rule.formula.name, value, rule.formula.args);
        } catch (err) {
          warnings.push(
            `MappingEngine: formula "${rule.formula.name}" on srcPath "${rule.srcPath}" ` +
              `failed — ${(err as Error).message}. Field skipped.`,
          );
          continue;
        }
      }

      setNestedValue(payload, rule.destPath, value);
    }

    // Step 2 — StitchConfig behavioral flags
    const { warnings: configWarnings } = applyConfig(payload, stitchConfig);
    warnings.push(...configWarnings);

    return { payload, warnings };
  }
}

/** Singleton instance for convenience — use in FanOutService instead of `new MappingEngine()` */
export const mappingEngine = new MappingEngine();
