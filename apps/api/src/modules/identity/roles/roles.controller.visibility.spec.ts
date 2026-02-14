import { Test, TestingModule } from '@nestjs/testing';
import { RolesController } from './roles.controller';
import { ROLE_PROVIDER } from '@nexiom/identity';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequestAuthContext } from '../auth/auth-context.decorator';

import { vi, describe, it, expect, beforeEach, Mock } from 'vitest';

describe('RolesController - Visibility Logic', () => {
  let controller: RolesController;
  let mockRoleProvider: {
    findAll: Mock;
    create: Mock;
    findById: Mock;
    update: Mock;
    delete: Mock;
  };

  const mockRoles = [
    { id: 'r1', name: 'Owner' },
    { id: 'r2', name: 'Admin' },
    { id: 'r3', name: 'Member' },
  ];

  beforeEach(async () => {
    mockRoleProvider = {
      findAll: vi.fn().mockResolvedValue(mockRoles),
      create: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RolesController],
      providers: [
        {
          provide: ROLE_PROVIDER,
          useValue: mockRoleProvider,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<RolesController>(RolesController);
  });

  it('should filter out Owner role for a Member requester', async () => {
    const mockContext = {
      user: { role: 'member', memberRole: 'member' },
      headers: new Headers(),
      session: { id: 'test-session' },
    } as unknown as RequestAuthContext;

    const result = await controller.findAll(mockContext);

    expect(result.data).toHaveLength(2);
    expect(result.data.find((r) => r.name === 'Owner')).toBeUndefined();
    expect(result.data.find((r) => r.name === 'Member')).toBeDefined();
  });
});
