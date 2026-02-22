import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OauthStateService } from './oauth-state.service';
import { UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

describe('OauthStateService', () => {
  let service: OauthStateService;
  const mockTenantId = 'tenant-123';
  const mockProvider = 'salesforce';

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
      ],
    }).compile();

    service = module.get<OauthStateService>(OauthStateService);
  });

  describe('generateState', () => {
    it('should generate a valid JWT containing the tenantId and provider', () => {
      const stateToken = service.generateState(mockTenantId, mockProvider);

      expect(typeof stateToken).toBe('string');
      expect(stateToken.split('.').length).toBe(3); // Header.Payload.Signature

      // We can manually decode to verify contents without verifying signature
      const decoded = jwt.decode(stateToken) as jwt.JwtPayload;
      expect(decoded.tenantId).toBe(mockTenantId);
      expect(decoded.provider).toBe(mockProvider);
      expect(decoded.purpose).toBe('oauth_state_handshake');
      expect(decoded.exp).toBeDefined();
    });
  });

  describe('verifyState', () => {
    it('should successfully verify and extract a valid state token', () => {
      const validToken = service.generateState(mockTenantId, mockProvider);

      const result = service.verifyState(validToken, mockProvider);
      expect(result).toEqual({ tenantId: mockTenantId });
    });

    it('should throw UnauthorizedException if token is completely missing', () => {
      expect(() => service.verifyState('', mockProvider)).toThrow(
        UnauthorizedException,
      );
      expect(() =>
        service.verifyState(undefined as unknown as string, mockProvider),
      ).toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if the provider does not match the token payload', () => {
      const validToken = service.generateState(mockTenantId, mockProvider);

      expect(() => service.verifyState(validToken, 'hubspot')).toThrow(
        new UnauthorizedException('OAuth state provider mismatch'),
      );
    });

    it('should throw UnauthorizedException if the purpose is incorrect', () => {
      // Simulate an internal attacker signing a generic JWT from somewhere else in the app
      const maliciousToken = jwt.sign(
        {
          tenantId: mockTenantId,
          provider: mockProvider,
          purpose: 'something_else',
        },
        (service as unknown as { jwtSecret: string }).jwtSecret,
      );

      expect(() => service.verifyState(maliciousToken, mockProvider)).toThrow(
        new UnauthorizedException('Invalid OAuth state purpose'),
      );
    });

    it('should throw UnauthorizedException if the token is tampered with (invalid signature)', () => {
      const validToken = service.generateState(mockTenantId, mockProvider);
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

      expect(() => service.verifyState(forgedToken, mockProvider)).toThrow(
        new UnauthorizedException(
          'Invalid OAuth state. Potential CSRF detected.',
        ),
      );
    });

    it('should throw UnauthorizedException pointing to expiration if the JWT is expired', () => {
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

      expect(() => service.verifyState(expiredToken, mockProvider)).toThrow(
        new UnauthorizedException(
          'OAuth login window expired. Please try connecting again.',
        ),
      );
    });
  });
});
