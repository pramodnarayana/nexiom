import { describe, it, expect, beforeEach, vi, Mocked } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';

import { OAuthCallbackController } from './callback.controller.js';
import { EncryptionService } from '@nexiom/engine';

const { mockOnConflictDoUpdate, mockInsert } = vi.hoisted(() => {
  // Set DATABASE_URL locally so @nexiom/database client.ts doesn't throw
  // during transitive module resolution through @nexiom/engine
  process.env.DATABASE_URL ??= 'postgres://mock:mock@localhost:5432/mock';

  const onConflictDoUpdate = vi.fn().mockResolvedValue(true);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  return { mockOnConflictDoUpdate: onConflictDoUpdate, mockInsert: insert };
});

// Mock the database module — prevents real Pool/Drizzle connections
vi.mock('@nexiom/database', () => ({
  db: {
    insert: mockInsert,
  },
  appConnections: {
    tenantId: 'tenantId',
    appName: 'appName',
  },
}));

import { Request, Response } from 'express';

describe('OAuthCallbackController', () => {
  let controller: OAuthCallbackController;
  let mockEncryptionService: Mocked<EncryptionService>;

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

  beforeEach(async () => {
    mockEncryptionService = {
      encrypt: vi.fn(),
      decrypt: vi.fn(),
      hash: vi.fn(),
      verifyHash: vi.fn(),
    } as unknown as Mocked<EncryptionService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OAuthCallbackController],
      providers: [
        {
          provide: EncryptionService,
          useValue: mockEncryptionService,
        },
      ],
    }).compile();

    controller = module.get<OAuthCallbackController>(OAuthCallbackController);
    vi.clearAllMocks();
  });

  it('should redirect with invalid_provider error if provider is not in ALLOWED_PROVIDERS', async () => {
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

  it('should successfully store credentials and redirect on success', async () => {
    mockEncryptionService.decrypt.mockResolvedValue('tenant-123');
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
    expect(res.redirect).toHaveBeenCalledWith('/app/connections?success=true');
  });

  it('should redirect with internal_error if database insert fails', async () => {
    mockEncryptionService.decrypt.mockResolvedValue('tenant-123');
    mockEncryptionService.encrypt.mockResolvedValue('encrypted-credentials');

    // Override the mock to simulate failure
    mockOnConflictDoUpdate.mockRejectedValueOnce(new Error('DB Error'));

    const req = mockRequest('salesforce', {
      grant: {
        response: {
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
