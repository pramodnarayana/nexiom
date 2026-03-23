import { Injectable, Logger, Inject } from '@nestjs/common';
import { appConnections, DATABASE_CONNECTION } from '@nexiom/database';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import type { DrizzleDb } from '@nexiom/database';

import { EncryptionService } from '../crypto/encryption.interface.js';

/**
 * Shape of the decrypted credential blob stored in app_connection.value.
 * Returned by getValidCredentials() so callers have a typed, narrow interface
 * without resorting to double casts or knowledge of the encryption layer.
 */
export interface OAuthCredentialBlob {
    clientId: string;
    clientSecret: string;
    accessToken: string;
    refreshToken?: string;
    /** Vendor-specific extras: instance_url, realmId, id_token, etc. */
    data: Record<string, unknown>;
    vendorParams?: Record<string, string>;
    environment?: string | number | boolean;
}

export class OAuthRefreshError extends Error {
    constructor(message: string, public status?: number) {
        super(message);
        this.name = 'OAuthRefreshError';
    }
}

export class AppCredentialError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AppCredentialError';
    }
}

/**
 * Runtime type guard for OAuthCredentialBlob.
 * Validates the minimum required fields so callers can detect malformed
 * encrypted payloads before attempting a token refresh merge, rather than
 * silently carrying forward stale or undefined credential fields via an
 * unsafe double-cast.
 */
export function isOAuthCredentialBlob(value: unknown): value is OAuthCredentialBlob {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;
    return (
        typeof v['clientId'] === 'string' &&
        typeof v['clientSecret'] === 'string' &&
        typeof v['accessToken'] === 'string' &&
        typeof v['data'] === 'object' && v['data'] !== null
    );
}

export abstract class OAuthRefreshClient {
    abstract refresh(tenantId: string, appName: string, externalId: string, refreshToken: string): Promise<Record<string, unknown>>;
}

function parseExpiresAt(value: unknown): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date;
}

@Injectable()
export class TokenManagerService {
    private readonly logger = new Logger(TokenManagerService.name);

    constructor(
        @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
        @Inject('REDIS_CLIENT') private readonly redis: Redis,
        private readonly crypto: EncryptionService,
        private readonly oauthClient: OAuthRefreshClient,
    ) { }

    /**
     * Primary Entrypoint for fetching tokens.
     * Guarantees returning a VALID, unexpired token payload.
     */
    async getValidCredentials(connectionId: string): Promise<OAuthCredentialBlob> {
        const connection = await this.db.query.appConnections.findFirst({
            where: eq(appConnections.id, connectionId)
        });

        if (!connection) throw new Error(`Connection ${connectionId} not found`);
        if (connection.status === 'REVOKED') throw new Error(`Connection revoked by user/provider`);

        // 1. Check Expiry (with 5-minute buffer to prevent mid-flight expiration)
        //    Treat null/missing/invalid expiresAt as expired for OAUTH2 — forces a refresh to populate it.
        const expiresAtObj = parseExpiresAt(connection.expiresAt);

        const isExpired = connection.authType === 'OAUTH2' &&
            (!expiresAtObj || new Date(expiresAtObj.getTime() - 5 * 60000) < new Date());

        if (isExpired) {
            this.logger.warn(`Token expired or missing expiresAt for ${connection.appName}. Refreshing...`);
            return await this.refreshWithLock(connection);
        }

        // 2. Return decrypted credentials
        return JSON.parse(await this.crypto.decrypt(connection.value)) as OAuthCredentialBlob;
    }

    private async refreshWithLock(connection: Record<string, any>): Promise<OAuthCredentialBlob> {
        const lockKey = `lock:refresh:${connection.id as string}`;
        const lockValue = Math.random().toString(36).substring(2);

        // Acquire Lock (TTL 10 seconds to prevent deadlocks if worker crashes)
        const lockAcquired = await this.redis.set(lockKey, lockValue, 'PX', 10000, 'NX');

        if (!lockAcquired) {
            this.logger.debug(`Connection ${connection.id as string} is currently refreshing. Waiting...`);
            const result = await this.waitForRefreshOrAcquireLock(connection, lockKey, lockValue);
            // IMPORTANT: this early return must stay outside the try/finally below.
            // When credentials are resolved by another worker we hold no lock,
            // so releaseLock must NOT be called.
            if (result.credentials) return result.credentials;
            connection = result.connection;
            // Lock was acquired inside waitForRefreshOrAcquireLock — fall through to try/finally.
        }

        try {
            return await this.performTokenRefresh(connection);
        } catch (error: unknown) {
            await this.handleRefreshError(error, connection);
            throw error;
        } finally {
            await this.releaseLock(lockKey, lockValue);
        }
    }

    /**
     * Waits for another worker to finish refreshing, or acquires the lock itself.
     * Returns decrypted credentials if another worker already refreshed, otherwise the latest connection.
     */
    private async waitForRefreshOrAcquireLock(
        connection: Record<string, any>,
        lockKey: string,
        lockValue: string,
    ): Promise<{ credentials?: OAuthCredentialBlob; connection: Record<string, any> }> {
        const MAX_RETRIES = 3;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 1500));

            const freshConnection = await this.db.query.appConnections.findFirst({
                where: eq(appConnections.id, connection.id)
            });

            const parsedExpiry = parseExpiresAt(freshConnection?.expiresAt);

            if (parsedExpiry &&
                new Date(parsedExpiry.getTime() - 5 * 60000) > new Date()) {
                // Token was refreshed by another worker
                const credentials = JSON.parse(
                    await this.crypto.decrypt(freshConnection!.value)
                ) as OAuthCredentialBlob;
                return { credentials, connection };
            }

            const retryLock = await this.redis.set(lockKey, lockValue, 'PX', 10000, 'NX');
            if (retryLock) {
                // Re-read after acquiring the lock to avoid refreshing stale data
                const latestConnection = await this.db.query.appConnections.findFirst({
                    where: eq(appConnections.id, connection.id)
                });
                return { connection: latestConnection ?? connection };
            }

            if (attempt === MAX_RETRIES - 1) {
                throw new Error(`Unable to acquire refresh lock for connection ${connection.id as string}`);
            }
        }

        // Unreachable, but satisfies TypeScript
        throw new Error(`Unable to acquire refresh lock for connection ${connection.id as string}`);
    }

    /** Decrypts, refreshes via the vendor API, encrypts, and persists the new token. */
    private async performTokenRefresh(connection: Record<string, any>): Promise<OAuthCredentialBlob> {
        this.logger.log(`Acquired lock. Refreshing OAuth token for ${connection.appName as string}`);

        // 1. Decrypt old payload to get refresh_token
        const oldPayload = JSON.parse(
            await this.crypto.decrypt(connection.value)
        ) as Record<string, unknown>;

        if (!oldPayload.refreshToken) {
            throw new Error('No refresh token available');
        }

        if (typeof connection.tenantId !== 'string' || !connection.tenantId.trim()) {
            throw new TypeError('Invalid connection: tenantId is missing, empty or not a string');
        }

        if (typeof connection.externalId !== 'string' || !connection.externalId.trim()) {
            throw new TypeError('Invalid connection: externalId is missing, empty or not a string');
        }

        // 2. Perform HTTP call to Vendor API
        const newTokens = await this.oauthClient.refresh(
            connection.tenantId,
            connection.appName as string,
            connection.externalId,
            oldPayload.refreshToken as string,
        );

        // 3. Validate stored credential shape before merging.
        //    If the decrypted payload does not match OAuthCredentialBlob (e.g., the
        //    encryption key rotated or the row was written by an older schema), throw
        //    rather than silently spreading undefined fields into the refreshed blob.
        if (!isOAuthCredentialBlob(oldPayload)) {
            throw new AppCredentialError(
                'Stored credentials are malformed and do not match OAuthCredentialBlob. Re-authorization required.',
            );
        }

        // 4. Require a fresh access token — never persist a stale one.
        //    A missing access_token means the vendor refresh response was malformed
        //    or the grant was revoked; writing oldPayload.accessToken back would
        //    produce a DB row with a refreshed expiresAt but a stale token, causing
        //    silent auth failures until the connection is fully re-authorized.
        if (typeof newTokens.access_token !== 'string' || !newTokens.access_token) {
            throw new OAuthRefreshError(
                'Token refresh response did not include an access_token. Re-authorization required.',
            );
        }

        // oldPayload is narrowed to OAuthCredentialBlob by the guard above — no cast needed.
        const updatedPayload: OAuthCredentialBlob = {
            ...oldPayload,
            accessToken: newTokens.access_token,
            refreshToken: (newTokens.refresh_token || oldPayload.refreshToken) as string | undefined,
            ...(typeof newTokens.expires_in === 'number' && { expiresIn: newTokens.expires_in }),
            ...('id_token' in newTokens && { idToken: newTokens.id_token }),
            ...('token_type' in newTokens && { tokenType: newTokens.token_type }),
        };

        // 5. Encrypt & Calculate Expiry
        const encryptedPayload = await this.crypto.encrypt(JSON.stringify(updatedPayload));
        const expiresInMs = typeof newTokens.expires_in === 'number'
            ? newTokens.expires_in * 1000
            : 3600 * 1000; // default 1-hour fallback
        const expiresAt = new Date(Date.now() + expiresInMs);

        // 6. Save to DB
        await this.db.update(appConnections)
            .set({ value: encryptedPayload, expiresAt, updatedAt: new Date() })
            .where(eq(appConnections.id, connection.id));

        return updatedPayload;
    }

    /** Marks the connection as REVOKED if the vendor rejected the refresh (400/401). */
    private async handleRefreshError(error: unknown, connection: Record<string, any>): Promise<void> {
        if (!(error instanceof OAuthRefreshError)) return;

        const isRevoked = error.status === 400 || error.status === 401;
        if (!isRevoked) return;

        await this.db.update(appConnections)
            .set({ status: 'REVOKED' })
            .where(eq(appConnections.id, connection.id));
        this.logger.error(`Token refresh rejected. Marked connection as REVOKED.`);
    }

    /** Releases the distributed lock using a Lua script to prevent deleting another worker's lock. */
    private async releaseLock(lockKey: string, lockValue: string): Promise<void> {
        const luaScript = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
        `;
        await this.redis.eval(luaScript, 1, lockKey, lockValue);
    }
}

