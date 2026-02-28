/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { OAuthCallbackController } from './callback.controller';
import { ProviderRegistryService } from '@nexiom/connections';
import { Request, Response } from 'express';
import { vi, describe, it, expect, beforeEach, Mocked } from 'vitest';
import { OauthStateService } from '../oauth-state.service';
import { ConfigService } from '@nestjs/config';

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

  const htmlCall = res.send.mock.calls.find(
    (call) =>
      typeof call[0] === 'string' &&
      call[0].includes('window.opener.postMessage'),
  );
  if (!htmlCall) {
    throw new Error(
      'Expected window.opener.postMessage payload inside res.send but none found',
    );
  }

  const html = htmlCall[0] as string;
  const match = /window\.opener\.postMessage\((.*?), '/.exec(html);
  if (!match) {
    throw new Error(
      'Could not parse window.opener.postMessage format inside HTML',
    );
  }

  let safePayload: string = match[1] ?? '';

  // Unescape the controller's transformations
  safePayload = safePayload
    .replaceAll(String.raw`\u003c`, '<')
    .replaceAll(String.raw`\u003e`, '>')
    .replaceAll(String.raw`\u002f`, '/')
    .replaceAll(String.raw`\u2028`, '\u2028')
    .replaceAll(String.raw`\u2029`, '\u2029');

  const payload: unknown = JSON.parse(safePayload);
  expect(payload).toEqual(expectedPayload);
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

    const mockConfigService = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'FRONTEND_URL') return 'http://localhost:5173';
        return undefined;
      }),
    };

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
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    controller = module.get<OAuthCallbackController>(OAuthCallbackController);
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should send error popup with invalid_state if extractProviderFromState throws', () => {
    mockOauthStateService.extractProviderFromState.mockImplementation(() => {
      throw new Error('bad state');
    });

    const req = mockRequest({ state: 'valid-jwt' });
    const res = mockResponse();

    controller.handleCallback(
      req as unknown as Request,
      res as unknown as Response,
    );
    expectPopupMessage(res, { status: 'error', error: 'invalid_state' });
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

  it('should successfully send success popup with code, provider, state, and vendorParams', () => {
    mockOauthStateService.extractProviderFromState.mockReturnValue(
      'salesforce',
    );
    mockOauthStateService.verifyState.mockReturnValue({
      workspaceId: VALID_TENANT_ID,
      env: 'sandbox',
    });

    const req = mockRequest({
      code: 'oauth-code-xyz',
      state: 'valid-jwt',
      realmId: 'ext-realm-id',
    });
    const res = mockResponse();

    controller.handleCallback(
      req as unknown as Request,
      res as unknown as Response,
    );

    expect(mockOauthStateService.verifyState).toHaveBeenCalledWith(
      'valid-jwt',
      'salesforce',
    );

    expectPopupMessage(res, {
      status: 'success',
      provider: 'salesforce',
      code: 'oauth-code-xyz',
      state: 'valid-jwt',
      vendorParams: { realmId: 'ext-realm-id' },
    });
  });
});
