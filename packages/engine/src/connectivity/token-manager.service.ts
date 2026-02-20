import { Injectable, Logger, Inject, OnModuleDestroy } from '@nestjs/common';
import { appConnections } from '@nexiom/database';
import { eq } from 'drizzle-orm';
import Redis from 'ioredis';

// Abstract contracts — consumers must provide real implementations via DI
export abstract class EncryptionService {
    abstract decrypt(val: string): Promise<string>;
    abstract encrypt(val: string): Promise<string>;
}

export class OAuthRefreshError extends Error {
    constructor(message: string, public status?: number) {
        super(message);
        this.name = 'OAuthRefreshError';
    }
}

export abstract class OAuthRefreshClient {
    abstract refresh(appName: string, refreshToken: string): Promise<Record<string, unknown>>;
}

@Injectable()
export class TokenManagerService implements OnModuleDestroy {
    private readonly logger = new Logger(TokenManagerService.name);

    constructor(
        @Inject('DRIZZLE_DB') private readonly db: Record<string, any>,
        @Inject('REDIS_CLIENT') private readonly redis: Redis,
        private readonly crypto: EncryptionService,
        private readonly oauthClient: OAuthRefreshClient,
    ) { }

    async onModuleDestroy() {
        await this.redis.quit();
    }

    /**
     * Primary Entrypoint for fetching tokens.
     * Guarantees returning a VALID, unexpired token payload.
     */
    async getValidCredentials(connectionId: string): Promise<Record<string, unknown>> {
        const connection = await this.db.query.appConnections.findFirst({
            where: eq(appConnections.id, connectionId)
        });

        if (!connection) throw new Error(`Connection ${connectionId} not found`);
        if (connection.status === 'REVOKED') throw new Error(`Connection revoked by user/provider`);

        // 1. Check Expiry (with 5-minute buffer to prevent mid-flight expiration)
        const isExpired = connection.expiresAt && new Date(connection.expiresAt.getTime() - 5 * 60000) < new Date();

        if (isExpired && connection.authType === 'OAUTH2') {
            return await this.refreshWithLock(connection);
        }

        // 2. Return decrypted credentials
        return JSON.parse(await this.crypto.decrypt(connection.encryptedCredentials)) as Record<string, unknown>;
    }

    private async refreshWithLock(connection: Record<string, any>): Promise<Record<string, unknown>> {
        const lockKey = `lock:refresh:${connection.id as string}`;
        const lockValue = Math.random().toString(36).substring(2);

        // Acquire Lock (TTL 10 seconds to prevent deadlocks if worker crashes)
        const lockAcquired = await this.redis.set(lockKey, lockValue, 'PX', 10000, 'NX');

        if (!lockAcquired) {
            this.logger.debug(`Connection ${connection.id as string} is currently refreshing. Waiting...`);
            const MAX_RETRIES = 3;
            for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 1500));
                // Check if the other worker already refreshed successfully
                const freshConnection = await this.db.query.appConnections.findFirst({
                    where: eq(appConnections.id, connection.id)
                });
                if (freshConnection?.expiresAt &&
                    new Date(freshConnection.expiresAt.getTime() - 5 * 60000) > new Date()) {
                    // Token was refreshed by another worker
                    return JSON.parse(await this.crypto.decrypt(freshConnection.encryptedCredentials)) as Record<string, unknown>;
                }
                const retryLock = await this.redis.set(lockKey, lockValue, 'PX', 10000, 'NX');
                if (retryLock) break;
                if (attempt === MAX_RETRIES - 1) {
                    throw new Error(`Unable to acquire refresh lock for connection ${connection.id as string}`);
                }
            }
        }

        try {
            this.logger.log(`Acquired lock. Refreshing OAuth token for ${connection.appName as string}`);

            // 1. Decrypt old payload to get refresh_token
            const oldPayload = JSON.parse(await this.crypto.decrypt(connection.encryptedCredentials)) as Record<string, unknown>;
            if (!oldPayload.refreshToken) throw new Error('No refresh token available');

            // 2. Perform HTTP call to Vendor API
            const newTokens = await this.oauthClient.refresh(connection.appName as string, oldPayload.refreshToken as string);

            // 3. Preserve the old refresh token if the vendor didn't return a new one
            const updatedPayload = {
                ...oldPayload,
                accessToken: newTokens.access_token,
                refreshToken: newTokens.refresh_token || oldPayload.refreshToken,
            };

            // 4. Encrypt & Calculate Expiry
            const encryptedPayload = await this.crypto.encrypt(JSON.stringify(updatedPayload));
            const expiresInMs = typeof newTokens.expires_in === 'number'
                ? newTokens.expires_in * 1000
                : 3600 * 1000; // default 1-hour fallback
            const expiresAt = new Date(Date.now() + expiresInMs);

            // 5. Save to DB
            await this.db.update(appConnections)
                .set({ encryptedCredentials: encryptedPayload, expiresAt, updatedAt: new Date() })
                .where(eq(appConnections.id, connection.id));

            return updatedPayload;

        } catch (error: unknown) {
            // Handle cases where the user revoked access in the external app
            const errStatus = error instanceof OAuthRefreshError ? error.status : undefined;
            if (errStatus === 400 || errStatus === 401) {
                await this.db.update(appConnections).set({ status: 'REVOKED' }).where(eq(appConnections.id, connection.id));
                this.logger.error(`Token refresh rejected. Marked connection as REVOKED.`);
            }
            throw error;
        } finally {
            // Always release lock using Lua script to prevent deleting someone else's lock
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
}

