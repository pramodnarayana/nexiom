/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { PluginsController, WebhookPayloadDto } from './plugins.controller.js';
import { PluginManagerService } from '@soopa/piece-registry';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { QUEUE_SERVICE, QueueName } from '@soopa/queue';
import type { IQueueService } from '@soopa/queue';
import * as crypto from 'crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mocked } from 'vitest';

describe('PluginsController', () => {
  let controller: PluginsController;
  let pluginManagerService: Mocked<PluginManagerService>;
  let configService: Mocked<ConfigService>;
  let queueService: Mocked<IQueueService>;
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

    queueService = {
      send: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn(),
      stopConsuming: vi.fn().mockResolvedValue(undefined),
    } as unknown as Mocked<IQueueService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PluginsController],
      providers: [
        { provide: PluginManagerService, useValue: pluginManagerService },
        { provide: ConfigService, useValue: configService },
        { provide: QUEUE_SERVICE, useValue: queueService },
      ],
    }).compile();

    controller = module.get<PluginsController>(PluginsController);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Helper to generate valid HMAC signature from raw body string
  const generateValidSignature = (rawBody: string): string => {
    const hmac = crypto.createHmac('sha256', TEST_SECRET);
    return 'sha256=' + hmac.update(rawBody).digest('hex');
  };

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('handleNpmWebhook', () => {
    it('should throw UnauthorizedException when NPM_WEBHOOK_SECRET is not configured', async () => {
      // Override configService to return undefined for NPM_WEBHOOK_SECRET
      configService.get = vi.fn().mockReturnValue(undefined);

      const payload = {
        name: '@soopa/piece-slack',
        version: '1.0.0',
      } as WebhookPayloadDto;

      await expect(
        controller.handleNpmWebhook('sha256=somesignature', payload),
      ).rejects.toThrow(UnauthorizedException);
      expect(queueService.send).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException if signature is missing but secret is configured', async () => {
      const payload = {
        name: '@soopa/piece-slack',
        version: '1.0.0',
      } as WebhookPayloadDto;

      await expect(controller.handleNpmWebhook('', payload)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(queueService.send).not.toHaveBeenCalled();
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
      expect(queueService.send).not.toHaveBeenCalled();
    });

    it('should ignore payload without a package name gracefully', async () => {
      const payload = { version: '1.0.0' } as WebhookPayloadDto;
      const rawBody = JSON.stringify(payload);
      const signature = generateValidSignature(rawBody);

      const result = await controller.handleNpmWebhook(signature, payload);

      expect(result).toEqual({
        status: 'ignored',
        reason: 'No package name found in payload',
      });
      expect(queueService.send).not.toHaveBeenCalled();
    });

    it('should ignore payload that does not belong to @soopa scope', async () => {
      const payload = {
        name: '@other/piece-slack',
        version: '1.0.0',
      } as WebhookPayloadDto;
      const rawBody = JSON.stringify(payload);
      const signature = generateValidSignature(rawBody);

      const result = await controller.handleNpmWebhook(signature, payload);

      expect(result).toEqual({
        status: 'ignored',
        reason: 'Only @soopa packages are hot-loaded',
      });
      expect(queueService.send).not.toHaveBeenCalled();
    });

    it('should successfully queue a valid piece installation and return accepted', async () => {
      const payload = {
        name: '@soopa/piece-slack',
        version: '1.2.3',
      } as unknown as WebhookPayloadDto;
      const rawBody = JSON.stringify(payload);
      const signature = generateValidSignature(rawBody);

      const result = await controller.handleNpmWebhook(signature, payload);

      expect(result).toEqual({
        status: 'accepted',
        message: 'Installation queued for @soopa/piece-slack@1.2.3',
      });

      // Verify the install event was sent to the queue
      expect(queueService.send).toHaveBeenCalledWith(
        QueueName.PluginInstallQueue,
        expect.objectContaining({
          packageName: '@soopa/piece-slack',
          version: '1.2.3',
          requestMetadata: expect.objectContaining({
            source: 'npm-webhook',
          }),
        }),
      );

      // The controller should NOT directly call installPiece anymore
      expect(installPieceMock).not.toHaveBeenCalled();
    });

    it('should return accepted status when queue send succeeds', async () => {
      const payload = {
        name: '@soopa/piece-slack',
        version: '1.2.3',
      } as unknown as WebhookPayloadDto;
      const rawBody = JSON.stringify(payload);
      const signature = generateValidSignature(rawBody);

      const result = await controller.handleNpmWebhook(signature, payload);

      expect(result).toEqual({
        status: 'accepted',
        message: 'Installation queued for @soopa/piece-slack@1.2.3',
      });

      expect(queueService.send).toHaveBeenCalledWith(
        QueueName.PluginInstallQueue,
        expect.objectContaining({
          packageName: '@soopa/piece-slack',
          version: '1.2.3',
        }),
      );
    });
  });
});
