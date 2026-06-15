import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalFilePieceResolver } from './local-file.piece-resolver.js';
import type { LocalDevPluginSyncService } from './local-dev-plugin-sync.service.js';
import * as fs from 'fs';

describe('LocalFilePieceResolver', () => {
  let resolver: LocalFilePieceResolver;
  let mockLocalSync: any;

  beforeEach(() => {
    mockLocalSync = {
      getWorkspacePiecePath: vi.fn(),
    } as unknown as LocalDevPluginSyncService;

    resolver = new LocalFilePieceResolver(mockLocalSync);
  });

  it('should throw if local path not found', async () => {
    mockLocalSync.getWorkspacePiecePath.mockReturnValue(null);
    await expect(resolver.resolve('@soopa/missing')).rejects.toThrow('Local source not found');
  });

  it('should resolve a piece from local file system using dynamic import', async () => {
    const tempFile = '/tmp/soopa-dev-resolver-test.mjs';
    fs.writeFileSync(tempFile, 'export const module = "test-module";');
    
    mockLocalSync.getWorkspacePiecePath.mockReturnValue(tempFile);

    const result = await resolver.resolve('@soopa/existing');
    expect(result.module).toBe('test-module');

    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  });

  it('should throw if native import fails', async () => {
    const tempFile = '/tmp/soopa-dev-resolver-invalid.mjs';
    // Write syntax error
    fs.writeFileSync(tempFile, 'export const module = ');
    
    mockLocalSync.getWorkspacePiecePath.mockReturnValue(tempFile);

    await expect(resolver.resolve('@soopa/invalid')).rejects.toThrow('Failed to natively import local piece');

    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  });
});
