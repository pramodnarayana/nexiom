/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController, Login } from './auth.controller';
import { IdentityProvider } from './identity-provider.abstract';
import { UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

describe('AuthController', () => {
  let controller: AuthController;
  let identityProvider: IdentityProvider;

  const mockUser = {
    id: '123',
    email: 'test@example.com',
    name: 'Test User',
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    role: 'user',
    banned: null,
    banReason: null,
    banExpires: null,
  };

  const mockSession = {
    id: 'session-123',
    userId: '123',
    expiresAt: new Date(Date.now() + 86400000),
    token: 'token-123',
    ipAddress: null,
    userAgent: null,
  };

  const mockIdentityProvider = {
    login: jest.fn(),
    createUser: jest.fn(),
    validateSession: jest.fn(),
    createOrganization: jest.fn(),
    provisionTenant: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: IdentityProvider,
          useValue: mockIdentityProvider,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    identityProvider = module.get<IdentityProvider>(IdentityProvider);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('login', () => {
    it('should successfully login with valid credentials', async () => {
      const loginDto: Login = {
        email: 'test@example.com',
        password: 'password123',
      };
      const expectedResult = { session: mockSession, user: mockUser };
      mockIdentityProvider.login.mockResolvedValue(expectedResult);

      const result = await controller.login(loginDto);

      expect(identityProvider.login).toHaveBeenCalledWith(
        loginDto.email,
        loginDto.password,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should handle login failure with invalid credentials', async () => {
      const loginDto: Login = {
        email: 'test@example.com',
        password: 'wrongpassword',
      };
      const error = new UnauthorizedException('Invalid credentials');
      mockIdentityProvider.login.mockRejectedValue(error);

      await expect(controller.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(identityProvider.login).toHaveBeenCalledWith(
        loginDto.email,
        loginDto.password,
      );
    });

    it('should handle login with non-existent user', async () => {
      const loginDto: Login = {
        email: 'nonexistent@example.com',
        password: 'password123',
      };
      const error = new UnauthorizedException('User not found');
      mockIdentityProvider.login.mockRejectedValue(error);

      await expect(controller.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should handle database connection errors during login', async () => {
      const loginDto: Login = {
        email: 'test@example.com',
        password: 'password123',
      };
      const error = new Error('Database connection failed');
      mockIdentityProvider.login.mockRejectedValue(error);

      await expect(controller.login(loginDto)).rejects.toThrow(
        'Database connection failed',
      );
    });
  });

  describe('signup', () => {
    it('should successfully create a new user', async () => {
      const signupDto = {
        email: 'newuser@example.com',
        password: 'password123',
        companyName: 'Test Corp',
        firstName: 'John',
        lastName: 'Doe',
        role: 'user' as const,
      };
      mockIdentityProvider.createUser.mockResolvedValue(mockUser);

      const result = await controller.signup(signupDto);

      expect(identityProvider.createUser).toHaveBeenCalledWith(signupDto);
      expect(result).toEqual(mockUser);
    });

    it('should handle signup with existing email', async () => {
      const signupDto = {
        email: 'existing@example.com',
        password: 'password123',
        companyName: 'Test Corp',
        role: 'user' as const,
      };
      const error = new Error('Email already exists');
      mockIdentityProvider.createUser.mockRejectedValue(error);

      await expect(controller.signup(signupDto)).rejects.toThrow(
        'Email already exists',
      );
    });

    it('should create user with minimal required fields', async () => {
      const signupDto = {
        email: 'minimal@example.com',
        password: 'password123',
        companyName: 'Minimal Corp',
        role: 'user' as const,
      };
      mockIdentityProvider.createUser.mockResolvedValue(mockUser);

      const result = await controller.signup(signupDto);

      expect(result).toEqual(mockUser);
    });
  });

  describe('provisionTenant', () => {
    it('should provision tenant with valid session from cookie', async () => {
      const mockRequest = {
        headers: {},
        cookies: {
          'better-auth.session_token': 'valid-token-123',
        },
      } as unknown as Request;

      const mockSessionData = {
        user: { id: 'user-123' },
        session: mockSession,
      };

      mockIdentityProvider.validateSession = jest
        .fn()
        .mockResolvedValue(mockSessionData);
      mockIdentityProvider.provisionTenant = jest
        .fn()
        .mockResolvedValue({ id: 'org-123', name: 'New Org' });

      const result = await controller.provisionTenant(mockRequest);

      expect(result).toBeDefined();
    });

    it('should provision tenant with valid session from Authorization header', async () => {
      const mockRequest = {
        headers: {
          authorization: 'Bearer valid-token-456',
        },
        cookies: {},
      } as unknown as Request;

      const mockSessionData = {
        user: { id: 'user-456' },
        session: mockSession,
      };

      mockIdentityProvider.validateSession = jest
        .fn()
        .mockResolvedValue(mockSessionData);
      mockIdentityProvider.provisionTenant = jest
        .fn()
        .mockResolvedValue({ id: 'org-456', name: 'Another Org' });

      const result = await controller.provisionTenant(mockRequest);

      expect(result).toBeDefined();
    });

    it('should throw UnauthorizedException when no session found', async () => {
      const mockRequest = {
        headers: {},
        cookies: {},
      } as unknown as Request;

      mockIdentityProvider.validateSession = jest.fn().mockResolvedValue(null);

      await expect(controller.provisionTenant(mockRequest)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(controller.provisionTenant(mockRequest)).rejects.toThrow(
        'No Session Found',
      );
    });

    it('should throw UnauthorizedException with invalid token', async () => {
      const mockRequest = {
        headers: {
          authorization: 'Bearer invalid-token',
        },
        cookies: {},
      } as unknown as Request;

      mockIdentityProvider.validateSession = jest.fn().mockResolvedValue(null);

      await expect(controller.provisionTenant(mockRequest)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should prefer cookie token over Authorization header', async () => {
      const cookieToken = 'cookie-token-123';
      const headerToken = 'header-token-456';

      const mockRequest = {
        headers: {
          authorization: `Bearer ${headerToken}`,
        },
        cookies: {
          'better-auth.session_token': cookieToken,
        },
      } as unknown as Request;

      const mockSessionData = {
        user: { id: 'user-123' },
        session: mockSession,
      };

      mockIdentityProvider.validateSession = jest
        .fn()
        .mockResolvedValue(mockSessionData);
      mockIdentityProvider.provisionTenant = jest
        .fn()
        .mockResolvedValue({ id: 'org-123', name: 'Org' });

      await controller.provisionTenant(mockRequest);

      // Verify it used the cookie token, not the header token
      expect(mockIdentityProvider.validateSession).toHaveBeenCalledWith(
        cookieToken,
      );
    });
  });
});
