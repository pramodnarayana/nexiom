import { Test, TestingModule } from '@nestjs/testing';
import { OAuthCallbackController } from './callback.controller';
import { ProviderRegistryService } from '@nexiom/connections';
import { Request, Response } from 'express';
import { vi, describe, it, expect, beforeEach, Mocked } from 'vitest';
import { OauthStateService } from '../oauth-state.service';

const VALID_TENANT_ID = 'test-tenant-123';

function mockRequest(query: Record<string, string | string[]> = {}) {
  return {
    query,
  };
}

const mockResponse = () => ({
  redirect: vi.fn(),
  setHeader: vi.fn(),
  send: vi.fn(),
});

function expectPopupMessage(
  res: ReturnType<typeof mockResponse>,
  expectedPayload: Record<string, unknown>,
) {
  expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html');
  expect(res.send).toHaveBeenCalledWith(
    expect.stringContaining(JSON.stringify(expectedPayload)),
  );
  expect(res.send).toHaveBeenCalledWith(
    expect.stringContaining('window.opener.postMessage'),
  );
}

describe('OAuthCallbackController', () => {
  let controller: OAuthCallbackController;
  let mockProviderRegistry: Mocked<ProviderRegistryService>;
  let mockOauthStateService: Mocked<OauthStateService>;

  beforeEach(async () => {
    mockProviderRegistry = {
      getProvider: vi.fn().mockReturnValue({
        name: 'salesforce',
        displayName: 'Salesforce',
        description: 'CRM',
        logoUrl: '',
        category: 'CRM',
        authType: 'OAUTH2',
        authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
        tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
        scopes: ['api'],
      } as any),
      getAllProviders: vi.fn(),
    } as unknown as Mocked<ProviderRegistryService>;

    mockOauthStateService = {
      extractProviderFromState: vi.fn(),
      verifyState: vi.fn(),
    } as unknown as Mocked<OauthStateService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OAuthCallbackController],
      providers: [
        {
          provide: ProviderRegistryService,
          useValue: mockProviderRegistry,
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

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should send error popup with invalid_provider if provider name is malformed', () => {
    mockOauthStateService.extractProviderFromState.mockReturnValue(
      'invalid provider!',
    );
    const req = mockRequest({ state: 'valid-jwt' });
    const res = mockResponse();

    controller.handleCallback(
      req as unknown as Request,
      res as unknown as Response,
    );
    expectPopupMessage(res, { status: 'error', error: 'invalid_provider' });
  });

  it('should send error popup with invalid_provider if provider is unsupported', () => {
    mockOauthStateService.extractProviderFromState.mockReturnValue(
      'unknown-provider',
    );
    mockProviderRegistry.getProvider.mockReturnValue(null);
    const req = mockRequest({ state: 'valid-jwt' });
    const res = mockResponse();

    controller.handleCallback(
      req as unknown as Request,
      res as unknown as Response,
    );
    expectPopupMessage(res, { status: 'error', error: 'invalid_provider' });
  });

  it('should send error popup with internal_error if provider lookup fails', () => {
    mockOauthStateService.extractProviderFromState.mockReturnValue(
      'salesforce',
    );
    mockProviderRegistry.getProvider.mockImplementation(() => {
      throw new Error('Unexpected registry error');
    });

    const req = mockRequest({ state: 'valid-jwt' });
    const res = mockResponse();

    controller.handleCallback(
      req as unknown as Request,
      res as unknown as Response,
    );
    expectPopupMessage(res, { status: 'error', error: 'internal_error' });
  });

  it('should send error popup with auth_failed if vendor returns an error in query', () => {
    mockOauthStateService.extractProviderFromState.mockReturnValue(
      'salesforce',
    );
    const req = mockRequest({ state: 'valid-jwt', error: 'access_denied' });
    const res = mockResponse();

    controller.handleCallback(
      req as unknown as Request,
      res as unknown as Response,
    );
    expectPopupMessage(res, { status: 'error', error: 'auth_failed' });
  });

  it('should send error popup with missing_state if state is missing', () => {
    const req = mockRequest({ code: '123' }); // Missing state
    const res = mockResponse();

    controller.handleCallback(
      req as unknown as Request,
      res as unknown as Response,
    );
    expectPopupMessage(res, { status: 'error', error: 'missing_state' });
  });

  it('should send error popup with invalid_callback if code is missing', () => {
    mockOauthStateService.extractProviderFromState.mockReturnValue(
      'salesforce',
    );
    const req = mockRequest({ state: 'valid-jwt' }); // Missing code
    const res = mockResponse();

    controller.handleCallback(
      req as unknown as Request,
      res as unknown as Response,
    );
    expectPopupMessage(res, { status: 'error', error: 'invalid_callback' });
  });

  it('should send error popup with invalid_state if JWT state verification fails', () => {
    mockOauthStateService.extractProviderFromState.mockReturnValue(
      'salesforce',
    );
    mockOauthStateService.verifyState.mockImplementation(() => {
      throw new Error('CSRF exception');
    });

    const req = mockRequest({ code: '123', state: 'bad-jwt' });
    const res = mockResponse();

    controller.handleCallback(
      req as unknown as Request,
      res as unknown as Response,
    );
    expectPopupMessage(res, { status: 'error', error: 'invalid_state' });
  });

  it('should send error popup with invalid_state if realmId mismatch occurs', () => {
    mockOauthStateService.extractProviderFromState.mockReturnValue(
      'salesforce',
    );
    mockOauthStateService.verifyState.mockReturnValue({
      tenantId: VALID_TENANT_ID,
      realmId: 'db-realm-id',
    });

    const req = mockRequest({
      code: '123',
      state: 'valid-jwt',
      realmId: 'different-realm-id',
    });
    const res = mockResponse();

    controller.handleCallback(
      req as unknown as Request,
      res as unknown as Response,
    );
    expectPopupMessage(res, { status: 'error', error: 'invalid_state' });
  });

  it('should successfully send success popup with code and provider', () => {
    mockOauthStateService.extractProviderFromState.mockReturnValue(
      'salesforce',
    );
    mockOauthStateService.verifyState.mockReturnValue({
      tenantId: VALID_TENANT_ID,
      realmId: 'ext-realm-id',
    });

    const req = mockRequest({
      code: 'oauth-code-xyz',
      state: 'valid-jwt',
      realmId: 'ext-realm-id', // matches state realmId exactly
    });
    const res = mockResponse();

    controller.handleCallback(
      req as unknown as Request,
      res as unknown as Response,
    );

    expect(() =>
      mockOauthStateService.verifyState('valid-jwt', 'salesforce'),
    ).not.toThrow();

    expectPopupMessage(res, {
      status: 'success',
      provider: 'salesforce',
      code: 'oauth-code-xyz',
    });
  });
});
