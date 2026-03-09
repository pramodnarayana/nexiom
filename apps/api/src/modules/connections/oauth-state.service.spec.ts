import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OauthStateService } from './oauth-state.service.js';
import { UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { REDIS_CLIENT } from '@nexiom/cache';

describe('OauthStateService', () => {
  let service: OauthStateService;
  const mockTenantId = 'tenant-123';
  const mockProvider = 'mock-piece';

  beforeEach(async () => {
    const mockConfigService = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'JWT_SECRET') return 'test-master-secret';
        if (key === 'OAUTH_STATE_SECRET') return undefined; // trigger HMAC branch
        if (key === 'NODE_ENV') return 'test';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OauthStateService,
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: REDIS_CLIENT,
          useValue: {
            set: vi.fn(),
            get: vi
              .fn()
              .mockResolvedValue(JSON.stringify({ realmId: 'test-123' })),
            del: vi.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<OauthStateService>(OauthStateService);
  });

  describe('constructor', () => {
    it('should use OAUTH_STATE_SECRET if provided and not throw', async () => {
      const explicitConfigService = {
        get: vi.fn().mockImplementation((key: string) => {
          if (key === 'OAUTH_STATE_SECRET') return 'explicit-secret';
          if (key === 'NODE_ENV') return 'test';
          return undefined;
        }),
      };

      const explicitModule = await Test.createTestingModule({
        providers: [
          OauthStateService,
          { provide: ConfigService, useValue: explicitConfigService },
          {
            provide: REDIS_CLIENT,
            useValue: {
              set: vi.fn(),
              get: vi
                .fn()
                .mockResolvedValue(JSON.stringify({ realmId: 'test-123' })),
              del: vi.fn(),
            },
          },
        ],
      }).compile();

      const explicitService =
        explicitModule.get<OauthStateService>(OauthStateService);
      const token = await explicitService.generateState('tenant', 'provider');
      const verified = await explicitService.verifyState(token, 'provider');
      expect(verified.tenantId).toBe('tenant');
    });

    it('should throw Error in production if secrets are missing', async () => {
      const prodConfigService = {
        get: vi.fn().mockImplementation((key: string) => {
          if (key === 'NODE_ENV') return 'production';
          return undefined; // no secrets
        }),
      };

      await expect(
        Test.createTestingModule({
          providers: [
            OauthStateService,
            { provide: ConfigService, useValue: prodConfigService },
            {
              provide: REDIS_CLIENT,
              useValue: { set: vi.fn(), get: vi.fn(), del: vi.fn() },
            },
          ],
        }).compile(),
      ).rejects.toThrow(
        'FATAL: JWT_SECRET or OAUTH_STATE_SECRET must be provided in production',
      );
    });
  });

  describe('generateState', () => {
    it('should generate a valid JWT containing the tenantId, provider, and env', async () => {
      const stateToken = await service.generateState(
        mockTenantId,
        mockProvider,
        {
          realmId: 'test-123',
        },
      );

      expect(typeof stateToken).toBe('string');
      expect(stateToken.split('.').length).toBe(3); // Header.Payload.Signature

      // We can manually decode to verify contents without verifying signature
      const decoded = jwt.decode(stateToken) as jwt.JwtPayload;
      expect(decoded.tenantId).toBe(mockTenantId);
      expect(decoded.provider).toBe(mockProvider);
      expect(decoded.vendorParams).toBeUndefined();
      expect(decoded.purpose).toBe('oauth_state_handshake');
      expect(decoded.exp).toBeDefined();
    });
  });

  describe('verifyState', () => {
    it('should successfully verify and extract a valid state token', async () => {
      const validToken = await service.generateState(
        mockTenantId,
        mockProvider,
        {
          realmId: 'test-123',
        },
      );

      const result = await service.verifyState(validToken, mockProvider);
      expect(result).toEqual({
        tenantId: mockTenantId,
        vendorParams: { realmId: 'test-123' },
      });
    });

    it('should throw UnauthorizedException if token is completely missing', async () => {
      await expect(service.verifyState('', mockProvider)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(
        service.verifyState(undefined as unknown as string, mockProvider),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if the provider does not match the token payload', async () => {
      const validToken = await service.generateState(
        mockTenantId,
        mockProvider,
      );

      await expect(service.verifyState(validToken, 'hubspot')).rejects.toThrow(
        new UnauthorizedException('OAuth state provider mismatch'),
      );
    });

    it('should throw UnauthorizedException if the purpose is incorrect', async () => {
      // Simulate an internal attacker signing a generic JWT from somewhere else in the app
      const maliciousToken = jwt.sign(
        {
          tenantId: mockTenantId,
          provider: mockProvider,
          purpose: 'something_else',
        },
        (service as unknown as { jwtSecret: string }).jwtSecret,
      );

      await expect(
        service.verifyState(maliciousToken, mockProvider),
      ).rejects.toThrow(
        new UnauthorizedException('Invalid OAuth state purpose'),
      );
    });

    it('should throw UnauthorizedException if the token is tampered with (invalid signature)', async () => {
      const validToken = await service.generateState(
        mockTenantId,
        mockProvider,
      );
      const tokenParts = validToken.split('.');

      // Tamper with the payload specifically
      const tamperedPayload = Buffer.from(
        JSON.stringify({
          tenantId: 'attacker-tenant',
          provider: mockProvider,
          purpose: 'oauth_state_handshake',
        }),
      ).toString('base64url');
      const forgedToken = `${tokenParts[0]}.${tamperedPayload}.${tokenParts[2]}`;

      await expect(
        service.verifyState(forgedToken, mockProvider),
      ).rejects.toThrow(
        new UnauthorizedException(
          'Invalid OAuth state. Potential CSRF detected.',
        ),
      );
    });

    it('should throw UnauthorizedException pointing to expiration if the JWT is expired', async () => {
      // Create a token that expires instantly
      const expiredToken = jwt.sign(
        {
          tenantId: mockTenantId,
          provider: mockProvider,
          purpose: 'oauth_state_handshake',
        },
        (service as unknown as { jwtSecret: string }).jwtSecret,
        { expiresIn: '-1s' }, // Expired 1 second ago
      );

      await expect(
        service.verifyState(expiredToken, mockProvider),
      ).rejects.toThrow(
        new UnauthorizedException(
          'OAuth login window expired. Please try connecting again.',
        ),
      );
    });
  });
});
