import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenManagerService, OAuthRefreshError, AppCredentialError, IDistributedLock, OAuthRefreshClient } from './token-manager.service.js';
import { EncryptionService } from '../crypto/encryption.interface.js';
import { dataSources, credentials } from '@soopa/database';
import { eq } from 'drizzle-orm';

class FakeLock implements IDistributedLock {
  public acquired = new Set<string>();
  async acquire(key: string, value: string, ttlMs: number): Promise<boolean> {
    if (this.acquired.has(key)) return false;
    this.acquired.add(key);
    return true;
  }
  async release(key: string, value: string): Promise<void> {
    this.acquired.delete(key);
  }
}

describe('TokenManagerService', () => {
  let dbMock: any;
  let lockMock: FakeLock;
  let cryptoMock: EncryptionService;
  let oauthClientMock: OAuthRefreshClient;
  let eventPublisherMock: any;
  let service: TokenManagerService;

  beforeEach(() => {
    dbMock = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };
    lockMock = new FakeLock();
    cryptoMock = {
      encrypt: vi.fn().mockResolvedValue('encrypted-tokens'),
      decrypt: vi.fn().mockResolvedValue(JSON.stringify({
        clientId: 'cid',
        clientSecret: 'csec',
        accessToken: 'access',
        refreshToken: 'refresh',
        data: {},
      })),
    } as any;
    oauthClientMock = {
      refresh: vi.fn().mockResolvedValue({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      }),
    };
    eventPublisherMock = {
      publishCredentialRefreshed: vi.fn().mockResolvedValue(undefined),
    };

    service = new TokenManagerService(dbMock, lockMock, cryptoMock, oauthClientMock, eventPublisherMock);
  });

  describe('getValidCredentials', () => {
    it('throws if connection not found', async () => {
      dbMock.limit.mockResolvedValueOnce([]);
      await expect(service.getValidCredentials('conn-1')).rejects.toThrow('Connection conn-1 not found');
    });

    it('throws if connection is revoked', async () => {
      dbMock.limit.mockResolvedValueOnce([{ status: 'REVOKED' }]);
      await expect(service.getValidCredentials('conn-1')).rejects.toThrow('Connection revoked by user/provider');
    });

    it('returns decrypted credentials if unexpired', async () => {
      dbMock.limit.mockResolvedValueOnce([{
        id: 'conn-1',
        authType: 'OAUTH2',
        expiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour from now
        value: 'encrypted',
      }]);

      const creds = await service.getValidCredentials('conn-1');
      expect(cryptoMock.decrypt).toHaveBeenCalledWith('encrypted');
      expect(creds.accessToken).toBe('access');
    });

    it('throws AppCredentialError if decrypted blob is malformed', async () => {
      dbMock.limit.mockResolvedValueOnce([{
        id: 'conn-1',
        authType: 'OAUTH2',
        expiresAt: new Date(Date.now() + 3600 * 1000),
        value: 'bad-encrypted',
      }]);
      vi.mocked(cryptoMock.decrypt).mockResolvedValueOnce(JSON.stringify({ bad: 'shape' }));

      await expect(service.getValidCredentials('conn-1')).rejects.toThrow(AppCredentialError);
    });
  });

  describe('refresh token logic', () => {
    it('refreshes token if expired, acquiring and releasing lock', async () => {
      const conn = {
        id: 'conn-1',
        credentialId: 'cred-1',
        tenantId: 't1',
        appName: 'app1',
        externalId: 'ext1',
        authType: 'OAUTH2',
        expiresAt: new Date(Date.now() - 3600 * 1000), // Expired 1 hour ago
        value: 'encrypted',
      };
      dbMock.limit.mockResolvedValueOnce([conn]);

      const creds = await service.getValidCredentials('conn-1');
      
      expect(oauthClientMock.refresh).toHaveBeenCalledWith('t1', 'app1', 'ext1', 'refresh');
      expect(creds.accessToken).toBe('new-access');
      expect(cryptoMock.encrypt).toHaveBeenCalled();
      expect(dbMock.update).toHaveBeenCalled();
      
      // Ensure lock was released
      expect(lockMock.acquired.has(`lock:refresh:conn-1`)).toBe(false);
    });

    it('throws OAuthRefreshError and marks REVOKED if 400 error during refresh', async () => {
      const conn = {
        id: 'conn-1',
        credentialId: 'cred-1',
        tenantId: 't1',
        appName: 'app1',
        externalId: 'ext1',
        authType: 'OAUTH2',
        expiresAt: new Date(Date.now() - 3600 * 1000), // Expired
        value: 'encrypted',
      };
      dbMock.limit.mockResolvedValueOnce([conn]);

      vi.mocked(oauthClientMock.refresh).mockRejectedValueOnce(new OAuthRefreshError('invalid_grant', 400));

      await expect(service.getValidCredentials('conn-1')).rejects.toThrow(OAuthRefreshError);
      
      // Check that it marked status as REVOKED
      expect(dbMock.update).toHaveBeenCalled();
      expect(dbMock.set).toHaveBeenCalledWith({ status: 'REVOKED' });
    });

    it('waits for refresh if lock is already acquired', async () => {
      const conn = {
        id: 'conn-1',
        credentialId: 'cred-1',
        tenantId: 't1',
        appName: 'app1',
        externalId: 'ext1',
        authType: 'OAUTH2',
        expiresAt: new Date(Date.now() - 3600 * 1000), // Expired
        value: 'encrypted',
      };
      dbMock.limit.mockResolvedValueOnce([conn]);
      
      // Lock is already acquired
      lockMock.acquired.add('lock:refresh:conn-1');

      // First db call in waitForRefreshOrAcquireLock returns an unexpired connection!
      dbMock.limit.mockResolvedValueOnce([{
        ...conn,
        expiresAt: new Date(Date.now() + 3600 * 1000), // Now unexpired
        value: 'encrypted',
      }]);

      const creds = await service.getValidCredentials('conn-1');
      expect(creds.accessToken).toBe('access');
      // Should not call refresh because the lock waiting returned a valid connection
      expect(oauthClientMock.refresh).not.toHaveBeenCalled();
    });

    it('eventually acquires lock and refreshes if wait loop fails to find fresh token', async () => {
      const conn = {
        id: 'conn-1',
        credentialId: 'cred-1',
        tenantId: 't1',
        appName: 'app1',
        externalId: 'ext1',
        authType: 'OAUTH2',
        expiresAt: new Date(Date.now() - 3600 * 1000), // Expired
        value: 'encrypted',
      };
      dbMock.limit.mockResolvedValueOnce([conn]);
      
      // First try to acquire lock fails
      let lockAttempts = 0;
      const originalAcquire = lockMock.acquire.bind(lockMock);
      lockMock.acquire = async (key, val, ttl) => {
        lockAttempts++;
        if (lockAttempts === 1) return false;
        return true;
      };

      // dbMock returns still-expired token during wait loop
      dbMock.limit.mockResolvedValueOnce([conn]);
      dbMock.limit.mockResolvedValueOnce([conn]); // Re-read after acquiring lock

      const creds = await service.getValidCredentials('conn-1');
      expect(creds.accessToken).toBe('new-access');
      expect(oauthClientMock.refresh).toHaveBeenCalled();
    });

    it('throws error if refresh token is missing', async () => {
      const conn = {
        id: 'conn-1',
        credentialId: 'cred-1',
        tenantId: 't1',
        appName: 'app1',
        externalId: 'ext1',
        authType: 'OAUTH2',
        expiresAt: new Date(Date.now() - 3600 * 1000), // Expired
        value: 'encrypted',
      };
      dbMock.limit.mockResolvedValueOnce([conn]);

      // Return a blob missing a refresh token
      vi.mocked(cryptoMock.decrypt).mockResolvedValueOnce(JSON.stringify({
        clientId: 'cid',
        clientSecret: 'csec',
        accessToken: 'access',
        refreshToken: '',
        data: {},
      }));

      await expect(service.getValidCredentials('conn-1')).rejects.toThrow('No refresh token available');
    });

    it('throws OAuthRefreshError if vendor does not return access_token', async () => {
      const conn = {
        id: 'conn-1',
        credentialId: 'cred-1',
        tenantId: 't1',
        appName: 'app1',
        externalId: 'ext1',
        authType: 'OAUTH2',
        expiresAt: new Date(Date.now() - 3600 * 1000), // Expired
        value: 'encrypted',
      };
      dbMock.limit.mockResolvedValueOnce([conn]);

      vi.mocked(oauthClientMock.refresh).mockResolvedValueOnce({
        refresh_token: 'new-refresh',
      });

      await expect(service.getValidCredentials('conn-1')).rejects.toThrow(OAuthRefreshError);
    });

    it('handles non-400/401 refresh errors by NOT marking connection revoked', async () => {
      const conn = {
        id: 'conn-1',
        credentialId: 'cred-1',
        tenantId: 't1',
        appName: 'app1',
        externalId: 'ext1',
        authType: 'OAUTH2',
        expiresAt: new Date(Date.now() - 3600 * 1000), // Expired
        value: 'encrypted',
      };
      dbMock.limit.mockResolvedValueOnce([conn]);

      vi.mocked(oauthClientMock.refresh).mockRejectedValueOnce(new OAuthRefreshError('Internal Server Error', 500));

      await expect(service.getValidCredentials('conn-1')).rejects.toThrow(OAuthRefreshError);
      
      // Should not call update
      expect(dbMock.update).not.toHaveBeenCalled();
    });

    it('treats invalid expiresAt date strings as expired', async () => {
      const conn = {
        id: 'conn-1',
        credentialId: 'cred-1',
        tenantId: 't1',
        appName: 'app1',
        externalId: 'ext1',
        authType: 'OAUTH2',
        expiresAt: 'not-a-valid-date',
        value: 'encrypted',
      };
      dbMock.limit.mockResolvedValueOnce([conn]);

      const creds = await service.getValidCredentials('conn-1');
      expect(oauthClientMock.refresh).toHaveBeenCalled();
      expect(creds.accessToken).toBe('new-access');
    });

    it('emits CredentialRefreshedEvent and swallows publisher errors', async () => {
      const conn = {
        id: 'conn-1',
        credentialId: 'cred-1',
        tenantId: 't1',
        appName: 'app1',
        externalId: 'ext1',
        authType: 'OAUTH2',
        expiresAt: new Date(Date.now() - 3600 * 1000), // Expired
        value: 'encrypted',
      };
      dbMock.limit.mockResolvedValueOnce([conn]);

      // Make publisher throw
      eventPublisherMock.publishCredentialRefreshed.mockRejectedValueOnce(new Error('pub error'));

      const creds = await service.getValidCredentials('conn-1');
      
      expect(oauthClientMock.refresh).toHaveBeenCalled();
      expect(eventPublisherMock.publishCredentialRefreshed).toHaveBeenCalled();
      expect(creds.accessToken).toBe('new-access'); // Should succeed without throwing
    });

    it('throws TypeError if tenantId is missing', async () => {
      const conn = {
        id: 'conn-1',
        credentialId: 'cred-1',
        appName: 'app1',
        externalId: 'ext1',
        authType: 'OAUTH2',
        expiresAt: new Date(Date.now() - 3600 * 1000), // Expired
        value: 'encrypted',
      };
      dbMock.limit.mockResolvedValueOnce([conn]);
      await expect(service.getValidCredentials('conn-1')).rejects.toThrow(TypeError);
    });

    it('throws TypeError if externalId is missing', async () => {
      const conn = {
        id: 'conn-1',
        credentialId: 'cred-1',
        tenantId: 't1',
        appName: 'app1',
        authType: 'OAUTH2',
        expiresAt: new Date(Date.now() - 3600 * 1000), // Expired
        value: 'encrypted',
      };
      dbMock.limit.mockResolvedValueOnce([conn]);
      await expect(service.getValidCredentials('conn-1')).rejects.toThrow(TypeError);
    });
  });
});
