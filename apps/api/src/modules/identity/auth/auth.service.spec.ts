import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import {
  AUTH_PROVIDER,
  TENANT_PROVIDER,
  PERMISSION_PROVIDER,
  SYSTEM_TENANT_ID,
  User,
} from '@nexiom/identity';

describe('AuthService', () => {
  let service: AuthService;

  const mockAuthProvider = {
    login: vi.fn(),
    getSessionFromHeaders: vi.fn(),
    validateSession: vi.fn(),
    createUser: vi.fn(),
    setPassword: vi.fn(),
    getHandler: vi.fn(),
    resendVerificationEmail: vi.fn(),
  };

  const mockTenantProvider = {
    findAllForUser: vi.fn(),
    provisionTenantForUser: vi.fn(),
  };

  const mockPermissionProvider = {
    getPermissions: vi.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: AUTH_PROVIDER,
          useValue: mockAuthProvider,
        },
        {
          provide: TENANT_PROVIDER,
          useValue: mockTenantProvider,
        },
        {
          provide: PERMISSION_PROVIDER,
          useValue: mockPermissionProvider,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login', () => {
    it('should delegate to authProvider.login', async () => {
      const credentials = { email: 'test@example.com', password: 'pass' };
      const expectedResult = { session: {}, user: {}, cookie: 'c' };
      mockAuthProvider.login.mockResolvedValue(expectedResult);

      const result = await service.login(credentials);

      expect(mockAuthProvider.login).toHaveBeenCalledWith(credentials);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('getSessionFromHeaders', () => {
    it('should return session and user if provider returns valid data', async () => {
      const headers = new Headers();
      const mockResult = { session: { id: 's1' }, user: { id: 'u1' } };
      mockAuthProvider.getSessionFromHeaders.mockResolvedValue(mockResult);

      const result = await service.getSessionFromHeaders(headers);

      expect(mockAuthProvider.getSessionFromHeaders).toHaveBeenCalledWith(
        headers,
      );
      expect(result).toEqual(mockResult);
    });

    it('should return null if provider returns null', async () => {
      const headers = new Headers();
      mockAuthProvider.getSessionFromHeaders.mockResolvedValue(null);

      const result = await service.getSessionFromHeaders(headers);

      expect(result).toBeNull();
    });
  });

  describe('getEnrichedSession', () => {
    it('should return enriched session with organizationId if tenant exists', async () => {
      const token = 'valid-token';
      const mockSession = { session: { id: 's1' }, user: { id: 'u1' } };
      const mockTenants = [
        { id: 'org-old', createdAt: new Date('2023-01-01') },
        { id: 'org-new', createdAt: new Date('2023-01-02') },
      ];

      mockAuthProvider.validateSession.mockResolvedValue(mockSession);
      mockTenantProvider.findAllForUser.mockResolvedValue(mockTenants);

      const result = await service.getEnrichedSession(token);

      expect(mockAuthProvider.validateSession).toHaveBeenCalledWith(token);
      expect(mockTenantProvider.findAllForUser).toHaveBeenCalledWith('u1');

      // Should pick 'org-new' because it is newer
      expect(result?.user.organizationId).toBe('org-new');

      expect(result?.user.hasTenant).toBe(true);
    });

    it('should return enriched session without organizationId if no tenant', async () => {
      const token = 'valid-token';
      const mockSession = { session: { id: 's1' }, user: { id: 'u1' } };
      mockTenantProvider.findAllForUser.mockResolvedValue([]);

      mockAuthProvider.validateSession.mockResolvedValue(mockSession);

      const result = await service.getEnrichedSession(token);

      expect(result?.user.organizationId).toBeUndefined();

      expect(result?.user.hasTenant).toBe(false);
    });

    it('should return null if validateSession returns null', async () => {
      mockAuthProvider.validateSession.mockResolvedValue(null);
      const result = await service.getEnrichedSession('invalid');
      expect(result).toBeNull();
    });

    it('should load system permissions from provider', async () => {
      const token = 'system-user-token';
      const mockSession = {
        session: { id: 's2' },
        user: { id: 'u2' },
      };

      mockAuthProvider.validateSession.mockResolvedValue(mockSession);
      mockTenantProvider.findAllForUser.mockResolvedValue([]);

      // Mock system permissions
      mockPermissionProvider.getPermissions.mockResolvedValueOnce([
        'system:view',
      ]);

      const result = await service.getEnrichedSession(token);

      expect(mockPermissionProvider.getPermissions).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'u2' }),
        SYSTEM_TENANT_ID,
      );
      expect(result?.user.permissions).toContain('system:view');
    });
    it('should ignore errors when loading system permissions', async () => {
      const token = 'system-error-token';
      const mockSession = {
        session: { id: 's3' },
        user: { id: 'u3' },
      };

      mockAuthProvider.validateSession.mockResolvedValue(mockSession);
      mockTenantProvider.findAllForUser.mockResolvedValue([]);

      // Force error on system permissions
      mockPermissionProvider.getPermissions.mockRejectedValue(
        new Error('DB Error'),
      );

      const result = await service.getEnrichedSession(token);

      expect(result).toBeDefined();
      expect(result?.user.permissions).toEqual([]);
    });

    it('should ignore errors when loading tenant permissions', async () => {
      const token = 'tenant-error-token';
      const mockSession = { session: { id: 's4' }, user: { id: 'u4' } };
      const mockTenants = [{ id: 'org-fail', createdAt: new Date() }];

      mockAuthProvider.validateSession.mockResolvedValue(mockSession);
      mockTenantProvider.findAllForUser.mockResolvedValue(mockTenants);

      // Force error on tenant permissions
      // First call (system) succeeds with empty, second (tenant) fails
      mockPermissionProvider.getPermissions
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('Tenant DB Error'));

      const result = await service.getEnrichedSession(token);

      expect(result).toBeDefined();
      // Should still return session, just without tenant perms
      expect(result?.user.organizationId).toBe('org-fail');
      expect(result?.user.permissions).toEqual([]);
    });
  });

  describe('hasSystemPermission', () => {
    it('should return true if user has specific permission', async () => {
      const user = { id: 'u1' } as User;
      mockPermissionProvider.getPermissions.mockResolvedValue([
        'system:manage',
      ]);
      const result = await service.hasSystemPermission(user, 'manage');
      expect(result).toBe(true);
    });

    it('should return true if user has wildcard permission', async () => {
      const user = { id: 'u1' } as User;
      mockPermissionProvider.getPermissions.mockResolvedValue(['*']);
      const result = await service.hasSystemPermission(user, 'view');
      expect(result).toBe(true);
    });

    it('should return false if user does not have permission', async () => {
      const user = { id: 'u1' } as User;
      mockPermissionProvider.getPermissions.mockResolvedValue([]);
      const result = await service.hasSystemPermission(user, 'view');
      expect(result).toBe(false);
    });

    it('should return false if permission check throws', async () => {
      const user = { id: 'u1' } as User;
      mockPermissionProvider.getPermissions.mockRejectedValue(
        new Error('DB Error'),
      );
      const result = await service.hasSystemPermission(user, 'view');
      expect(result).toBe(false);
    });
  });

  describe('createUser', () => {
    it('should delegate to authProvider.createUser and auto-provision tenant', async () => {
      const input = { email: 'new@example.com' };
      const expectedUser = { id: 'u1' };
      mockAuthProvider.createUser.mockResolvedValue(expectedUser);
      mockTenantProvider.provisionTenantForUser.mockResolvedValue({
        id: 'org1',
      });

      const result = await service.createUser(input);

      expect(mockAuthProvider.createUser).toHaveBeenCalledWith(input);
      expect(mockTenantProvider.provisionTenantForUser).toHaveBeenCalledWith(
        'u1',
      );
      expect(result).toEqual(expectedUser);
    });

    it('should swallow error if auto-provisioning fails', async () => {
      const input = { email: 'new@example.com' };
      const expectedUser = { id: 'u1' };
      mockAuthProvider.createUser.mockResolvedValue(expectedUser);
      mockTenantProvider.provisionTenantForUser.mockRejectedValue(
        new Error('Provision failed'),
      );

      // Should not throw
      const result = await service.createUser(input);

      expect(result).toEqual(expectedUser);
    });
  });

  describe('setPassword', () => {
    it('should delegate to authProvider.setPassword', async () => {
      mockAuthProvider.setPassword.mockResolvedValue({ success: true });
      await service.setPassword('u1', 'pass');
      expect(mockAuthProvider.setPassword).toHaveBeenCalledWith('u1', 'pass');
    });

    it('should throw if authProvider.setPassword is missing', async () => {
      const providerWithoutSetPassword = { ...mockAuthProvider };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      delete (providerWithoutSetPassword as any).setPassword;

      // Recompile module to inject modified provider
      const module = await Test.createTestingModule({
        providers: [
          AuthService,
          { provide: AUTH_PROVIDER, useValue: providerWithoutSetPassword },
          { provide: TENANT_PROVIDER, useValue: mockTenantProvider },
          {
            provide: PERMISSION_PROVIDER,
            useValue: { getPermissions: vi.fn().mockResolvedValue([]) },
          },
        ],
      }).compile();
      const localService = module.get<AuthService>(AuthService);

      await expect(localService.setPassword('u1', 'p')).rejects.toThrow(
        'Auth Provider does not support setting password',
      );
    });
  });

  describe('getHandler', () => {
    it('should return handler from provider', () => {
      const mockHandler = vi.fn();
      mockAuthProvider.getHandler.mockReturnValue(mockHandler);

      expect(service.getHandler()).toBeDefined();
    });

    it('should throw TypeError if provider does not support getHandler', () => {
      const originalHandler = mockAuthProvider.getHandler;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (mockAuthProvider as any).getHandler = undefined;

      expect(() => {
        service.getHandler();
      }).toThrow(TypeError);

      mockAuthProvider.getHandler = originalHandler;
    });

    it('should bind handler to provider context', () => {
      const mockHandlerResult = vi.fn();
      mockAuthProvider.getHandler.mockReturnValue(mockHandlerResult);

      service.getHandler();

      expect(mockAuthProvider.getHandler).toHaveBeenCalled();
      expect(mockAuthProvider.getHandler.mock.contexts[0]).toBe(
        mockAuthProvider,
      );
    });
  });
});
