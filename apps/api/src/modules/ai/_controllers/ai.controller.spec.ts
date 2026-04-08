/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from '@nexiom/auth';
import { AiRateLimitGuard } from '../_interceptors/ai-ratelimit.guard.js';
import { AiController } from './ai.controller.js';
import { OrchestratorService } from '../_services/orchestrator.service.js';
import { PinoLogger } from 'nestjs-pino';
import { Response } from 'express';
import { PassThrough } from 'stream';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

describe('AiController - Enterprise Hardened', () => {
  let controller: AiController;
  let orchestratorService: OrchestratorService;

  beforeEach(async () => {
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      setContext: vi.fn(),
    };
    const mockOrchestrator = { streamChat: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiController],
      providers: [
        { provide: PinoLogger, useValue: mockLogger },
        { provide: OrchestratorService, useValue: mockOrchestrator },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AiRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AiController>(AiController);
    orchestratorService = module.get<OrchestratorService>(OrchestratorService);
  });

  it('should explicitly hook Node Stream into HTTP Response using Readable.fromWeb', async () => {
    // Generate a mock standardized web stream (Vercel output shape)
    const mockWebStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('Test Stream Chunk'));
        controller.close();
      },
    });

    const mockHeaders = new Headers();
    mockHeaders.set('Content-Type', 'text/plain; charset=utf-8');
    mockHeaders.set('X-Custom-Header', 'test-value');

    vi.spyOn(orchestratorService, 'streamChat').mockResolvedValue({
      status: 200,
      headers: mockHeaders,
      body: mockWebStream,
    } as unknown as Awaited<ReturnType<typeof orchestratorService.streamChat>>);

    // Mock Express Request and Response Pipeline
    const mockReq = {
      user: { tenantId: 'org-123' },
      traceId: 'trace-456',
    } as unknown as Parameters<typeof controller.chat>[1];

    // Use a real PassThrough stream to capture actual data
    const passThrough = new PassThrough();
    const chunks: Buffer[] = [];

    passThrough.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    const mockRes = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      end: vi.fn(),
      write: passThrough.write.bind(passThrough),
      on: passThrough.on.bind(passThrough),
      once: passThrough.once.bind(passThrough),
      emit: passThrough.emit.bind(passThrough),
      pipe: passThrough.pipe.bind(passThrough),
    } as unknown as Response;

    await controller.chat(
      { messages: [] },
      mockReq,
      mockRes as unknown as Parameters<typeof controller.chat>[2],
    );

    // Wait for stream completion
    await new Promise<void>((resolve) => {
      passThrough.on('end', resolve);
      passThrough.end();
    });

    expect(orchestratorService.streamChat).toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain; charset=utf-8');
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Custom-Header', 'test-value');

    // Verify actual streamed data
    const receivedData = Buffer.concat(chunks).toString('utf-8');
    expect(receivedData).toBe('Test Stream Chunk');
  });
});