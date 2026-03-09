import { DefaultOAuthRefreshClient } from './token-refresh.service.js';
import { EncryptionService, OAuthRefreshError } from '@nexiom/connectors';
import { PieceRegistryService } from '../../trigger/piece-registry.service.js';
import type { Piece } from '@nexiom/connectors/framework';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mocked,
  type Mock,
} from 'vitest';

const MOCK_OAUTH2_PIECE = {
  name: 'mock-oauth2',
  displayName: 'Mock OAuth2',
  description: 'Mock integration',
  logoUrl: '',
  categories: [],
  auth: {
    type: 'OAUTH2',
    authUrl: 'https://mock.com/auth',
    tokenUrl: 'https://mock.com/token',
    scope: ['mock:scope'],
  },
} as unknown as Piece;

describe('DefaultOAuthRefreshClient', () => {
  let client: DefaultOAuthRefreshClient;
  let mockPieceRegistry: Mocked<Partial<PieceRegistryService>>;
  let mockEncryptionService: { encrypt: Mock; decrypt: Mock };
  let mockDb: {
    select: Mock;
    from: Mock;
    where: Mock;
    orderBy: Mock;
    limit: Mock;
  };

  const encryptedValueBlob = 'encrypted-value-payload';
  const decryptedValueBlob = JSON.stringify({
    clientId: 'mock-client-id',
    clientSecret: 'mock-client-secret',
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    data: {},
  });

  beforeEach(() => {
    mockPieceRegistry = { getPiece: vi.fn() };

    mockEncryptionService = {
      encrypt: vi.fn(),
      decrypt: vi.fn().mockResolvedValue(decryptedValueBlob),
    };

    // Chain: db.select().from().where().limit() -> returns [{value}]
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ value: encryptedValueBlob }]),
    };

    client = new DefaultOAuthRefreshClient(
      mockPieceRegistry as PieceRegistryService,
      mockDb as unknown as import('@nexiom/database').DrizzleDb,
      mockEncryptionService as unknown as EncryptionService,
    );

    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('should throw an error if the provider is not found in the registry', async () => {
    (mockPieceRegistry.getPiece as Mock).mockReturnValue(undefined);
    await expect(
      client.refresh('testTenant', 'unknown_app', 'test-ext', 'refresh123'),
    ).rejects.toThrow('Provider not found for refresh: unknown_app');
  });

  it('should throw an error if the provider lacks a tokenUrl', async () => {
    (mockPieceRegistry.getPiece as Mock).mockReturnValue({
      ...MOCK_OAUTH2_PIECE,
      auth: { ...MOCK_OAUTH2_PIECE.auth, tokenUrl: '' },
    } as unknown as Piece);

    await expect(
      client.refresh('testTenant', 'mock-oauth2', 'test-ext', 'refresh123'),
    ).rejects.toThrow(
      'Provider mock-oauth2 does not support OAuth refresh or lacks a token url',
    );
  });

  it('should successfully call the vendor token URL and return the new token payload', async () => {
    (mockPieceRegistry.getPiece as Mock).mockReturnValue(MOCK_OAUTH2_PIECE);

    const mockResponsePayload = {
      access_token: 'new_access',
      refresh_token: 'new_refresh',
      expires_in: 3600,
    };

    (globalThis.fetch as Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponsePayload),
    });

    const result = await client.refresh(
      'testTenant',
      'mock-oauth2',
      'test-ext',
      'old_refresh',
    );

    expect(mockDb.select).toHaveBeenCalled();
    expect(mockEncryptionService.decrypt).toHaveBeenCalledWith(
      encryptedValueBlob,
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://mock.com/token',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('grant_type=refresh_token') as unknown,
      }),
    );
    expect(result).toEqual(mockResponsePayload);
  });

  it('should throw an OAuthRefreshError if no active connection is found', async () => {
    (mockPieceRegistry.getPiece as Mock).mockReturnValue(MOCK_OAUTH2_PIECE);
    mockDb.limit.mockResolvedValue([]); // no connections found

    try {
      await client.refresh(
        'testTenant',
        'mock-oauth2',
        'test-ext',
        'refresh123',
      );
      expect.unreachable('Should have thrown an error');
    } catch (error) {
      expect(error).toBeInstanceOf(OAuthRefreshError);
      expect((error as OAuthRefreshError).status).toBe(500);
      expect((error as OAuthRefreshError).message).toContain(
        'No active connection found',
      );
    }
  });

  it('should throw an OAuthRefreshError if credential decryption fails', async () => {
    (mockPieceRegistry.getPiece as Mock).mockReturnValue(MOCK_OAUTH2_PIECE);
    mockEncryptionService.decrypt.mockRejectedValue(
      new Error('decryption failed'),
    );

    try {
      await client.refresh(
        'testTenant',
        'mock-oauth2',
        'test-ext',
        'refresh123',
      );
      expect.unreachable('Should have thrown an error');
    } catch (error) {
      expect(error).toBeInstanceOf(OAuthRefreshError);
      expect((error as OAuthRefreshError).status).toBe(500);
      expect((error as OAuthRefreshError).message).toContain(
        'decryption failed',
      );
    }
  });

  it('should throw an OAuthRefreshError with status code if the vendor rejects the refresh', async () => {
    (mockPieceRegistry.getPiece as Mock).mockReturnValue(MOCK_OAUTH2_PIECE);

    (globalThis.fetch as Mock).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    await expect(
      client.refresh('testTenant', 'mock-oauth2', 'test-ext', 'bad_refresh'),
    ).rejects.toMatchObject({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      message: expect.stringContaining('OAuth Refresh failed: 401'),
      status: 401,
    } satisfies Partial<OAuthRefreshError>);
  });

  it('should re-wrap unexpected errors as OAuthRefreshError', async () => {
    (mockPieceRegistry.getPiece as Mock).mockReturnValue(MOCK_OAUTH2_PIECE);

    (globalThis.fetch as Mock).mockRejectedValue(new Error('network timeout'));

    await expect(
      client.refresh('testTenant', 'mock-oauth2', 'test-ext', 'old_refresh'),
    ).rejects.toBeInstanceOf(OAuthRefreshError);
  });
});
