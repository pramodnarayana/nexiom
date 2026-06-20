import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkspacePluginRegistrar } from './workspace-plugin-registrar.js';
import * as path from 'path';
import * as fs from 'fs';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    promises: {
      ...actual.promises,
      readdir: vi.fn(),
      stat: vi.fn(),
      access: vi.fn(),
      readFile: vi.fn(),
    },
  };
});

describe('workspace-plugin-registrar', () => {
  let service: WorkspacePluginRegistrar;
  let mockPieceRepo: any;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'development', REGISTRY_PLUGIN: 'false' };
    mockPieceRepo = {
      upsertPiece: vi.fn().mockResolvedValue(undefined),
    };
    service = new WorkspacePluginRegistrar(mockPieceRepo);
    
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs.promises, 'readdir').mockImplementation((async (p: any) => {
      if (p.endsWith('plugins')) return ['crm'];
      if (p.endsWith('crm')) return ['test-piece'];
      return [];
    }) as any);
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ isDirectory: () => true } as any);
    vi.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });



  it('should handle missing plugins directory', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    await service.initialize();
    expect(fs.promises.readdir).not.toHaveBeenCalled();
  });

  it('should scan and upsert piece metadata', async () => {
    // Write a real temp file so native import() succeeds
    const tempFile = '/tmp/soopa-mock-plugin.cjs';
    fs.writeFileSync(tempFile, 'module.exports = { register: () => ({ name: "mock-piece", displayName: "Mock Piece", logoUrl: "http://logo" }) };');
    
    // We need path.resolve(piecePath, pkg.main) to equal tempFile
    const pkg = { name: '@soopa/test-piece', version: '1.0.0', main: tempFile };
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(JSON.stringify(pkg));

    await service.initialize();
    
    expect(mockPieceRepo.upsertPiece).toHaveBeenCalledWith({
      name: 'mock-piece',
      displayName: 'Mock Piece',
      packageName: '@soopa/test-piece',
      version: '1.0.0',
      logoUrl: 'http://logo',
    });
    
    // cleanup
    try {
      fs.unlinkSync(tempFile);
    } catch (e) {
      // ignore
    }
  });

  it('should ignore packages without name', async () => {
    const pkg = { version: '1.0.0' }; // no name
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(JSON.stringify(pkg));
    await service.initialize();
    expect(mockPieceRepo.upsertPiece).not.toHaveBeenCalled();
  });

  it('should ignore packages not starting with @soopa', async () => {
    const pkg = { name: 'other-package' }; 
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(JSON.stringify(pkg));
    await service.initialize();
    expect(mockPieceRepo.upsertPiece).not.toHaveBeenCalled();
  });

  it('should handle non-JSON package.json gracefully', async () => {
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue('invalid-json');
    await service.initialize();
    expect(mockPieceRepo.upsertPiece).not.toHaveBeenCalled();
  });

  it('should extract piece if default is an object with register()', async () => {
    const tempFile = '/tmp/soopa-mock-plugin-default-register.mjs';
    fs.writeFileSync(tempFile, 'export default { register: () => ({ name: "mock-piece-def-reg", displayName: "Mock", logoUrl: "http" }) };');
    const pkg = { name: '@soopa/test-piece-2', version: '1.0.0', main: tempFile };
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(JSON.stringify(pkg));

    await service.initialize();
    expect(mockPieceRepo.upsertPiece).toHaveBeenCalledWith(expect.objectContaining({ name: 'mock-piece-def-reg' }));
    
    try { fs.unlinkSync(tempFile); } catch (e) {}
  });

  it('should catch error when natively importing piece', async () => {
    const tempFile = '/tmp/soopa-mock-plugin-throw.cjs';
    fs.writeFileSync(tempFile, 'throw new Error("Cannot import");');
    const pkg = { name: '@soopa/test-piece-3', version: '1.0.0', main: tempFile };
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(JSON.stringify(pkg));

    await service.initialize();
    expect(mockPieceRepo.upsertPiece).not.toHaveBeenCalled();
    
    try { fs.unlinkSync(tempFile); } catch (e) {}
  });

  it('should catch error if scanning workspace plugins directory fails', async () => {
    vi.spyOn(fs.promises, 'readdir').mockRejectedValueOnce(new Error('Fatal Error'));
    await service.initialize();
    expect(mockPieceRepo.upsertPiece).not.toHaveBeenCalled();
  });

  it('returns workspace piece path if initialized', async () => {
    // Manually populate map for coverage
    (service as any).workspacePieces.set('@soopa/test', '/path');
    expect(service.getWorkspacePiecePath('@soopa/test')).toBe('/path');
  });
});
