import { describe, it, expect, vi } from 'vitest';
import { validateRequiredEnv } from './constants.js';
import * as identityConstants from '@soopa/identity/constants';

vi.mock('@soopa/identity/constants', () => {
  return {
    getSystemTenantId: vi.fn(),
    getOwnerRoleId: vi.fn(),
    getAdminRoleId: vi.fn(),
    getMemberRoleId: vi.fn(),
  };
});

describe('constants', () => {
  it('validateRequiredEnv should call all getters', () => {
    validateRequiredEnv();

    expect(identityConstants.getSystemTenantId).toHaveBeenCalled();
    expect(identityConstants.getOwnerRoleId).toHaveBeenCalled();
    expect(identityConstants.getAdminRoleId).toHaveBeenCalled();
    expect(identityConstants.getMemberRoleId).toHaveBeenCalled();
  });
});
