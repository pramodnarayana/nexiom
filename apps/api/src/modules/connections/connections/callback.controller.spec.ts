/* eslint-disable @typescript-eslint/unbound-method */
import {
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterAll,
  vi,
  Mocked,
} from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';

import { OAuthCallbackController } from './callback.controller.js';
import {
  EncryptionService,
  ProviderRegistryService,
} from '@nexiom/connections';
import { ConnectorsService } from '../connectors.service';
import { OauthStateService } from '../oauth-state.service';
import { Request, Response } from 'express';

const VALID_TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';

const { mockOnConflictDoUpdate, mockInsert, mockDb } = vi.hoisted(() => {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(true);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  return {
    mockOnConflictDoUpdate: onConflictDoUpdate,
    mockInsert: insert,
    mockDb: { insert },
  };
});

// Mock the database module — prevents real Pool/Drizzle connections
vi.mock('@nexiom/database', () => ({
  appConnections: {
    tenantId: 'tenantId',
    appName: 'appName',
    connectionKey: 'connectionKey',
  },
}));

describe('OAuthCallbackController', () => {
  type ProviderResult = Awaited<
    ReturnType<ProviderRegistryService['getProvider']>
  >;
  let controller: OAuthCallbackController;
  let mockEncryptionService: Mocked<EncryptionService>;
  let mockProviderRegistry: Mocked<ProviderRegistryService>;
  let mockConnectorsService: Mocked<ConnectorsService>;
  let mockOauthStateService: Mocked<OauthStateService>;

  const mockRequest = (
    provider: string,
    query: Record<string, string> = {},
  ): Partial<Request> =>
    ({
      params: { provider },
      query,
    }) as unknown as Partial<Request>;

  const mockResponse = (): Partial<Response> => {
    const res: Partial<Response> = {};
    res.redirect = vi.fn().mockReturnValue(res);
    return res;
  };

  let originalDatabaseUrl: string | undefined;

  beforeAll(() => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://mock:mock@localhost:5432/mock';
  });

  afterAll(() => {
    if (originalDatabaseUrl) {
      process.env.DATABASE_URL = originalDatabaseUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  beforeEach(async () => {
    mockEncryptionService = {
      encrypt: vi.fn(),
      decrypt: vi.fn(),
    } as unknown as Mocked<EncryptionService>;

    mockProviderRegistry = {
      getProvider: vi.fn().mockResolvedValue({
        id: 'mock-provider-id',
        enabled: true,
      } as unknown as ProviderResult),
      getAllProviders: vi.fn(),
    } as unknown as Mocked<ProviderRegistryService>;

    mockConnectorsService = {
      exchangeCodeForTokens: vi.fn(),
    } as unknown as Mocked<ConnectorsService>;

    mockOauthStateService = {
      verifyState: vi.fn(),
    } as unknown as Mocked<OauthStateService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OAuthCallbackController],
      providers: [
        {
          provide: 'DRIZZLE_DB',
          useValue: mockDb,
        },
        {
          provide: EncryptionService,
          useValue: mockEncryptionService,
        },
        {
          provide: ProviderRegistryService,
          useValue: mockProviderRegistry,
        },
        {
          provide: ConnectorsService,
          useValue: mockConnectorsService,
        },
        {
          provide: OauthStateService,
          useValue: mockOauthStateService,
        },
      ],
    }).compile();

    controller = module.get<OAuthCallbackController>(OAuthCallbackController);
    vi.clearAllMocks();
  });

  it('should redirect with invalid_provider error if provider is not allowed', async () => {
    mockProviderRegistry.getProvider.mockResolvedValue({
      id: 'test-provider',
      enabled: false,
    } as unknown as ProviderResult);

    const req = mockRequest('unsupported-provider');
    const res = mockResponse();

    await controller.handleCallback(req as Request, res as Response);

    expect(res.redirect).toHaveBeenCalledWith(
      '/app/connections?error=invalid_provider',
    );
  });

  it('should redirect with invalid_provider error if provider is not found', async () => {
    mockProviderRegistry.getProvider.mockResolvedValue(null);

    const req = mockRequest('unknown-provider');
    const res = mockResponse();

    await controller.handleCallback(req as Request, res as Response);

    expect(res.redirect).toHaveBeenCalledWith(
      '/app/connections?error=invalid_provider',
    );
  });

  it('should redirect with internal_error if provider lookup fails', async () => {
    mockProviderRegistry.getProvider.mockRejectedValue(new Error('DB error'));

    const req = mockRequest('salesforce');
    const res = mockResponse();

    await controller.handleCallback(req as Request, res as Response);

    expect(res.redirect).toHaveBeenCalledWith(
      '/app/connections?error=internal_error',
    );
  });

  it('should redirect with auth_failed if vendor returns an error in query params', async () => {
    const req = mockRequest('salesforce', { error: 'access_denied' });
    const res = mockResponse();

    await controller.handleCallback(req as Request, res as Response);

    expect(res.redirect).toHaveBeenCalledWith(
      '/app/connections?error=auth_failed',
    );
  });

  it('should redirect with invalid_callback if code or state is missing', async () => {
    const req = mockRequest('salesforce', { code: '123' }); // Missing state
    const res = mockResponse();

    await controller.handleCallback(req as Request, res as Response);

    expect(res.redirect).toHaveBeenCalledWith(
      '/app/connections?error=invalid_callback',
    );
  });

  it('should redirect with invalid_state if JWT state verification fails', async () => {
    mockOauthStateService.verifyState.mockImplementation(() => {
      throw new Error('CSRF exception');
    });

    const req = mockRequest('salesforce', { code: '123', state: 'bad-jwt' });
    const res = mockResponse();

    await controller.handleCallback(req as Request, res as Response);

    expect(res.redirect).toHaveBeenCalledWith(
      '/app/connections?error=invalid_state',
    );
  });

  it('should redirect with internal_error if token exchange fails', async () => {
    mockOauthStateService.verifyState.mockReturnValue({
      tenantId: VALID_TENANT_ID,
    });
    mockConnectorsService.exchangeCodeForTokens.mockRejectedValue(
      new Error('Network error'),
    );

    const req = mockRequest('salesforce', { code: '123', state: 'valid-jwt' });
    const res = mockResponse();

    await controller.handleCallback(req as Request, res as Response);

    expect(res.redirect).toHaveBeenCalledWith(
      '/app/connections?error=internal_error',
    );
  });

  it('should redirect with invalid_credentials if access_token is missing from exchange', async () => {
    mockOauthStateService.verifyState.mockReturnValue({
      tenantId: VALID_TENANT_ID,
    });

    // Simulate successful HTTP call but missing access_token in JSON body
    mockConnectorsService.exchangeCodeForTokens.mockResolvedValue({
      id_token: '123',
    });

    const req = mockRequest('salesforce', { code: '123', state: 'valid-jwt' });
    const res = mockResponse();

    await controller.handleCallback(req as Request, res as Response);

    expect(res.redirect).toHaveBeenCalledWith(
      '/app/connections?error=invalid_credentials',
    );
    expect(mockEncryptionService.encrypt).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('should successfully store credentials and redirect on success', async () => {
    mockOauthStateService.verifyState.mockReturnValue({
      tenantId: VALID_TENANT_ID,
      realmId: 'ext-realm-id',
    });
    mockConnectorsService.exchangeCodeForTokens.mockResolvedValue({
      access_token: 'acc-123',
      refresh_token: 'ref-123',
      expires_in: 3600,
    });
    mockEncryptionService.encrypt.mockResolvedValue('encrypted-credentials');

    const req = mockRequest('salesforce', {
      code: '123',
      state: 'valid-jwt',
      realmId: 'ext-realm-id',
    });
    const res = mockResponse();

    await controller.handleCallback(req as Request, res as Response);

    expect(mockOauthStateService.verifyState).toHaveBeenCalledWith(
      'valid-jwt',
      'salesforce',
    );
    expect(mockConnectorsService.exchangeCodeForTokens).toHaveBeenCalledWith(
      'salesforce',
      '123',
    );

    expect(mockEncryptionService.encrypt).toHaveBeenCalledWith(
      expect.stringContaining('"accessToken":"acc-123"'),
    );
    expect(mockEncryptionService.encrypt).toHaveBeenCalledWith(
      expect.stringContaining('"realmId":"ext-realm-id"'),
    );

    expect(mockInsert).toHaveBeenCalled();
    const rawValue = mockInsert.mock.results[0].value as {
      values: typeof vi.fn;
    };
    const { values } = rawValue;

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: VALID_TENANT_ID,
        providerId: 'mock-provider-id',
        appName: 'salesforce',
        connectionKey: 'ext-realm-id',
        encryptedCredentials: 'encrypted-credentials',
        authType: 'OAUTH2',
      }),
    );

    expect(res.redirect).toHaveBeenCalledWith('/app/connections?success=true');
  });

  it('should redirect with internal_error if database insert fails', async () => {
    mockOauthStateService.verifyState.mockReturnValue({
      tenantId: VALID_TENANT_ID,
    });
    mockConnectorsService.exchangeCodeForTokens.mockResolvedValue({
      access_token: 'acc-123',
    });
    mockEncryptionService.encrypt.mockResolvedValue('encrypted-credentials');

    // Override the mock to simulate failure
    mockOnConflictDoUpdate.mockRejectedValueOnce(new Error('DB Error'));

    const req = mockRequest('salesforce', { code: '123', state: 'valid-jwt' });
    const res = mockResponse();

    await controller.handleCallback(req as Request, res as Response);

    expect(res.redirect).toHaveBeenCalledWith(
      '/app/connections?error=internal_error',
    );
  });
});
