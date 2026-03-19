import { describe, it, expect } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { requireOrgId } from './workspace.utils.js';
import type { RequestAuthContext } from '@nexiom/auth';

function makeAuth(organizationId?: string): RequestAuthContext {
  return {
    headers: {} as unknown as Headers,
    user: { organizationId } as RequestAuthContext['user'],
    session: {} as RequestAuthContext['session'],
  };
}

describe('requireOrgId', () => {
  it('returns the orgId when present', () => {
    expect(requireOrgId(makeAuth('org-1'))).toBe('org-1');
  });

  it('throws UnauthorizedException when organizationId is undefined', () => {
    expect(() => requireOrgId(makeAuth(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when user is absent', () => {
    const auth = { headers: {}, session: {} } as unknown as RequestAuthContext;
    expect(() => requireOrgId(auth)).toThrow(UnauthorizedException);
  });
});
