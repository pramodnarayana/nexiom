import { describe, it, expect } from 'vitest';
import { MappingEngine } from './mapping-engine.js';
import type { MappingRule, StitchConfig } from './mapping.types.js';

const engine = new MappingEngine();

// ─── Field Mapping ────────────────────────────────────────────────────────────

describe('MappingEngine — field mapping', () => {
  it('resolves a top-level srcPath and sets destPath', () => {
    const result = engine.build({
      compositeJson: { amount: 1500 },
      mappingRules: [{ srcPath: 'amount', destPath: 'TotalAmt' }],
      stitchConfig: {},
    });
    expect(result.payload['TotalAmt']).toBe(1500);
    expect(result.warnings).toHaveLength(0);
  });

  it('resolves a nested srcPath using dot notation', () => {
    const result = engine.build({
      compositeJson: { Account: { TaxId: 'TX-001' } },
      mappingRules: [{ srcPath: 'Account.TaxId', destPath: 'VendorRef.TaxIdentifier' }],
      stitchConfig: {},
    });
    expect((result.payload['VendorRef'] as Record<string, unknown>)['TaxIdentifier']).toBe('TX-001');
  });

  it('handles multiple rules independently', () => {
    const rules: MappingRule[] = [
      { srcPath: 'Load.TotalWeight', destPath: 'TotalAmt' },
      { srcPath: 'Load.RefNumber', destPath: 'DocNumber' },
    ];
    const result = engine.build({
      compositeJson: { Load: { TotalWeight: 200, RefNumber: 'REF-42' } },
      mappingRules: rules,
      stitchConfig: {},
    });
    expect(result.payload['TotalAmt']).toBe(200);
    expect(result.payload['DocNumber']).toBe('REF-42');
  });

  it('emits a warning and skips field when srcPath resolves to undefined', () => {
    const result = engine.build({
      compositeJson: { amount: 100 },
      mappingRules: [{ srcPath: 'nonExistent.field', destPath: 'TotalAmt' }],
      stitchConfig: {},
    });
    expect(result.payload['TotalAmt']).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('nonExistent.field');
  });

  it('throws on unsafe destPath segment (__proto__)', () => {
    expect(() =>
      engine.build({
        compositeJson: { val: 1 },
        mappingRules: [{ srcPath: 'val', destPath: '__proto__.polluted' }],
        stitchConfig: {},
      }),
    ).toThrow(/unsafe path segment/);
  });

  it('returns empty payload with no warnings when mappingRules is empty', () => {
    const result = engine.build({
      compositeJson: { amount: 100 },
      mappingRules: [],
      stitchConfig: {},
    });
    expect(Object.keys(result.payload)).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

// ─── Formula Library ──────────────────────────────────────────────────────────

describe('MappingEngine — formula application', () => {
  it('applies dateFormat formula to a date string', () => {
    const result = engine.build({
      compositeJson: { invoiceDate: '2024-01-30' },
      mappingRules: [
        {
          srcPath: 'invoiceDate',
          destPath: 'TxnDate',
          formula: { name: 'dateFormat', args: { format: 'DD/MM/YYYY' } },
        },
      ],
      stitchConfig: {},
    });
    expect(result.payload['TxnDate']).toBe('30/01/2024');
    expect(result.warnings).toHaveLength(0);
  });

  it('applies concat formula to an array', () => {
    const result = engine.build({
      compositeJson: { parts: ['John', 'Doe'] },
      mappingRules: [
        {
          srcPath: 'parts',
          destPath: 'DisplayName',
          formula: { name: 'concat', args: { separator: ' ' } },
        },
      ],
      stitchConfig: {},
    });
    expect(result.payload['DisplayName']).toBe('John Doe');
  });

  it('applies coalesce formula — returns first non-null value', () => {
    const result = engine.build({
      compositeJson: { fallbacks: [null, undefined, 'found'] },
      mappingRules: [
        {
          srcPath: 'fallbacks',
          destPath: 'DocNumber',
          formula: { name: 'coalesce', args: {} },
        },
      ],
      stitchConfig: {},
    });
    expect(result.payload['DocNumber']).toBe('found');
  });

  it('emits a warning and skips field when formula throws', () => {
    const result = engine.build({
      compositeJson: { date: 'not-a-date' },
      mappingRules: [
        {
          srcPath: 'date',
          destPath: 'TxnDate',
          formula: { name: 'dateFormat', args: { format: 'DD/MM/YYYY' } },
        },
      ],
      stitchConfig: {},
    });
    expect(result.payload['TxnDate']).toBeUndefined();
    expect(result.warnings[0]).toContain('dateFormat');
  });

  it('emits a warning and skips field on unknown formula name', () => {
    const result = engine.build({
      compositeJson: { val: 'x' },
      mappingRules: [
        {
          srcPath: 'val',
          destPath: 'out',
          formula: { name: 'unknownFormula', args: {} },
        },
      ],
      stitchConfig: {},
    });
    expect(result.payload['out']).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/unknownFormula/);
  });
});

// ─── Config Applicator ────────────────────────────────────────────────────────

describe('MappingEngine — StitchConfig behavioral flags', () => {
  it('adds TxnTaxDetail when useTaxCode is true and taxCodeDefault is set', () => {
    const config: StitchConfig = { useTaxCode: true, taxCodeDefault: 'TAX-001' };
    const result = engine.build({
      compositeJson: { amount: 500 },
      mappingRules: [{ srcPath: 'amount', destPath: 'TotalAmt' }],
      stitchConfig: config,
    });
    expect(result.payload['TxnTaxDetail']).toEqual({ TaxCode: 'TAX-001' });
    expect(result.warnings).toHaveLength(0);
  });

  it('does NOT add TxnTaxDetail when useTaxCode is false', () => {
    const config: StitchConfig = { useTaxCode: false };
    const result = engine.build({
      compositeJson: { amount: 500 },
      mappingRules: [{ srcPath: 'amount', destPath: 'TotalAmt' }],
      stitchConfig: config,
    });
    expect(result.payload['TxnTaxDetail']).toBeUndefined();
    expect(result.warnings).toHaveLength(0);
  });

  it('emits a warning when useTaxCode is true but taxCodeDefault is missing', () => {
    const config: StitchConfig = { useTaxCode: true };
    const result = engine.build({
      compositeJson: { amount: 500 },
      mappingRules: [],
      stitchConfig: config,
    });
    expect(result.payload['TxnTaxDetail']).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('taxCodeDefault');
  });

  it('applies currencyOverride to CurrencyRef.value', () => {
    const config: StitchConfig = { currencyOverride: 'USD' };
    const result = engine.build({
      compositeJson: {},
      mappingRules: [],
      stitchConfig: config,
    });
    expect((result.payload['CurrencyRef'] as Record<string, unknown>)['value']).toBe('USD');
  });

  it('overrides existing CurrencyRef.value when currencyOverride is set', () => {
    const config: StitchConfig = { currencyOverride: 'EUR' };
    const result = engine.build({
      compositeJson: { currency: 'GBP' },
      mappingRules: [{ srcPath: 'currency', destPath: 'CurrencyRef.value' }],
      stitchConfig: config,
    });
    // Config applicator runs after field mapping — override wins
    expect((result.payload['CurrencyRef'] as Record<string, unknown>)['value']).toBe('EUR');
  });
});
