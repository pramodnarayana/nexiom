import { AesEncryptionService } from './encryption.service.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';

describe('AesEncryptionService', () => {
    let service: AesEncryptionService;
    let mockConfigService: Partial<ConfigService>;

    beforeEach(() => {
        // Ensure a predictable 32-byte key for testing aes-256-gcm
        process.env.ENCRYPTION_KEY = 'a'.repeat(32);
        mockConfigService = {
            get: vi.fn().mockImplementation((key: string) => {
                if (key === 'ENCRYPTION_KEY') return process.env.ENCRYPTION_KEY;
                return undefined;
            }),
        };
        service = new AesEncryptionService(mockConfigService as ConfigService);
    });

    afterEach(() => {
        delete process.env.ENCRYPTION_KEY;
    });

    it('should successfully encrypt and decrypt a plaintext string (e.g. JSON tokens)', async () => {
        const payload = JSON.stringify({ accessToken: 'secret123', refreshToken: 'refresh456' });

        const encrypted = await service.encrypt(payload);

        // Assert format iv:authTag:encryptedPayload
        expect(encrypted.split(':')).toHaveLength(3);
        expect(encrypted).not.toContain('secret123');

        const decrypted = await service.decrypt(encrypted);

        expect(decrypted).toEqual(payload);
    });

    it('should throw an error when attempting to decrypt invalid or tampered ciphertext', async () => {
        const payload = 'sensitive_data';
        const encrypted = await service.encrypt(payload);

        // Tamper with the ciphertext component: slightly alter a valid hex string
        const parts = encrypted.split(':');
        const firstHexChar = parts[2][0];
        const newFirstChar = firstHexChar === 'a' ? 'b' : 'a';
        parts[2] = newFirstChar + parts[2].substring(1);
        const tamperedCiphertext = parts.join(':');

        await expect(service.decrypt(tamperedCiphertext)).rejects.toThrow('Decryption failed');
    });

    it('should format the encrypted string natively with deterministic parts', async () => {
        const payload = 'test';
        const encrypted = await service.encrypt(payload);
        const [iv, authTag, ciphertext] = encrypted.split(':');

        expect(iv).toBeDefined();
        expect(iv.length).toBe(24); // 12 bytes in hex is 24 chars
        expect(authTag).toBeDefined();
        expect(authTag.length).toBe(32); // 16 bytes in hex is 32 chars
        expect(ciphertext).toBeDefined();
    });
});
