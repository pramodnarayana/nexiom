import { Injectable, Logger } from '@nestjs/common';
import { EncryptionService } from '../connectivity/token-manager.service';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

@Injectable()
export class AesEncryptionService implements EncryptionService {
    private readonly logger = new Logger(AesEncryptionService.name);
    private readonly algorithm = 'aes-256-gcm';

    // In production, this must come from ConfigService/Environment Variable.
    // Length must be exactly 32 bytes for aes-256-gcm
    private readonly key = process.env.ENCRYPTION_KEY || '12345678901234567890123456789012';

    async encrypt(val: string): Promise<string> {
        try {
            const iv = randomBytes(16);
            const cipher = createCipheriv(this.algorithm, Buffer.from(this.key), iv);

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
                Buffer.from(this.key),
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
