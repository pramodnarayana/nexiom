import { Test, TestingModule } from '@nestjs/testing';
import { PluginsController, WebhookPayloadDto } from './plugins.controller.js';
import { PluginManagerService } from '@soopa/piece-registry';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mocked } from 'vitest';

describe('PluginsController', () => {
  let controller: PluginsController;
  let pluginManagerService: Mocked<PluginManagerService>;
  let configService: Mocked<ConfigService>;
  let installPieceMock: ReturnType<typeof vi.fn>;

  const TEST_SECRET = 'test-secret';

  beforeEach(async () => {
    installPieceMock = vi.fn();

    // Mock the dependencies
    pluginManagerService = {
      installPiece: installPieceMock,
    } as unknown as Mocked<PluginManagerService>;

    configService = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'NPM_WEBHOOK_SECRET') return TEST_SECRET;
        return null;
      }),
    } as unknown as Mocked<ConfigService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PluginsController],
      providers: [
        { provide: PluginManagerService, useValue: pluginManagerService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    controller = module.get<PluginsController>(PluginsController);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Helper to generate valid HMAC signature
  const generateValidSignature = (payload: any): string => {
    const hmac = crypto.createHmac('sha256', TEST_SECRET);
    return 'sha256=' + hmac.update(JSON.stringify(payload)).digest('hex');
  };

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('handleNpmWebhook', () => {
    it('should throw UnauthorizedException if signature is missing but secret is configured', async () => {
      const payload = {
        name: '@soopa/piece-slack',
        version: '1.0.0',
      } as WebhookPayloadDto;

      await expect(controller.handleNpmWebhook('', payload)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(installPieceMock).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException if signature is invalid', async () => {
      const payload = {
        name: '@soopa/piece-slack',
        version: '1.0.0',
      } as WebhookPayloadDto;
      const invalidSignature = 'sha256=invalidhash12345';

      await expect(
        controller.handleNpmWebhook(invalidSignature, payload),
      ).rejects.toThrow(UnauthorizedException);
      expect(installPieceMock).not.toHaveBeenCalled();
    });

    it('should ignore payload without a package name gracefully', async () => {
      const payload = { version: '1.0.0' } as WebhookPayloadDto;
      const signature = generateValidSignature(payload);

      const result = await controller.handleNpmWebhook(signature, payload);

      expect(result).toEqual({
        status: 'ignored',
        reason: 'No package name found in payload',
      });
      expect(installPieceMock).not.toHaveBeenCalled();
    });

    it('should ignore payload that does not belong to @soopa scope', async () => {
      const payload = {
        name: '@other/piece-slack',
        version: '1.0.0',
      } as WebhookPayloadDto;
      const signature = generateValidSignature(payload);

      const result = await controller.handleNpmWebhook(signature, payload);

      expect(result).toEqual({
        status: 'ignored',
        reason: 'Only @soopa packages are hot-loaded',
      });
      expect(installPieceMock).not.toHaveBeenCalled();
    });

    it('should successfully install a valid piece and return success', async () => {
      const payload = {
        name: '@soopa/piece-slack',
        version: '1.2.3',
      } as unknown as WebhookPayloadDto;
      const signature = generateValidSignature(payload);

      pluginManagerService.installPiece.mockResolvedValueOnce({
        location: '/tmp/plugin',
        version: '1.2.3',
      });

      const result = await controller.handleNpmWebhook(signature, payload);

      expect(result).toEqual({
        status: 'success',
        message: 'Successfully installed @soopa/piece-slack@1.2.3',
      });
      expect(installPieceMock).toHaveBeenCalledWith(
        '@soopa/piece-slack',
        '1.2.3',
      );
    });

    it('should return error status if pluginManager fails to install', async () => {
      const payload = {
        name: '@soopa/piece-slack',
        version: '1.2.3',
      } as unknown as WebhookPayloadDto;
      const signature = generateValidSignature(payload);

      installPieceMock.mockRejectedValueOnce(new Error('Network Failure'));

      const result = await controller.handleNpmWebhook(signature, payload);

      expect(result).toEqual({ status: 'error', message: 'Network Failure' });
      expect(installPieceMock).toHaveBeenCalledWith(
        '@soopa/piece-slack',
        '1.2.3',
      );
    });
  });
});
