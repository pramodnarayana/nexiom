import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { GitopsSyncController } from './gitops-sync.controller.js';
import { GitopsWebhookGuard } from './gitops-webhook.guard.js';
import { QueueService, QueueName } from '@nexiom/queue';

describe('GitopsSyncController', () => {
  let controller: GitopsSyncController;
  let queueSendSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    queueSendSpy = vi.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GitopsSyncController],
      providers: [
        {
          provide: QueueService,
          useValue: { send: queueSendSpy },
        },
      ],
    })
      // Override the guard so tests don't require ConfigService wiring
      .overrideGuard(GitopsWebhookGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<GitopsSyncController>(GitopsSyncController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should publish to GitopsQueue and return { accepted: true }', async () => {
    const result = await controller.triggerSync();

    expect(queueSendSpy).toHaveBeenCalledOnce();
    const [queueName, payload] = queueSendSpy.mock.calls[0] as [
      string,
      { source: string; triggeredAt: string },
    ];
    expect(queueName).toBe(QueueName.GitopsQueue);
    expect(payload.source).toBe('webhook');
    expect(typeof payload.triggeredAt).toBe('string');
    expect(result).toEqual({ accepted: true });
  });
});
