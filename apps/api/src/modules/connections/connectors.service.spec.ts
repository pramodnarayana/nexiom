import { Test, TestingModule } from '@nestjs/testing';
import { DATABASE_CONNECTION } from '@soopa/database';
import { ConfigService } from '@nestjs/config';
import { ConnectorsService } from './connectors.service.js';

import { SAVEPOINT_MANAGER } from '@soopa/database';
import { ConnectionLifecycleService } from './connection-lifecycle.service.js';
import { StorageResolverService } from '@soopa/pipeline';

import { EncryptionService, AppCredentialError } from '@soopa/credentials';
import { PieceRegistryService } from '@soopa/piece-registry';
import type { Piece } from '@soopa/piece-framework';
import { DB_MANAGER } from '@soopa/dbmanager';

import {
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  Mocked,
} from 'vitest';

describe('ConnectorsService', () => {
  let service: ConnectorsService;
  let mockPieceRegistry: Mocked<PieceRegistryService>;
  let mockEncryptionService: Mocked<EncryptionService>;
  let mockDbInsert: ReturnType<typeof vi.fn>;
  let mockDbValues: ReturnType<typeof vi.fn>;
  let mockDbUpdate: ReturnType<typeof vi.fn>;
  let mockDb: {
    select: ReturnType<typeof vi.fn>;
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    transaction: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;

    [key: string]: any;
  };

  beforeEach(async () => {
    mockDbValues = vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn(),
      onConflictDoUpdate: vi.fn(),
      returning: vi.fn().mockResolvedValue([{ id: 'mock-uuid' }]),
    });
    mockDbUpdate = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'mock-updated-id' }]),
        }),
      }),
    });
    mockDbInsert = vi.fn().mockReturnValue({
      values: mockDbValues,
      onConflictDoNothing: vi.fn(),
    });
    mockDb = {
      select: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnValue(
        Object.assign(Promise.resolve([]), {
          limit: vi.fn().mockResolvedValue([]),
        }),
      ),
      limit: vi.fn().mockResolvedValue([]),
      update: mockDbUpdate,
      insert: mockDbInsert,
      delete: vi.fn().mockReturnThis(),
      transaction: vi
        .fn()
        .mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
          // Evaluate the inner transaction callback using the main mockDb instance
          return await cb(mockDb);
        }),
      execute: vi.fn().mockResolvedValue(true),
    };

    mockEncryptionService = {
      decrypt: vi.fn().mockResolvedValue('test-client-secret'),
      encrypt: vi.fn(),
    } as unknown as Mocked<EncryptionService>;

    const mockConfigService = {
      get: vi.fn().mockReturnValue('https://tenant.nexiom.app'),
    };

    mockPieceRegistry = {
      getPiece: vi.fn(),
      getAllPieces: vi.fn(),
    } as unknown as Mocked<PieceRegistryService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectorsService,
        { provide: PieceRegistryService, useValue: mockPieceRegistry },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EncryptionService, useValue: mockEncryptionService },
        { provide: DATABASE_CONNECTION, useValue: mockDb as unknown },
        {
          provide: DB_MANAGER,
          useValue: {
            applyPlan: vi.fn(),
            getTenantDb: vi.fn().mockResolvedValue({ execute: vi.fn() }),
          },
        },
        {
          provide: StorageResolverService,
          useValue: { resolveStorageProfile: vi.fn() },
        },
        {
          provide: SAVEPOINT_MANAGER,
          useValue: {
            createSavepoint: vi.fn(),
            releaseSavepoint: vi.fn(),
            rollbackToSavepoint: vi.fn(),
          },
        },
        {
          provide: ConnectionLifecycleService,
          useValue: { provisionNamespace: vi.fn(), teardownNamespace: vi.fn() },
        },
      ],
    }).compile();

    service = module.get<ConnectorsService>(ConnectorsService);
  });

  describe('getAuthorizationUrl', () => {
    it('should throw BadRequestException if providerName fails validation', () => {
      expect(() =>
        service.getAuthorizationUrl(
          'invalid/provider_name!',
          'mocked_jwt_state',
          'test-client-id',
        ),
      ).toThrow(NotFoundException);
    });

    it('should generate a valid OAuth URL with scopes', () => {
      mockPieceRegistry.getPiece.mockReturnValue({
        name: 'mock-piece',
        auth: {
          type: 'OAUTH2',
          authUrl: 'https://login.mock-piece.com/services/oauth2/authorize',
          scope: ['full', 'refresh_token'],
        },
      } as unknown as Piece);

      const result = service.getAuthorizationUrl(
        'mock-piece',
        'random-state-123',
        'test-client-id',
      );

      const url = new URL(result);
      expect(url.origin).toBe('https://login.mock-piece.com');
      expect(url.pathname).toBe('/services/oauth2/authorize');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('client_id')).toBe('test-client-id');
      expect(url.searchParams.get('state')).toBe('random-state-123');
      expect(url.searchParams.get('scope')).toBe('full refresh_token');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://tenant.nexiom.app/api/connect/callback',
      );
    });

    it('should use environment specific authorizeUrl when env parameter is passed and matched', () => {
      mockPieceRegistry.getPiece.mockReturnValue({
        name: 'mock-piece',
        auth: {
          type: 'OAUTH2',
          authUrl:
            'https://{environment}.mock-piece.com/services/oauth2/authorize',
          props: {
            environment: {
              type: 'STATIC_DROPDOWN',
              options: {
                options: [{ label: 'Sandbox', value: 'test' }],
              },
            },
          },
        },
      } as unknown as Piece);

      const result = service.getAuthorizationUrl(
        'mock-piece',
        'random-state-123',
        'test-client-id',
        { environment: 'test' },
      );

      const url = new URL(result);
      expect(url.origin).toBe('https://test.mock-piece.com');
      expect(url.pathname).toBe('/services/oauth2/authorize');
    });

    it('should throw NotFoundException if provider does not exist', () => {
      mockPieceRegistry.getPiece.mockReturnValue(undefined);
      expect(() =>
        service.getAuthorizationUrl('unknown', 'state', 'test-client-id'),
      ).toThrow(NotFoundException);
    });

    it('should throw BadRequestException if clientId is missing', () => {
      mockPieceRegistry.getPiece.mockReturnValue({
        name: 'mock-piece',
        auth: {
          type: 'OAUTH2',
          authUrl: 'https://login.mock-piece.com/services/oauth2/authorize',
        },
      } as unknown as Piece);

      expect(() =>
        service.getAuthorizationUrl('mock-piece', 'state', ''),
      ).toThrow(BadRequestException);
    });

    it('should throw BadRequestException if authType is not OAUTH2', () => {
      mockPieceRegistry.getPiece.mockReturnValue({
        name: 'mock-piece',
        auth: {
          type: 'API_KEY',
          authUrl: 'https://login.mock-piece.com/services/oauth2/authorize',
        },
      } as unknown as Piece);

      expect(() =>
        service.getAuthorizationUrl('mock-piece', 'state', 'test-client-id'),
      ).toThrow(BadRequestException);
    });

    it('should throw InternalServerErrorException if authorizeUrl is missing', () => {
      mockPieceRegistry.getPiece.mockReturnValue({
        name: 'mock-piece',
        auth: {
          type: 'OAUTH2',
        },
      } as unknown as Piece);

      expect(() =>
        service.getAuthorizationUrl('mock-piece', 'state', 'test-client-id'),
      ).toThrow(InternalServerErrorException);
    });
  });

  describe('exchangeCodeForTokens', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should throw BadRequestException if providerName fails validation', async () => {
      await expect(
        service.exchangeCodeForTokens(
          'invalid/provider_name!',
          'auth-code',
          'mock_client_id',
          'mock_client_secret',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if provider does not exist', async () => {
      mockPieceRegistry.getPiece.mockReturnValue(undefined);
      await expect(
        service.exchangeCodeForTokens(
          'unknown',
          'auth-code',
          'mock_client_id',
          'mock_client_secret',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if authType is not OAUTH2', async () => {
      mockPieceRegistry.getPiece.mockReturnValue({
        name: 'mock-piece',
        auth: {
          type: 'API_KEY',
          tokenUrl: 'https://login.mock-piece.com/services/oauth2/token',
        },
      } as unknown as Piece);

      await expect(
        service.exchangeCodeForTokens(
          'mock-piece',
          'auth-code',
          'mock_client_id',
          'mock_client_secret',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw InternalServerErrorException if tokenUrl is missing', async () => {
      mockPieceRegistry.getPiece.mockReturnValue({
        name: 'mock-piece',
        auth: {
          type: 'OAUTH2',
        },
      } as unknown as Piece);

      await expect(
        service.exchangeCodeForTokens(
          'mock-piece',
          'auth-code',
          'mock_client_id',
          'mock_client_secret',
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should successfully exchange a code for tokens', async () => {
      mockPieceRegistry.getPiece.mockReturnValue({
        name: 'mock-piece',
        auth: {
          type: 'OAUTH2',
          tokenUrl: 'https://login.mock-piece.com/services/oauth2/token',
        },
      } as unknown as Piece);

      const mockTokens = { access_token: 'abc', refresh_token: 'def' };
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTokens),
      } as Response);

      const result = await service.exchangeCodeForTokens(
        'mock-piece',
        'auth-code',
        'mock_client_id',
        'mock_client_secret',
      );

      expect(result).toEqual(mockTokens);

      // Validate fetch call payload
      expect(fetch).toHaveBeenCalledWith(
        'https://login.mock-piece.com/services/oauth2/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },

          body: expect.any(String),

          signal: expect.any(AbortSignal),
        },
      );

      const fetchCallArgs = vi.mocked(fetch).mock.calls[0];
      const fetchBody = fetchCallArgs?.[1]?.body as string;
      expect(fetchBody).toContain('grant_type=authorization_code');
      expect(fetchBody).toContain('client_id=mock_client_id');
      expect(fetchBody).toContain('client_secret=mock_client_secret');
    });

    it('should route to environment specific tokenUrl when env is provided and matched', async () => {
      mockPieceRegistry.getPiece.mockReturnValue({
        name: 'mock-piece',
        auth: {
          type: 'OAUTH2',
          tokenUrl:
            'https://{environment}.mock-piece.com/services/oauth2/token',
          props: {
            environment: {
              type: 'STATIC_DROPDOWN',
              options: {
                options: [{ label: 'Sandbox', value: 'test' }],
              },
            },
          },
        },
      } as unknown as Piece);

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: 'abc' }),
      } as Response);

      await service.exchangeCodeForTokens(
        'mock-piece',
        'code',
        'cl_id',
        'cl_secret',
        { environment: 'test' },
      );

      expect(fetch).toHaveBeenCalledWith(
        'https://test.mock-piece.com/services/oauth2/token',
        expect.any(Object),
      );
    });

    it('should invoke validateConnectResponse and throw if validation fails', async () => {
      const mockValidate = vi.fn().mockImplementation(() => {
        throw new AppCredentialError('Validation failed');
      });

      mockPieceRegistry.getPiece.mockReturnValue({
        name: 'mock-piece',
        auth: {
          type: 'OAUTH2',
          tokenUrl: 'https://login.mock-piece.com/services/oauth2/token',
          validateConnectResponse: mockValidate,
        },
      } as unknown as Piece);

      const mockTokens = { access_token: 'abc' };
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTokens),
      } as Response);

      await expect(
        service.exchangeCodeForTokens(
          'mock-piece',
          'auth-code',
          'mock_client_id',
          'mock_client_secret',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockValidate).toHaveBeenCalledWith(mockTokens);
    });

    it('should throw BadRequestException if the token exchange fails with a HTTP 400', async () => {
      mockPieceRegistry.getPiece.mockReturnValue({
        name: 'mock-piece',
        auth: {
          type: 'OAUTH2',
          tokenUrl: 'https://login.mock-piece.com/services/oauth2/token',
        },
      } as unknown as Piece);

      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('invalid_client'),
      } as Response);

      await expect(
        service.exchangeCodeForTokens(
          'mock-piece',
          'bad-code',
          'mock_client_id',
          'mock_client_secret',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw InternalServerErrorException if the token exchange fails with a HTTP 500', async () => {
      mockPieceRegistry.getPiece.mockReturnValue({
        name: 'mock-piece',
        auth: {
          type: 'OAUTH2',
          tokenUrl: 'https://login.mock-piece.com/services/oauth2/token',
        },
      } as unknown as Piece);

      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('internal server error'),
      } as Response);

      await expect(
        service.exchangeCodeForTokens(
          'mock-piece',
          'bad-code',
          'mock_client_id',
          'mock_client_secret',
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw InternalServerErrorException on network errors', async () => {
      mockPieceRegistry.getPiece.mockReturnValue({
        name: 'mock-piece',
        auth: {
          type: 'OAUTH2',
          tokenUrl: 'https://login.mock-piece.com/services/oauth2/token',
        },
      } as unknown as Piece);

      vi.mocked(fetch).mockRejectedValue(new Error('network unreachable'));

      await expect(
        service.exchangeCodeForTokens(
          'mock-piece',
          'timeout-code',
          'mock_client_id',
          'mock_client_secret',
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw InternalServerErrorException specifically for timeouts (AbortError)', async () => {
      mockPieceRegistry.getPiece.mockReturnValue({
        name: 'mock-piece',
        auth: {
          type: 'OAUTH2',
          tokenUrl: 'https://login.mock-piece.com/services/oauth2/token',
        },
      } as unknown as Piece);

      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      vi.mocked(fetch).mockRejectedValue(abortError);

      await expect(
        service.exchangeCodeForTokens(
          'mock-piece',
          'timeout-code',
          'mock_client_id',
          'mock_client_secret',
        ),
      ).rejects.toThrow('Token exchange timed out after 10s for mock-piece');
    });
  });

  describe('storeOAuthConnection', () => {
    it('should insert a single connection row on the happy path', async () => {
      // Mock the returning closure for Drizzle
      mockDbInsert.mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'mock-uuid-conn-id' }]),
        }),
      });
      // Mock the conflict check (no existing rows)
      mockDb.where = vi.fn().mockReturnValue(
        Object.assign(Promise.resolve([]), {
          limit: vi.fn().mockResolvedValue([]),
        }),
      );

      await service.storeOAuthConnection({
        tenantId: 'tenant-123',
        providerName: 'mock-piece',
        externalId: 'mock-piece-tms',
        displayName: 'TMS MockPiece',
        authType: 'OAUTH2',
        value: 'encrypted-value-blob',
        expiresAt: new Date(),
        metadata: { env: 'sandbox' },
      });

      expect(mockDbInsert).toHaveBeenCalledTimes(3);

      const dsCall = vi.mocked(mockDbInsert).mock.results[0]?.value;

      const dsValues = dsCall.values.mock.calls[0]?.[0] as Record<
        string,
        unknown
      >;

      const credsCall = vi.mocked(mockDbInsert).mock.results[1]?.value;

      const credsValues = credsCall.values.mock.calls[0]?.[0] as Record<
        string,
        unknown
      >;

      expect(dsValues).toMatchObject({
        tenantId: 'tenant-123',
        appName: 'mock-piece',
        externalId: 'mock-piece-tms',
        displayName: 'TMS MockPiece',
        metadata: { env: 'sandbox' },
      });

      expect(credsValues).toMatchObject({
        authType: 'OAUTH2',
        value: 'encrypted-value-blob',
      });

      // Expect lifecycleService.provisionNamespace to be called
      const { provisionNamespace } = service['lifecycleService'] as unknown as {
        provisionNamespace: ReturnType<typeof vi.fn>;
      };
      expect(provisionNamespace).toHaveBeenCalledWith(
        'tenant-123',
        expect.objectContaining({
          dataSourceId: 'mock-uuid-conn-id',
          createdAppConnection: true,
        }),
        'mock-piece',
        { env: 'sandbox' },
      );
    });

    it('should throw InternalServerErrorException if connection ID is missing after insert', async () => {
      // Return empty array from returning()
      mockDbInsert.mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      });
      mockDb.where = vi.fn().mockReturnValue(
        Object.assign(Promise.resolve([]), {
          limit: vi.fn().mockResolvedValue([]),
        }),
      );

      await expect(
        service.storeOAuthConnection({
          tenantId: 'tenant-123',
          providerName: 'mock-piece',
          externalId: 'mock-piece-tms',
          displayName: 'TMS MockPiece',
          authType: 'OAUTH2',
          value: 'encrypted-value-blob',
          expiresAt: new Date(),
          metadata: { env: 'sandbox' },
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should update an existing connection explicitly using an ID', async () => {
      await service.storeOAuthConnection({
        id: 'mock-updated-id',
        tenantId: 'tenant-123',
        providerName: 'mock-piece',
        externalId: 'mock-piece-tms',
        displayName: 'TMS MockPiece',
        authType: 'OAUTH2',
        value: 'encrypted-value-blob',
        expiresAt: new Date(),
        metadata: { env: 'sandbox' },
      });
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDbInsert).toHaveBeenCalledTimes(2); // credentials and outbox
    });

    it('should throw InternalServerErrorException if nodeEnv is production and regionContext is missing', async () => {
      const configGet = vi.spyOn(service['configService'], 'get');
      configGet.mockImplementation((key: string) => {
        if (key === 'DEFAULT_REGION_CONTEXT') return undefined;
        if (key === 'NODE_ENV') return 'production';
        return undefined;
      });

      await expect(
        service.storeOAuthConnection({
          tenantId: 'tenant-123',
          providerName: 'mock-piece',
          externalId: 'mock-piece-tms',
          displayName: 'TMS MockPiece',
          authType: 'OAUTH2',
          value: 'encrypted-value-blob',
          expiresAt: new Date(),
          metadata: {},
        }),
      ).rejects.toThrow(InternalServerErrorException);
      configGet.mockRestore();
    });
    it('should throw HttpException 409 on displayName conflict when updating', async () => {
      mockDbUpdate.mockReturnValueOnce({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockRejectedValue(
              Object.assign(
                new Error('duplicate key value violates unique constraint'),
                {
                  code: '23505',
                  constraint: 'ds_tenant_app_display_name_lower_idx',
                },
              ),
            ),
          }),
        }),
      });
      await expect(
        service.storeOAuthConnection({
          id: 'mock-updated-id',
          tenantId: 'tenant-123',
          providerName: 'mock-piece',
          externalId: 'mock-piece-tms',
          displayName: 'TMS MockPiece',
          authType: 'OAUTH2',
          value: 'encrypted-value-blob',
          expiresAt: new Date(),
          metadata: { env: 'sandbox' },
        }),
      ).rejects.toThrow(HttpException);
    });
    it('should throw HttpException 409 on externalId collision tenant-wide when updating', async () => {
      mockDbUpdate.mockReturnValueOnce({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockRejectedValue(
              Object.assign(
                new Error('duplicate key value violates unique constraint'),
                {
                  code: '23505',
                  constraint: 'ds_tenant_external_id_idx',
                },
              ),
            ),
          }),
        }),
      });
      await expect(
        service.storeOAuthConnection({
          id: 'mock-updated-id',
          tenantId: 'tenant-123',
          providerName: 'mock-piece',
          externalId: 'mock-piece-tms',
          displayName: 'TMS MockPiece Renamed',
          authType: 'OAUTH2',
          value: 'encrypted-value-blob',
          expiresAt: new Date(),
          metadata: { env: 'sandbox' },
        }),
      ).rejects.toThrow(HttpException);
    });
    it('should throw NotFoundException when the explicit update target does not exist', async () => {
      mockDbUpdate.mockReturnValueOnce({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      });
      await expect(
        service.storeOAuthConnection({
          id: 'missing-id',
          tenantId: 'tenant-123',
          providerName: 'mock-piece',
          externalId: 'mock-piece-tms',
          displayName: 'TMS MockPiece',
          authType: 'OAUTH2',
          value: 'encrypted-value-blob',
          expiresAt: new Date(),
          metadata: { env: 'sandbox' },
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw HttpException 409 if a connection with the same displayName exists', async () => {
      mockDbInsert.mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockRejectedValue(
            Object.assign(new Error('Unique violation'), {
              code: '23505',
              constraint: 'ds_tenant_app_display_name_lower_idx',
            }),
          ),
        }),
      });

      await expect(
        service.storeOAuthConnection({
          tenantId: 'tenant-123',
          providerName: 'mock-piece',
          externalId: 'mock-piece-tms',
          displayName: 'TMS MockPiece',
          authType: 'OAUTH2',
          value: 'encrypted-value-blob',
          expiresAt: new Date(),
          metadata: { env: 'sandbox' },
        }),
      ).rejects.toThrow(HttpException);
    });

    it('should throw HttpException 409 if externalId collision exists tenant-wide', async () => {
      mockDbInsert.mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockRejectedValue(
            Object.assign(new Error('Unique violation'), {
              code: '23505',
              constraint: 'ds_tenant_external_id_idx',
            }),
          ),
        }),
      });

      await expect(
        service.storeOAuthConnection({
          tenantId: 'tenant-123',
          providerName: 'mock-piece',
          externalId: 'tms-mockpiece',
          displayName: 'TMS  MockPiece', // different display name, same externalId
          authType: 'OAUTH2',
          value: 'encrypted-value-blob',
          expiresAt: new Date(),
          metadata: { env: 'sandbox' },
        }),
      ).rejects.toThrow(HttpException);
    });

    it('should treat unrecognized unique constraints as 409 Conflict', async () => {
      mockDbInsert.mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockRejectedValue(
            Object.assign(new Error('Unique violation'), {
              code: '23505',
              constraint: 'some_unknown_constraint',
            }),
          ),
        }),
      });

      await expect(
        service.storeOAuthConnection({
          tenantId: 'tenant-123',
          providerName: 'mock-piece',
          externalId: 'mock-piece-tms',
          displayName: 'TMS MockPiece',
          authType: 'OAUTH2',
          value: 'encrypted-value-blob',
          expiresAt: new Date(),
          metadata: { env: 'sandbox' },
        }),
      ).rejects.toThrow('A connection with these details already exists.');
    });

    it('should recover a FAILED connection when displayName collides', async () => {
      mockDbInsert.mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockRejectedValue(
            Object.assign(new Error('Unique violation'), {
              code: '23505',
              constraint: 'ds_tenant_app_display_name_lower_idx',
            }),
          ),
        }),
      });

      // Mock select to return existing FAILED connection for the first query, and empty for the cross-check
      mockDb.where = vi
        .fn()
        .mockReturnValueOnce({
          limit: vi
            .fn()
            .mockResolvedValue([{ id: 'failed-conn-1', status: 'FAILED' }]),
        }) // main query
        .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) }); // cross-check query

      mockDbUpdate.mockReturnValueOnce({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'failed-conn-1' }]),
          }),
        }),
      });

      await service.storeOAuthConnection({
        tenantId: 'tenant-123',
        providerName: 'mock-piece',
        externalId: 'mock-piece-tms',
        displayName: 'TMS MockPiece',
        authType: 'OAUTH2',
        value: 'encrypted-value-blob',
        expiresAt: new Date(),
        metadata: {},
      });

      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should recover a FAILED connection when externalId collides', async () => {
      mockDbInsert.mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockRejectedValue(
            Object.assign(new Error('Unique violation'), {
              code: '23505',
              constraint: 'ds_tenant_external_id_idx',
            }),
          ),
        }),
      });

      // Mock select to return existing FAILED connection for the first query, and empty for the cross-check
      mockDb.where = vi
        .fn()
        .mockReturnValueOnce({
          limit: vi
            .fn()
            .mockResolvedValue([{ id: 'failed-conn-2', status: 'FAILED' }]),
        }) // main query
        .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) }); // cross-check query

      mockDbUpdate.mockReturnValueOnce({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'failed-conn-2' }]),
          }),
        }),
      });

      await service.storeOAuthConnection({
        tenantId: 'tenant-123',
        providerName: 'mock-piece',
        externalId: 'mock-piece-tms',
        displayName: 'TMS MockPiece',
        authType: 'OAUTH2',
        value: 'encrypted-value-blob',
        expiresAt: new Date(),
        metadata: {},
      });

      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should reject FAILED recovery if displayName collides but externalId is taken by a DIFFERENT connection', async () => {
      mockDbInsert.mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockRejectedValue(
            Object.assign(new Error('Unique violation'), {
              code: '23505',
              constraint: 'ds_tenant_app_display_name_lower_idx',
            }),
          ),
        }),
      });

      // Cross check returns a DIFFERENT id, so it clears existingFailed and hits throwOnDuplicateConnection
      mockDb.where = vi
        .fn()
        .mockReturnValueOnce({
          limit: vi
            .fn()
            .mockResolvedValue([{ id: 'failed-conn-1', status: 'FAILED' }]),
        }) // main query
        .mockReturnValueOnce({
          limit: vi.fn().mockResolvedValue([{ id: 'different-conn' }]),
        }); // cross-check query

      await expect(
        service.storeOAuthConnection({
          tenantId: 'tenant-123',
          providerName: 'mock-piece',
          externalId: 'mock-piece-tms',
          displayName: 'TMS MockPiece',
          authType: 'OAUTH2',
          value: 'encrypted-value-blob',
          expiresAt: new Date(),
          metadata: {},
        }),
      ).rejects.toThrow(HttpException);
    });

    it('should reject FAILED recovery if externalId collides but displayName is taken by a DIFFERENT connection', async () => {
      mockDbInsert.mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockRejectedValue(
            Object.assign(new Error('Unique violation'), {
              code: '23505',
              constraint: 'ds_tenant_external_id_idx',
            }),
          ),
        }),
      });

      // Cross check returns a DIFFERENT id, so it clears existingFailed and hits throwOnDuplicateConnection
      mockDb.where = vi
        .fn()
        .mockReturnValueOnce({
          limit: vi
            .fn()
            .mockResolvedValue([{ id: 'failed-conn-2', status: 'FAILED' }]),
        }) // main query
        .mockReturnValueOnce({
          limit: vi.fn().mockResolvedValue([{ id: 'different-conn' }]),
        }); // cross-check query

      await expect(
        service.storeOAuthConnection({
          tenantId: 'tenant-123',
          providerName: 'mock-piece',
          externalId: 'mock-piece-tms',
          displayName: 'TMS MockPiece',
          authType: 'OAUTH2',
          value: 'encrypted-value-blob',
          expiresAt: new Date(),
          metadata: {},
        }),
      ).rejects.toThrow(HttpException);
    });

    it('should throw InternalServerErrorException and abort if dataSource insert fails', async () => {
      mockDb.where = vi.fn().mockReturnValue(
        Object.assign(Promise.resolve([]), {
          limit: vi.fn().mockResolvedValue([]),
        }),
      );
      mockDbInsert.mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi
            .fn()
            .mockRejectedValue(new Error('dataSource DB write failed')),
        }),
      });

      await expect(
        service.storeOAuthConnection({
          tenantId: 'tenant-123',
          providerName: 'mock-piece',
          externalId: 'mock-piece-tms',
          displayName: 'TMS MockPiece',
          authType: 'OAUTH2',
          value: 'encrypted-value-blob',
          expiresAt: new Date(),
          metadata: { env: 'sandbox' },
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('deleteConnection', () => {
    it('should delegate to lifecycleService.teardownNamespace', async () => {
      const { teardownNamespace } = service['lifecycleService'] as unknown as {
        teardownNamespace: ReturnType<typeof vi.fn>;
      };

      await service.deleteConnection('tenant-123', 'ds-1');
      expect(teardownNamespace).toHaveBeenCalledWith('tenant-123', 'ds-1');
    });
  });
});
