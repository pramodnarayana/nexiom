import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { describe, it, expect, beforeEach } from 'vitest';
import type { ValidationArguments } from 'class-validator';
import { CreateOAuthSession } from './create-oauth-session.js';
import { ExchangeOAuthCode } from './exchange-oauth-code.js';
import { IsVendorConfigConstraint } from './vendor-config.validator.js';

describe('CreateOAuthSession', () => {
  it('passes with providerName and clientId', async () => {
    const dto = plainToInstance(CreateOAuthSession, {
      providerName: 'google',
      clientId: 'my-client-id',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('passes with all fields provided', async () => {
    const dto = plainToInstance(CreateOAuthSession, {
      providerName: 'github',
      clientId: 'my-client-id',
      vendorParams: { scope: 'read', debug: true, timeout: 30 },
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('fails with missing providerName and clientId', async () => {
    const dto = plainToInstance(CreateOAuthSession, {});
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const props = errors.map((e) => e.property);
    expect(props).toContain('providerName');
    expect(props).toContain('clientId');
  });

  it('fails with invalid providerName format', async () => {
    const dto = plainToInstance(CreateOAuthSession, {
      providerName: 'invalid name!',
      clientId: 'my-client-id',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'providerName')).toBe(true);
  });

  it('fails when vendorParams contains non-primitive values', async () => {
    const dto = plainToInstance(CreateOAuthSession, {
      providerName: 'google',
      clientId: 'my-client-id',
      vendorParams: { nested: { key: 'value' } },
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'vendorParams')).toBe(true);
  });
});

describe('ExchangeOAuthCode', () => {
  const validBase = {
    providerName: 'google',
    code: 'auth-code-123',
    state: 'state-xyz',
    displayName: 'My Google Connection',
  };

  it('passes with required fields only', async () => {
    const dto = plainToInstance(ExchangeOAuthCode, validBase);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('passes with all optional fields provided', async () => {
    const dto = plainToInstance(ExchangeOAuthCode, {
      ...validBase,
      clientId: 'client-id',
      clientSecret: 'client-secret',
      dataSourceId: '550e8400-e29b-41d4-a716-446655440000',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('fails with missing required fields', async () => {
    const dto = plainToInstance(ExchangeOAuthCode, {});
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails with invalid providerName format', async () => {
    const dto = plainToInstance(ExchangeOAuthCode, {
      ...validBase,
      providerName: 'invalid name!',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'providerName')).toBe(true);
  });

  it('fails with non-uuid dataSourceId', async () => {
    const dto = plainToInstance(ExchangeOAuthCode, {
      ...validBase,
      dataSourceId: 'not-a-uuid',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'dataSourceId')).toBe(true);
  });
});

describe('IsVendorConfigConstraint', () => {
  let constraint: IsVendorConfigConstraint;

  beforeEach(() => {
    constraint = new IsVendorConfigConstraint();
  });

  it('returns true for valid primitive record', () => {
    expect(constraint.validate({ key: 'value', num: 1, flag: true })).toBe(
      true,
    );
  });

  it('returns false for null', () => {
    expect(constraint.validate(null)).toBe(false);
  });

  it('returns false for array', () => {
    expect(constraint.validate(['a', 'b'])).toBe(false);
  });

  it('returns false for non-object primitive', () => {
    expect(constraint.validate('string')).toBe(false);
  });

  it('returns false when a value is an object', () => {
    expect(constraint.validate({ key: { nested: true } })).toBe(false);
  });

  it('returns false when a value is an array', () => {
    expect(constraint.validate({ key: [1, 2, 3] })).toBe(false);
  });

  it('defaultMessage returns root object message when root is invalid', () => {
    const msg = constraint.defaultMessage({
      property: 'vendorParams',
      value: null,
    } as ValidationArguments);
    expect(msg).toContain('vendorParams');
    expect(msg).toContain('primitive configuration record');
  });

  it('defaultMessage returns key message when a key value is invalid', () => {
    const msg = constraint.defaultMessage({
      property: 'vendorParams',
      value: { myKey: { nested: true } },
    } as ValidationArguments);
    expect(msg).toContain('myKey');
    expect(msg).toContain('object');
  });

  it('defaultMessage reports array type for array values', () => {
    const msg = constraint.defaultMessage({
      property: 'vendorParams',
      value: { myKey: [1, 2] },
    } as ValidationArguments);
    expect(msg).toContain('array');
  });
});
