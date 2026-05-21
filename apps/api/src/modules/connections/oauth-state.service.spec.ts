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
  let redisStore: Map<string, string>;

  beforeEach(async () => {
    redisStore = new Map<string, string>();
    const mockConfigService = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'JWT_SECRET') return 'test-master-secret';
        if (key === 'OAUTH_STATE_SECRET') return undefined; // trigger HMAC branch
        if (key === 'NODE_ENV') return 'test';
        return undefined;
      }),
    };

    const mockRedis = {
      set: vi.fn().mockImplementation((key: string, value: string) => {
        redisStore.set(key, value);
        return Promise.resolve('OK');
      }),
      get: vi.fn().mockImplementation((key: string) => {
        return Promise.resolve(redisStore.get(key) ?? null);
      }),
      getdel: vi.fn().mockImplementation((key: string) => {
        const val = redisStore.get(key) ?? null;
        redisStore.delete(key);
        return Promise.resolve(val);
      }),
      del: vi.fn().mockImplementation((key: string) => {
        redisStore.delete(key);
        return Promise.resolve(1);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OauthStateService,
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: REDIS_CLIENT,
          useValue: mockRedis,
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

      const testStore = new Map<string, string>();
      const explicitRedis = {
        set: vi.fn().mockImplementation((key: string, value: string) => {
          testStore.set(key, value);
          return Promise.resolve('OK');
        }),
        get: vi.fn().mockImplementation((key: string) => {
          return Promise.resolve(testStore.get(key) ?? null);
        }),
        getdel: vi.fn().mockImplementation((key: string) => {
          const val = testStore.get(key) ?? null;
          testStore.delete(key);
          return Promise.resolve(val);
        }),
        del: vi.fn().mockImplementation((key: string) => {
          testStore.delete(key);
          return Promise.resolve(1);
        }),
      };

      const explicitModule = await Test.createTestingModule({
        providers: [
          OauthStateService,
          { provide: ConfigService, useValue: explicitConfigService },
          {
            provide: REDIS_CLIENT,
            useValue: explicitRedis,
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
              useValue: {
                set: vi.fn(),
                get: vi.fn(),
                getdel: vi.fn(),
                del: vi.fn(),
              },
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
      // generateState persists vendorParams (e.g. { realmId }) to Redis
      // keyed by `oauth:state:<stateId>` — they are NOT embedded in the JWT
      // payload itself. jwt.decode(stateToken) therefore will NOT expose
      // vendorParams; callers must call verifyState() which atomically
      // fetches-and-deletes the Redis entry to retrieve them.
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
        metadata: {},
      });
    });

    it('should successfully verify and extract vendorParams and metadata separately', async () => {
      const validToken = await service.generateState(
        mockTenantId,
        mockProvider,
        { realmId: 'test-123' },
        { appProfile: 'custom' },
      );

      const result = await service.verifyState(validToken, mockProvider);
      expect(result).toEqual({
        tenantId: mockTenantId,
        vendorParams: { realmId: 'test-123' },
        metadata: { appProfile: 'custom' },
      });
    });

    it('should be backward-compatible with old state objects stored in Redis', async () => {
      const stateToken = await service.generateState(
        mockTenantId,
        mockProvider,
      );
      const decoded = jwt.decode(stateToken) as jwt.JwtPayload;
      // Simulate legacy state discovery: overwrite the Redis entry created by generateState
      // with an old-format object (vendorParams directly in the value, not wrapped in { vendorParams, metadata })
      // to verify that verifyState() handles pre-migration state tokens correctly.
      redisStore.set(
        `oauth:state:${decoded.stateId}`,
        JSON.stringify({ realmId: 'old-123' }),
      );

      const result = await service.verifyState(stateToken, mockProvider);
      expect(result).toEqual({
        tenantId: mockTenantId,
        vendorParams: { realmId: 'old-123' },
        metadata: undefined,
      });
    });

    it('should throw UnauthorizedException on second use of the same state token (anti-replay)', async () => {
      const validToken = await service.generateState(
        mockTenantId,
        mockProvider,
      );

      // First verification succeeds
      const firstResult = await service.verifyState(validToken, mockProvider);
      expect(firstResult.tenantId).toBe(mockTenantId);

      // Second verification fails because getdel has consumed the token
      await expect(
        service.verifyState(validToken, mockProvider),
      ).rejects.toThrow(
        new UnauthorizedException(
          'OAuth login window expired or state already consumed',
        ),
      );
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
