import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { dataSources, credentials, DATABASE_CONNECTION } from '@soopa/database';
import { eq } from 'drizzle-orm';
import type { DrizzleDb } from '@soopa/database';

import { IEncryptionService, ENCRYPTION_SERVICE } from '@soopa/security';
import type { IDistributedLock } from './distributed-lock.interface.js';

/**
 * Shape of the decrypted credential blob stored in credentials.value.
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
    /** Standard OAuth2 token lifetime in seconds, carried forward on refresh. */
    expiresIn?: number;
    /** OpenID Connect id_token, present when the vendor returns one. */
    idToken?: string;
    /** OAuth2 token_type (e.g. "Bearer"), carried forward on refresh. */
    tokenType?: string;
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

export type { IDistributedLock } from './distributed-lock.interface.js';

function parseExpiresAt(value: unknown): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date;
}

import { CredentialRefreshedEvent } from '../events/index.js';
import { CredentialsEventPublisher } from '../services/credentials-event-publisher.service.js';

@Injectable()
export class TokenManagerService {
    private readonly logger = new Logger(TokenManagerService.name);

    constructor(
        @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
        private readonly lock: IDistributedLock,
        @Inject(ENCRYPTION_SERVICE) private readonly crypto: IEncryptionService,
        private readonly oauthClient: OAuthRefreshClient,
        // Using Optional() since other apps might not provide it if not needed
        @Optional() @Inject(CredentialsEventPublisher) private readonly eventPublisher?: CredentialsEventPublisher,
    ) { }

    /**
     * Primary Entrypoint for fetching tokens.
     * Guarantees returning a VALID, unexpired token payload.
     */
    async getValidCredentials(connectionId: string): Promise<OAuthCredentialBlob> {
        const [connection] = await this.db.select({
            id: dataSources.id,
            credentialId: credentials.id,
            appName: dataSources.appName,
            tenantId: dataSources.tenantId,
            externalId: dataSources.externalId,
            status: credentials.status,
            expiresAt: credentials.expiresAt,
            authType: credentials.authType,
            value: credentials.value,
        })
        .from(dataSources)
        .innerJoin(credentials, eq(credentials.dataSourceId, dataSources.id))
        .where(eq(dataSources.id, connectionId))
        .limit(1);

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

        // 2. Return decrypted credentials (validates shape before returning).
        return await this.decryptAndValidate(connection);
    }

    private async refreshWithLock(connection: Record<string, any>): Promise<OAuthCredentialBlob> {
        const lockKey = `lock:refresh:${connection.id as string}`;
        const lockValue = Math.random().toString(36).substring(2);

        // Acquire Lock (TTL 10 seconds to prevent deadlocks if worker crashes)
        const lockAcquired = await this.lock.acquire(lockKey, lockValue, 10000);

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
            try {
                await this.releaseLock(lockKey, lockValue);
            } catch (releaseErr) {
                this.logger.error(`Failed to release refresh lock for ${lockKey}`, releaseErr);
            }
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

            const [freshConnection] = await this.db.select({
                id: dataSources.id,
                credentialId: credentials.id,
                appName: dataSources.appName,
                tenantId: dataSources.tenantId,
                externalId: dataSources.externalId,
                status: credentials.status,
                expiresAt: credentials.expiresAt,
                authType: credentials.authType,
                value: credentials.value,
            })
            .from(dataSources)
            .innerJoin(credentials, eq(credentials.dataSourceId, dataSources.id))
            .where(eq(dataSources.id, connection.id as string))
            .limit(1);

            const parsedExpiry = parseExpiresAt(freshConnection?.expiresAt);

            if (parsedExpiry &&
                new Date(parsedExpiry.getTime() - 5 * 60000) > new Date()) {
                // Token was refreshed by another worker — decrypt and validate
                // shape via the shared helper so malformed stored data fails fast.
                const oauthCredentials = await this.decryptAndValidate(freshConnection!);
                return { credentials: oauthCredentials, connection };
            }

            const retryLock = await this.lock.acquire(lockKey, lockValue, 10000);
            if (retryLock) {
                // Re-read after acquiring the lock to avoid refreshing stale data
                const [latestConnection] = await this.db.select({
                    id: dataSources.id,
                    credentialId: credentials.id,
                    appName: dataSources.appName,
                    tenantId: dataSources.tenantId,
                    externalId: dataSources.externalId,
                    status: credentials.status,
                    expiresAt: credentials.expiresAt,
                    authType: credentials.authType,
                    value: credentials.value,
                })
                .from(dataSources)
                .innerJoin(credentials, eq(credentials.dataSourceId, dataSources.id))
                .where(eq(dataSources.id, connection.id as string))
                .limit(1);
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

        // 1. Decrypt and validate the stored credential shape.
        //    decryptAndValidate throws AppCredentialError when the payload is
        //    malformed (e.g., key rotation, older schema) so we never spread
        //    undefined fields into the refreshed blob.
        const oldPayload = await this.decryptAndValidate(connection);

        // 2. refreshToken must be a non-empty, non-whitespace string.
        //    An absent or blank value means the connection was never issued a
        //    refresh token (e.g., client-credentials grant) or has been revoked.
        if (typeof oldPayload.refreshToken !== 'string' || !oldPayload.refreshToken.trim()) {
            throw new Error('No refresh token available');
        }

        if (typeof connection.tenantId !== 'string' || !connection.tenantId.trim()) {
            throw new TypeError('Invalid connection: tenantId is missing, empty or not a string');
        }

        if (typeof connection.externalId !== 'string' || !connection.externalId.trim()) {
            throw new TypeError('Invalid connection: externalId is missing, empty or not a string');
        }

        // 3. Perform HTTP call to Vendor API
        const newTokens = await this.oauthClient.refresh(
            connection.tenantId,
            connection.appName as string,
            connection.externalId,
            oldPayload.refreshToken,
        );

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

        // oldPayload is already narrowed to OAuthCredentialBlob by decryptAndValidate.
        const updatedPayload: OAuthCredentialBlob = {
            ...oldPayload,
            accessToken: newTokens.access_token,
            refreshToken: typeof newTokens.refresh_token === 'string' ? newTokens.refresh_token : oldPayload.refreshToken,
            ...(typeof newTokens.expires_in === 'number' && { expiresIn: newTokens.expires_in }),
            ...(typeof newTokens.id_token === 'string' && { idToken: newTokens.id_token }),
            ...(typeof newTokens.token_type === 'string' && { tokenType: newTokens.token_type }),
        };

        // 6. Encrypt & Calculate Expiry
        const encryptedPayload = await this.crypto.encrypt(JSON.stringify(updatedPayload));
        const expiresInMs = typeof newTokens.expires_in === 'number'
            ? newTokens.expires_in * 1000
            : 3600 * 1000; // default 1-hour fallback
        const expiresAt = new Date(Date.now() + expiresInMs);

        // 7. Save to DB using the specific credential ID
        await this.db.update(credentials)
            .set({ value: encryptedPayload, expiresAt, updatedAt: new Date() })
            .where(eq(credentials.id, connection.credentialId as string));

        // 8. Emit the domain event (don't propagate listener errors)
        if (this.eventPublisher) {
            try {
                await this.eventPublisher.publishCredentialRefreshed(
                    new CredentialRefreshedEvent(
                        connection.credentialId as string,
                        connection.tenantId as string,
                        connection.id as string,
                        expiresAt,
                    )
                );
            } catch (pubErr) {
                this.logger.error('Failed to publish CredentialRefreshedEvent (non-fatal)', pubErr);
            }
        }

        return updatedPayload;
    }

    /**
     * Decrypts the stored credential value and validates it matches OAuthCredentialBlob.
     * Throws AppCredentialError when the shape is wrong (e.g. key rotation, old schema)
     * so callers never have to repeat the decrypt + cast + validate triple inline.
     */
    private async decryptAndValidate(connection: Record<string, any>): Promise<OAuthCredentialBlob> {
        let parsed: unknown;
        try {
            parsed = JSON.parse(await this.crypto.decrypt(connection.value));
        } catch (error) {
            throw new AppCredentialError(
                `Failed to decrypt or parse stored credentials: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        if (!isOAuthCredentialBlob(parsed)) {
            throw new AppCredentialError(
                'Stored credentials are malformed and do not match OAuthCredentialBlob. Re-authorization required.',
            );
        }
        return parsed;
    }

    /** Marks the connection as REVOKED if the vendor rejected the refresh (400/401). */
    private async handleRefreshError(error: unknown, connection: Record<string, any>): Promise<void> {
        if (!(error instanceof OAuthRefreshError)) return;

        const isRevoked = error.status === 400 || error.status === 401;
        if (!isRevoked) return;

        await this.db.update(credentials)
            .set({ status: 'REVOKED' })
            .where(eq(credentials.id, connection.credentialId as string));
        this.logger.error(`Token refresh rejected. Marked connection as REVOKED.`);
    }

    /** Releases the distributed lock. */
    private async releaseLock(lockKey: string, lockValue: string): Promise<void> {
        await this.lock.release(lockKey, lockValue);
    }
}

