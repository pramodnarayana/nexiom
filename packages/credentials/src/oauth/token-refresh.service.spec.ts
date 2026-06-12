import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseOAuthRefreshClient, IHttpClient } from './token-refresh.service.js';
import { OAuthRefreshError } from './token-manager.service.js';
import { IEncryptionService } from '@soopa/security';

class MockRefreshClient extends BaseOAuthRefreshClient {
  public tokenUrlToReturn = 'https://api.example.com/oauth/token';
  
  protected getTokenUrl(appName: string): string | Promise<string> {
    if (this.tokenUrlToReturn === 'throw') {
      throw new Error('Not found');
    }
    return this.tokenUrlToReturn;
  }
}

describe('BaseOAuthRefreshClient', () => {
  let dbMock: any;
  let cryptoMock: IEncryptionService;
  let httpClientMock: IHttpClient;
  let client: MockRefreshClient;

  beforeEach(() => {
    dbMock = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn(),
    };

    cryptoMock = {
      encrypt: vi.fn(),
      decrypt: vi.fn().mockResolvedValue(JSON.stringify({
        clientId: 'test-client',
        clientSecret: 'test-secret',
        vendorParams: { environment: 'sandbox' }
      })),
    } as any;

    httpClientMock = {
      fetch: vi.fn(),
    };

    client = new MockRefreshClient(dbMock, cryptoMock, httpClientMock);
  });

  it('throws OAuthRefreshError if inputs are invalid', async () => {
    await expect(client.refresh('', 'app', 'ext', 'refresh')).rejects.toThrow(OAuthRefreshError);
    await expect(client.refresh('t1', '', 'ext', 'refresh')).rejects.toThrow(OAuthRefreshError);
  });

  it('successfully refreshes a token', async () => {
    dbMock.limit.mockResolvedValue([{ value: 'encrypted' }]);
    
    vi.mocked(httpClientMock.fetch).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ access_token: 'new-acc', refresh_token: 'new-ref' })
    } as any);

    const result = await client.refresh('t1', 'app', 'ext', 'ref-token');

    expect(result.access_token).toBe('new-acc');
    
    // Check that HTTP client was called correctly
    expect(httpClientMock.fetch).toHaveBeenCalled();
    const [url, init] = vi.mocked(httpClientMock.fetch).mock.calls[0];
    expect(url).toBe('https://api.example.com/oauth/token');
    expect(init?.method).toBe('POST');
    
    const bodyString = init?.body as string;
    expect(bodyString).toContain('grant_type=refresh_token');
    expect(bodyString).toContain('refresh_token=ref-token');
    expect(bodyString).toContain('client_id=test-client');
  });

  it('throws OAuthRefreshError if API returns non-ok status', async () => {
    dbMock.limit.mockResolvedValue([{ value: 'encrypted' }]);
    
    vi.mocked(httpClientMock.fetch).mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request'
    } as any);

    await expect(client.refresh('t1', 'app', 'ext', 'ref-token')).rejects.toThrow(OAuthRefreshError);
    await expect(client.refresh('t1', 'app', 'ext', 'ref-token')).rejects.toThrow(/400 Bad Request/);
  });

  it.each([400, 401])('publishes CredentialInvalidatedEvent on %i', async (status) => {
    dbMock.limit.mockResolvedValue([{ value: 'encrypted', credentialId: 'cred-1' }]);

    vi.mocked(httpClientMock.fetch).mockResolvedValue({
      ok: false,
      status,
      statusText: status === 400 ? 'Bad Request' : 'Unauthorized'
    } as any);

    const eventPublisherMock = {
      publishCredentialInvalidated: vi.fn(),
      publishCredentialRefreshed: vi.fn(),
      publishCredentialDeleted: vi.fn(),
    };

    const clientWithEvents = new MockRefreshClient(dbMock, cryptoMock, httpClientMock, eventPublisherMock);

    await expect(clientWithEvents.refresh('t1', 'app', 'ext', 'ref-token')).rejects.toThrow(OAuthRefreshError);
    expect(eventPublisherMock.publishCredentialInvalidated).toHaveBeenCalled();
  });

  it('throws Error if credential payload is invalid', async () => {
    dbMock.limit.mockResolvedValue([{ value: 'bad-encrypted' }]);
    vi.mocked(cryptoMock.decrypt).mockResolvedValueOnce('null');

    await expect(client.refresh('t1', 'app', 'ext', 'ref-token')).rejects.toThrow('Invalid credential payload: expected a non-null plain object');
  });

  it('throws Error if clientId or clientSecret is missing', async () => {
    dbMock.limit.mockResolvedValue([{ value: 'bad-encrypted' }]);
    vi.mocked(cryptoMock.decrypt).mockResolvedValueOnce(JSON.stringify({ clientId: '' }));

    await expect(client.refresh('t1', 'app', 'ext', 'ref-token')).rejects.toThrow('Decrypted credentials missing valid clientId or clientSecret');
  });

  it('throws OAuthRefreshError if API returns non-object JSON', async () => {
    dbMock.limit.mockResolvedValue([{ value: 'encrypted' }]);
    
    vi.mocked(httpClientMock.fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(["an", "array", "not", "an", "object"])
    } as any);

    await expect(client.refresh('t1', 'app', 'ext', 'ref-token')).rejects.toThrow('OAuth token response must be a non-null object');
  });

  it('throws 502 for TypeErrors during fetch', async () => {
    dbMock.limit.mockResolvedValue([{ value: 'encrypted' }]);
    vi.mocked(httpClientMock.fetch).mockRejectedValue(new TypeError('Network request failed'));

    await expect(client.refresh('t1', 'app', 'ext', 'ref-token')).rejects.toThrow('Transport or configuration TypeError: Network request failed');
  });
});
