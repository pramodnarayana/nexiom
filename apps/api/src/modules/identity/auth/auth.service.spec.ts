import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import {
  AUTH_PROVIDER,
  TENANT_PROVIDER,
  PERMISSION_PROVIDER,
} from '@nexiom/identity';

describe('AuthService', () => {
  let service: AuthService;

  const mockAuthProvider = {
    login: jest.fn(),
    getSessionFromHeaders: jest.fn(),
    validateSession: jest.fn(),
    createUser: jest.fn(),
    setPassword: jest.fn(),
    getHandler: jest.fn(),
  };

  const mockTenantProvider = {
    findAllForUser: jest.fn(),
  };

  const mockPermissionProvider = {
    getPermissions: jest.fn().mockResolvedValue([]),
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
    jest.clearAllMocks();
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
  });

  describe('createUser', () => {
    it('should delegate to authProvider.createUser', async () => {
      const input = { email: 'new@example.com' };
      const expected = { id: 'u1' };
      mockAuthProvider.createUser.mockResolvedValue(expected);

      const result = await service.createUser(input);

      expect(mockAuthProvider.createUser).toHaveBeenCalledWith(input);
      expect(result).toEqual(expected);
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
            useValue: { getPermissions: jest.fn().mockResolvedValue([]) },
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
      const mockHandler = jest.fn();
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
      const mockHandlerResult = jest.fn();
      mockAuthProvider.getHandler.mockReturnValue(mockHandlerResult);

      service.getHandler();

      expect(mockAuthProvider.getHandler).toHaveBeenCalled();
      expect(mockAuthProvider.getHandler.mock.contexts[0]).toBe(
        mockAuthProvider,
      );
    });
  });
});
