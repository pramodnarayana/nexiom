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
import { EncryptionService, ProviderRegistryService } from '@nexiom/engine';

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

import { Request, Response } from 'express';

describe('OAuthCallbackController', () => {
  let controller: OAuthCallbackController;
  let mockEncryptionService: Mocked<EncryptionService>;
  let mockProviderRegistry: { getProvider: ReturnType<typeof vi.fn> };

  const mockRequest = (
    provider: string,
    session?: Record<string, unknown>,
  ): Partial<Request> =>
    ({
      params: { provider },
      session,
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
      getProvider: vi
        .fn()
        .mockResolvedValue({ id: 'mock-provider-id', enabled: true }),
    };

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
      ],
    }).compile();

    controller = module.get<OAuthCallbackController>(OAuthCallbackController);
    vi.clearAllMocks();
    // Re-apply default: known providers are allowed
    mockProviderRegistry.getProvider.mockResolvedValue({
      id: 'mock-provider-id',
      enabled: true,
    });
  });

  it('should redirect with invalid_provider error if provider is not allowed', async () => {
    mockProviderRegistry.getProvider.mockResolvedValue({
      id: 'test-provider',
      enabled: false,
    });

    const req = mockRequest('unsupported-provider');
    const res = mockResponse();

    await controller.handleCallback(req as Request, res as Response);

    expect(res.redirect).toHaveBeenCalledWith(
      '/app/connections?error=invalid_provider',
    );
  });

  it('should redirect with auth_failed if grant session is missing', async () => {
    const req = mockRequest('salesforce');
    const res = mockResponse();

    await controller.handleCallback(req as Request, res as Response);

    expect(res.redirect).toHaveBeenCalledWith(
      '/app/connections?error=auth_failed',
    );
  });

  it('should redirect with auth_failed if grant response contains error', async () => {
    const req = mockRequest('salesforce', {
      grant: { response: { error: 'invalid_grant' } },
    });
    const res = mockResponse();

    await controller.handleCallback(req as Request, res as Response);

    expect(res.redirect).toHaveBeenCalledWith(
      '/app/connections?error=auth_failed',
    );
  });

  it('should redirect with invalid_state if state is missing', async () => {
    const req = mockRequest('salesforce', {
      grant: { response: { access_token: '123' } }, // No raw.state
    });
    const res = mockResponse();

    await controller.handleCallback(req as Request, res as Response);

    expect(res.redirect).toHaveBeenCalledWith(
      '/app/connections?error=invalid_state',
    );
  });

  it('should redirect with invalid_state if decryption fails', async () => {
    mockEncryptionService.decrypt.mockRejectedValue(
      new Error('Decryption failed'),
    );

    const req = mockRequest('salesforce', {
      grant: { response: { raw: { state: 'bad-encrypted-state' } } },
    });
    const res = mockResponse();

    await controller.handleCallback(req as Request, res as Response);

    expect(res.redirect).toHaveBeenCalledWith(
      '/app/connections?error=invalid_state',
    );
  });

  it('should redirect with invalid_credentials if access_token is missing', async () => {
    mockEncryptionService.decrypt.mockResolvedValue(VALID_TENANT_ID);

    const req = mockRequest('salesforce', {
      grant: {
        response: {
          raw: { state: 'encrypted-state', expires_in: 3600 },
          // No access_token provided
        },
      },
    });
    const res = mockResponse();

    await controller.handleCallback(req as Request, res as Response);

    expect(res.redirect).toHaveBeenCalledWith(
      '/app/connections?error=invalid_credentials',
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(mockEncryptionService.encrypt).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('should successfully store credentials and redirect on success', async () => {
    mockEncryptionService.decrypt.mockResolvedValue(VALID_TENANT_ID);
    mockEncryptionService.encrypt.mockResolvedValue('encrypted-credentials');

    const req = mockRequest('salesforce', {
      grant: {
        response: {
          access_token: 'acc-123',
          refresh_token: 'ref-123',
          raw: {
            state: 'encrypted-state',
            expires_in: 3600,
            realmId: 'realm-id',
          },
        },
      },
    });
    const res = mockResponse();

    await controller.handleCallback(req as Request, res as Response);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(mockEncryptionService.decrypt).toHaveBeenCalledWith(
      'encrypted-state',
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(mockEncryptionService.encrypt).toHaveBeenCalledWith(
      expect.stringContaining('"accessToken":"acc-123"'),
    );
    expect(mockInsert).toHaveBeenCalled();
    // Verify the exact upsert payload
    const rawValue = mockInsert.mock.results[0].value as {
      values: typeof vi.fn;
    };
    const { values } = rawValue;
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: VALID_TENANT_ID,
        providerId: 'mock-provider-id',
        appName: 'salesforce',
        connectionKey: 'realm-id',
        encryptedCredentials: 'encrypted-credentials',
        authType: 'OAUTH2',
      }),
    );
    expect(res.redirect).toHaveBeenCalledWith('/app/connections?success=true');
  });

  it('should redirect with internal_error if database insert fails', async () => {
    mockEncryptionService.decrypt.mockResolvedValue(VALID_TENANT_ID);
    mockEncryptionService.encrypt.mockResolvedValue('encrypted-credentials');

    // Override the mock to simulate failure
    mockOnConflictDoUpdate.mockRejectedValueOnce(new Error('DB Error'));

    const req = mockRequest('salesforce', {
      grant: {
        response: {
          access_token: 'acc-123',
          raw: { state: 'encrypted-state', expires_in: 3600 },
        },
      },
    });
    const res = mockResponse();

    await controller.handleCallback(req as Request, res as Response);

    expect(res.redirect).toHaveBeenCalledWith(
      '/app/connections?error=internal_error',
    );
  });
});
