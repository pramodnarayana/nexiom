import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isPieceShape,
  extractPieceFromModule,
  PluginHotReloaderService,
} from './plugin-hot-reloader.service.js';
import { PluginManagerService } from './plugin-manager.service.js';
import { PieceRegistryService } from './piece-registry.service.js';

describe('plugin-hot-reloader.service', () => {
  describe('isPieceShape', () => {
    it('returns true for valid piece shape', () => {
      expect(isPieceShape({ name: 'test', displayName: 'Test', auth: {}, categories: [] })).toBe(true);
    });

    it('returns false for invalid shapes', () => {
      expect(isPieceShape(null)).toBe(false);
      expect(isPieceShape({})).toBe(false);
      expect(isPieceShape({ name: 'test' })).toBe(false);
      expect(isPieceShape({ displayName: 'Test' })).toBe(false);
    });
  });

  describe('extractPieceFromModule', () => {
    it('extracts piece from default export', () => {
      const piece = { name: 'test', displayName: 'Test', auth: {}, categories: [] };
      expect(extractPieceFromModule({ default: piece })).toBe(piece);
    });

    it('extracts piece from named piece export', () => {
      const piece = { name: 'test', displayName: 'Test', auth: {}, categories: [] };
      expect(extractPieceFromModule({ piece })).toBe(piece);
    });

    it('extracts piece from register function', () => {
      const piece = { name: 'test', displayName: 'Test', auth: {}, categories: [] };
      expect(extractPieceFromModule({ register: () => piece })).toBe(piece);
    });

    it('returns null if piece cannot be found', () => {
      expect(extractPieceFromModule({})).toBe(null);
    });
  });

  describe('PluginHotReloaderService', () => {
    let service: PluginHotReloaderService;
    let mockPubSub: any;
    let mockPluginManager: any;
    let mockPieceRegistry: any;

    beforeEach(() => {
      mockPubSub = {
        subscribe: vi.fn(),
        onMessage: vi.fn(),
        quit: vi.fn(),
      };

      mockPluginManager = {
        ensurePiece: vi.fn(),
      };

      mockPieceRegistry = {
        getAllPieces: vi.fn(() => []),
        registerPiece: vi.fn(),
      };

      service = new PluginHotReloaderService(
        mockPubSub as any,
        mockPluginManager as any,
        mockPieceRegistry as any
      );
    });

    it('should initialize and subscribe to redis', async () => {
      await service.onModuleInit();
      expect(mockPubSub.subscribe).toHaveBeenCalledWith('system:plugins:reloaded');
      expect(mockPubSub.onMessage).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should destroy and quit redis', async () => {
      await service.onModuleInit();
      await service.onModuleDestroy();
    });
    
    it('should handle hot reload message', async () => {
      await service.onModuleInit();
      const messageHandler = mockPubSub.onMessage.mock.calls[0][0];

      mockPluginManager.ensurePiece.mockResolvedValueOnce({
        moduleExports: { piece: { name: 'test', displayName: 'Test', auth: {}, categories: [] } }
      });

      await messageHandler('system:plugins:reloaded', JSON.stringify({ packageName: 'test', version: '1.0' }));

      // Wait for the async queue to process
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockPluginManager.ensurePiece).toHaveBeenCalledWith('test', '1.0');
      expect(mockPieceRegistry.registerPiece).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test', displayName: 'Test', auth: {}, categories: [] })
      );
    });

    it('should ignore malformed JSON messages', async () => {
      await service.onModuleInit();
      const messageHandler = mockPubSub.onMessage.mock.calls[0][0];
      await messageHandler('system:plugins:reloaded', 'invalid json');
      expect(mockPluginManager.ensurePiece).not.toHaveBeenCalled();
    });

    it('should ignore messages missing packageName or version', async () => {
      await service.onModuleInit();
      const messageHandler = mockPubSub.onMessage.mock.calls[0][0];
      await messageHandler('system:plugins:reloaded', JSON.stringify({ packageName: 'test' }));
      await messageHandler('system:plugins:reloaded', JSON.stringify({ version: '1.0' }));
      expect(mockPluginManager.ensurePiece).not.toHaveBeenCalled();
    });

    it('should ignore messages for wrong channel', async () => {
      await service.onModuleInit();
      const messageHandler = mockPubSub.onMessage.mock.calls[0][0];
      await messageHandler('wrong:channel', JSON.stringify({ packageName: 'test', version: '1.0' }));
      expect(mockPluginManager.ensurePiece).not.toHaveBeenCalled();
    });

    it('should handle errors during subscription', async () => {
      mockPubSub.subscribe.mockRejectedValueOnce(new Error('subscribe failed'));
      await service.onModuleInit();
      expect(mockPubSub.subscribe).toHaveBeenCalled();
    });

    it('should skip registration if piece is invalid', async () => {
      await service.onModuleInit();
      const messageHandler = mockPubSub.onMessage.mock.calls[0][0];
      
      mockPluginManager.ensurePiece.mockResolvedValueOnce({
        moduleExports: { piece: null }
      });
      
      await messageHandler('system:plugins:reloaded', JSON.stringify({ packageName: 'invalid', version: '1.0' }));
      await new Promise(resolve => setTimeout(resolve, 0));
      
      expect(mockPieceRegistry.registerPiece).not.toHaveBeenCalled();
    });

    it('should catch and log errors during hotLoadPiece', async () => {
      await service.onModuleInit();
      const messageHandler = mockPubSub.onMessage.mock.calls[0][0];
      
      mockPluginManager.ensurePiece.mockRejectedValueOnce(new Error('install failed'));
      
      await messageHandler('system:plugins:reloaded', JSON.stringify({ packageName: 'error', version: '1.0' }));
      await new Promise(resolve => setTimeout(resolve, 0));
      
      expect(mockPluginManager.ensurePiece).toHaveBeenCalled();
      expect(mockPieceRegistry.registerPiece).not.toHaveBeenCalled();
    });
  });
});
