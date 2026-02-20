import { AesEncryptionService } from './encryption.service';
import { randomBytes } from 'crypto';
import { describe, it, expect, beforeEach } from 'vitest';

describe('AesEncryptionService', () => {
    let service: AesEncryptionService;

    beforeEach(() => {
        // Ensure a predictable 32-byte key for testing aes-256-gcm
        process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex').substring(0, 32);
        service = new AesEncryptionService();
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

        // Tamper with the ciphertext component
        const parts = encrypted.split(':');
        parts[2] = 'tampered_data_deadbeef';
        const tamperedCiphertext = parts.join(':');

        await expect(service.decrypt(tamperedCiphertext)).rejects.toThrow('Decryption failed');
    });

    it('should format the encrypted string natively with deterministic parts', async () => {
        const payload = 'test';
        const encrypted = await service.encrypt(payload);
        const [iv, authTag, ciphertext] = encrypted.split(':');

        expect(iv).toBeDefined();
        expect(iv.length).toBe(32); // 16 bytes in hex is 32 chars
        expect(authTag).toBeDefined();
        expect(authTag.length).toBe(32); // 16 bytes in hex is 32 chars
        expect(ciphertext).toBeDefined();
    });
});
