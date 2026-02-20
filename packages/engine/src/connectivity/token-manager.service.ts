import { Injectable, Logger } from '@nestjs/common';
import { db, appConnections } from '@nexiom/database';
import { eq } from 'drizzle-orm';
import Redis from 'ioredis';

// Mocks for dependencies that would exist in the real app
class EncryptionService {
    async decrypt(val: string) { return Buffer.from(val, 'base64').toString('utf-8'); }
    async encrypt(val: string) { return Buffer.from(val).toString('base64'); }
}
class OAuthRefreshClient {
    async refresh(appName: string, refreshToken: string): Promise<any> {
        return { access_token: 'new_access', refresh_token: 'new_refresh', expires_in: 3600 };
    }
}

@Injectable()
export class TokenManagerService {
    private readonly logger = new Logger(TokenManagerService.name);
    private redis: Redis;
    private crypto: EncryptionService;
    private oauthClient: OAuthRefreshClient;

    constructor() {
        // Mocking dependency injection for Phase 3 skeleton
        this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        this.crypto = new EncryptionService();
        this.oauthClient = new OAuthRefreshClient();
    }

    /**
     * Primary Entrypoint for fetching tokens.
     * Guarantees returning a VALID, unexpired token payload.
     */
    async getValidCredentials(connectionId: string): Promise<Record<string, any>> {
        // @ts-ignore
        const connection = await db.query.appConnections.findFirst({
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
        return JSON.parse(await this.crypto.decrypt(connection.encryptedCredentials));
    }

    private async refreshWithLock(connection: any): Promise<Record<string, any>> {
        const lockKey = `lock:refresh:${connection.id}`;

        // Acquire Lock (TTL 10 seconds to prevent deadlocks if worker crashes)
        const lockAcquired = await this.redis.set(lockKey, 'locked', 'PX', 10000, 'NX');

        if (!lockAcquired) {
            this.logger.debug(`Connection ${connection.id} is currently refreshing. Waiting...`);
            await new Promise(resolve => setTimeout(resolve, 1500));
            return this.getValidCredentials(connection.id); // Recursive retry
        }

        try {
            this.logger.log(`Acquired lock. Refreshing OAuth token for ${connection.appName}`);

            // 1. Decrypt old payload to get refresh_token
            const oldPayload = JSON.parse(await this.crypto.decrypt(connection.encryptedCredentials));
            if (!oldPayload.refreshToken) throw new Error('No refresh token available');

            // 2. Perform HTTP call to Vendor API
            const newTokens = await this.oauthClient.refresh(connection.appName, oldPayload.refreshToken);

            // 3. Preserve the old refresh token if the vendor didn't return a new one
            const updatedPayload = {
                ...oldPayload,
                accessToken: newTokens.access_token,
                refreshToken: newTokens.refresh_token || oldPayload.refreshToken,
            };

            // 4. Encrypt & Calculate Expiry
            const encryptedPayload = await this.crypto.encrypt(JSON.stringify(updatedPayload));
            const expiresAt = new Date(Date.now() + (newTokens.expires_in * 1000));

            // 5. Save to DB
            await db.update(appConnections)
                .set({ encryptedCredentials: encryptedPayload, expiresAt, updatedAt: new Date() })
                // @ts-ignore
                .where(eq(appConnections.id, connection.id));

            return updatedPayload;

        } catch (error: any) {
            // Handle cases where the user revoked access in the external app
            if (error?.response?.status === 400 || error?.response?.status === 401) {
                // @ts-ignore
                await db.update(appConnections).set({ status: 'REVOKED' }).where(eq(appConnections.id, connection.id));
                this.logger.error(`Token refresh rejected. Marked connection as REVOKED.`);
            }
            throw error;
        } finally {
            // Always release lock
            await this.redis.del(lockKey);
        }
    }
}
