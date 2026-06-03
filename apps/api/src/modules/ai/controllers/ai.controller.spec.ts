import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from '@soopa/auth';
import { AiRateLimitGuard } from '../interceptors/ai-ratelimit.guard.js';
import { AiController } from './ai.controller.js';
import { OrchestratorService, ChatPersistenceService } from '@soopa/ai-engine';
import { PinoLogger } from 'nestjs-pino';
import { QUEUE_SERVICE, QueueName } from '@soopa/queue';

describe('AiController - Enterprise Hardened', () => {
  let controller: AiController;
  let chatPersistenceMock: {
    getOrCreateConversation: ReturnType<typeof vi.fn>;
    appendMessage: ReturnType<typeof vi.fn>;
  };
  let queueServiceMock: { send: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      setContext: vi.fn(),
    };
    const mockOrchestrator = { streamChat: vi.fn() };
    chatPersistenceMock = {
      getOrCreateConversation: vi.fn().mockResolvedValue({ id: 'conv-123' }),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-456' }),
    };
    queueServiceMock = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiController],
      providers: [
        { provide: PinoLogger, useValue: mockLogger },
        { provide: OrchestratorService, useValue: mockOrchestrator },
        { provide: ChatPersistenceService, useValue: chatPersistenceMock },
        { provide: QUEUE_SERVICE, useValue: queueServiceMock },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AiRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AiController>(AiController);
  });

  it('should offload chat request to async queue and return job metadata', async () => {
    // Mock Express Request
    const mockReq = {
      user: { tenantId: 'org-123' },
      traceId: 'trace-456',
    } as unknown as Parameters<typeof controller.chat>[1];

    const payload = {
      messages: [{ role: 'user', content: 'Fetch logistics' }],
      model: 'gemini-1.5-flash',
    } as Parameters<typeof controller.chat>[0];

    const result = await controller.chat(payload, mockReq);

    expect(chatPersistenceMock.getOrCreateConversation).toHaveBeenCalledWith(
      'org-123',
      undefined,
      'Fetch logistics',
    );
    expect(chatPersistenceMock.appendMessage).toHaveBeenCalledWith({
      tenantId: 'org-123',
      conversationId: 'conv-123',
      role: 'user',
      content: 'Fetch logistics',
      status: 'completed',
    });

    expect(queueServiceMock.send).toHaveBeenCalledWith(
      QueueName.AiCopilotQueue,
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        jobId: expect.any(String),
        traceId: 'trace-456',
        tenantId: 'org-123',
        conversationId: 'conv-123',

        messages: [{ role: 'user', content: 'Fetch logistics' }],
        model: 'gemini-1.5-flash',
      }),
    );

    expect(result.success).toBe(true);
    expect(result.jobId).toBeDefined();
    expect(result.conversationId).toBe('conv-123');
  });
});
