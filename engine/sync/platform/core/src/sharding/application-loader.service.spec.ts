import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApplicationLoaderService } from './application-loader.service.js';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

vi.mock('node:fs/promises', () => ({
    realpath: vi.fn(),
    access: vi.fn(),
}));

describe('ApplicationLoaderService', () => {
    let service: ApplicationLoaderService;

    beforeEach(() => {
        service = new ApplicationLoaderService();
        service.invalidateAll();
        vi.clearAllMocks();
    });

    it('throws if SHARD_BASE_PATH is not accessible', async () => {
        vi.mocked(fs.realpath).mockRejectedValueOnce(new Error('fail'));
        await expect(service.load('test-shard')).rejects.toThrow('SHARD_BASE_PATH does not exist or is not accessible');
    });

    it('throws if shard does not exist', async () => {
        vi.mocked(fs.realpath).mockResolvedValueOnce('/base/path');
        vi.mocked(fs.access).mockRejectedValueOnce(new Error('not found'));
        await expect(service.load('test-shard')).rejects.toThrow('Application shard not found at');
    });

    it('throws if shard realpath fails', async () => {
        vi.mocked(fs.realpath)
            .mockResolvedValueOnce('/base/path')
            .mockRejectedValueOnce(new Error('fail'));
        vi.mocked(fs.access).mockResolvedValueOnce(undefined);
        await expect(service.load('test-shard')).rejects.toThrow('Failed to canonicalize shard path:');
    });

    it('throws if path escapes boundary', async () => {
        vi.mocked(fs.realpath)
            .mockResolvedValueOnce('/base/path')
            .mockResolvedValueOnce('/other/path/test-shard');
        vi.mocked(fs.access).mockResolvedValueOnce(undefined);
        await expect(service.load('test-shard')).rejects.toThrow('Security violation: shard path escapes trusted boundary');
    });

    it('caches module on success and invalidates cache', async () => {
        vi.mocked(fs.realpath)
            .mockResolvedValueOnce('/base/path')
            .mockResolvedValueOnce('/base/path/test-shard');
        vi.mocked(fs.access).mockResolvedValueOnce(undefined);

        // Mock dynamic import to succeed
        const mockModule = { default: {} };
        vi.doMock('/base/path/test-shard', () => mockModule);

        await service.load('test-shard');

        expect(service['cache'].has('test-shard')).toBe(true);

        service.invalidateCache('test-shard');
        expect(service['cache'].size).toBe(0);
    });
});
