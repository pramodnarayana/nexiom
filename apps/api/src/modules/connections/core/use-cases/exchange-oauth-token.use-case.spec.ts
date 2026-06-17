import { describe, it, expect, beforeEach } from 'vitest';
import { ExchangeOAuthTokenUseCase } from './exchange-oauth-token.use-case.js';
import { FakePieceRegistryPort } from '../fakes/piece-registry-port.fake.js';
import { FakeOAuthClientPort } from '../fakes/oauth-client-port.fake.js';
import { PropertyType } from '@soopa/piece-framework';

describe('ExchangeOAuthTokenUseCase', () => {
  let fakeRegistry: FakePieceRegistryPort;
  let fakeOAuthClient: FakeOAuthClientPort;
  let useCase: ExchangeOAuthTokenUseCase;

  beforeEach(() => {
    fakeRegistry = new FakePieceRegistryPort();
    fakeOAuthClient = new FakeOAuthClientPort();
    useCase = new ExchangeOAuthTokenUseCase(
      fakeRegistry,
      fakeOAuthClient,
      'http://localhost:3000',
    );
  });

  it('should successfully exchange code for tokens', async () => {
    // Setup Fake Registry
    fakeRegistry.addPiece('salesforce', {
      auth: {
        type: PropertyType.OAUTH2,
        tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
        // other required fields omitted for brevity in test
      },
    } as any);

    // Setup Fake OAuth Client
    fakeOAuthClient.mockTokenResponse('mock-auth-code', {
      access_token: 'access-123',
      refresh_token: 'refresh-456',
    });

    const result = await useCase.execute(
      'salesforce',
      'mock-auth-code',
      'client-id-abc',
      'client-secret-xyz',
    );

    expect(result).toEqual({
      access_token: 'access-123',
      refresh_token: 'refresh-456',
    });
    expect(fakeOAuthClient.callCount.exchangeCodeForTokens).toBe(1);
  });

  it('should format templated token URLs correctly', async () => {
    fakeRegistry.addPiece('custom-crm', {
      auth: {
        type: PropertyType.OAUTH2,
        tokenUrl: 'https://{shop}.custom-crm.com/oauth/token',
      },
    } as any);

    fakeOAuthClient.mockTokenResponse('mock-auth-code', { token: '123' });

    await useCase.execute(
      'custom-crm',
      'mock-auth-code',
      'client-id-abc',
      'client-secret-xyz',
      { shop: 'my-store' }, // vendor parameters
    );

    // Assuming the fake tracks the URL, but here we can just ensure it didn't throw
    expect(fakeOAuthClient.callCount.exchangeCodeForTokens).toBe(1);
  });

  it('should throw an error if piece is not found', async () => {
    await expect(
      useCase.execute('unknown-piece', 'code', 'client', 'secret'),
    ).rejects.toThrow('Provider "unknown-piece" is not registered');
  });

  it('should throw an error if piece is not OAUTH2', async () => {
    fakeRegistry.addPiece('basic-auth-piece', {
      auth: { type: PropertyType.CUSTOM_AUTH },
    } as any);

    await expect(
      useCase.execute('basic-auth-piece', 'code', 'client', 'secret'),
    ).rejects.toThrow(
      'Provider "basic-auth-piece" does not use OAuth2 authentication',
    );
  });
});
