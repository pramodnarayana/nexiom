import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '../connectivity/token-manager.service';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

@Injectable()
export class AesEncryptionService implements EncryptionService {
    private readonly logger = new Logger(AesEncryptionService.name);
    private readonly algorithm = 'aes-256-gcm';
    private readonly keyBuffer: Buffer;

    /**
     * @param configService - NestJS ConfigService
     * Requires ENCRYPTION_KEY to be provided and exactly 32 bytes (raw string)
     */
    constructor(private readonly configService: ConfigService) {
        const key = this.configService.get<string>('ENCRYPTION_KEY');
        if (!key) {
            throw new Error('ENCRYPTION_KEY is missing from configuration');
        }

        this.keyBuffer = Buffer.from(key);
        if (this.keyBuffer.length !== 32) {
            throw new Error(`Invalid key length: expected 32 bytes for ${this.algorithm}, got ${this.keyBuffer.length} bytes`);
        }
    }

    async encrypt(val: string): Promise<string> {
        try {
            const iv = randomBytes(12);
            const cipher = createCipheriv(this.algorithm, this.keyBuffer, iv);

            let encrypted = cipher.update(val, 'utf8', 'hex');
            encrypted += cipher.final('hex');

            const authTag = cipher.getAuthTag().toString('hex');

            // Format: iv:authTag:encryptedPayload
            return `${iv.toString('hex')}:${authTag}:${encrypted}`;
        } catch (error) {
            this.logger.error('Encryption failed', error);
            throw new Error('Encryption failed');
        }
    }

    async decrypt(val: string): Promise<string> {
        try {
            const parts = val.split(':');
            if (parts.length !== 3) {
                throw new Error('Invalid encrypted string format');
            }

            const [ivHex, authTagHex, encryptedHex] = parts;
            const decipher = createDecipheriv(
                this.algorithm,
                this.keyBuffer,
                Buffer.from(ivHex, 'hex')
            );

            decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

            let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
            decrypted += decipher.final('utf8');

            return decrypted;
        } catch (error) {
            this.logger.error('Decryption failed', error);
            throw new Error('Decryption failed');
        }
    }
}
