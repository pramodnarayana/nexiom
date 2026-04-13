/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { AiStreamController } from './ai-stream.controller.js';
import { PinoLogger } from 'nestjs-pino';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthGuard } from '@nexiom/auth';

describe('AiStreamController', () => {
  let controller: AiStreamController;
  let mockRedisClient: any;
  let mockSubscriber: any;
  let mockLogger: any;

  beforeEach(async () => {
    mockSubscriber = {
      subscribe: vi.fn(),
      on: vi.fn(),
      unsubscribe: vi.fn().mockResolvedValue(true),
      quit: vi.fn().mockResolvedValue(true),
    };

    mockRedisClient = {
      duplicate: vi.fn().mockReturnValue(mockSubscriber),
    };

    mockLogger = {
      setContext: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiStreamController],
      providers: [
        {
          provide: 'REDIS_CLIENT',
          useValue: mockRedisClient,
        },
        {
          provide: PinoLogger,
          useValue: mockLogger,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AiStreamController>(AiStreamController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('streamJob', () => {
    it('should connect to redis and forward messages via observable', () => {
      return new Promise<void>((resolve, reject) => {
        const jobId = 'test-job-123';
        const channel = `job:stream:${jobId}`;

        mockSubscriber.subscribe.mockImplementation((ch: string, cb: any) => {
          if (ch === channel) cb(null); // success
        });

        // We capture the onMessage callback so we can simulate receiving a message
        let onMessageCallback: any;
        mockSubscriber.on.mockImplementation((event: string, cb: any) => {
          if (event === 'message') {
            onMessageCallback = cb;
          }
        });

        const observable = controller.streamJob(jobId);
        const receivedData: any[] = [];

        observable.subscribe({
          next: (val) => receivedData.push(val),
          error: (err) =>
            reject(err instanceof Error ? err : new Error(String(err))),
          complete: () => {
            try {
              // Verify cleanup occurred on complete
              expect(mockSubscriber.unsubscribe).toHaveBeenCalledWith(channel);
              expect(mockSubscriber.quit).toHaveBeenCalled();
              expect(receivedData).toEqual([
                { data: 'hello' },
                { data: 'world' },
                { data: '0:"[DONE]"\n' },
              ]);
              resolve();
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          },
        });

        // Ensure duplicates were created
        expect(mockRedisClient.duplicate).toHaveBeenCalled();

        // Ensure handlers were assigned
        expect(onMessageCallback).toBeDefined();

        // Emulate redis messages arriving
        onMessageCallback(channel, 'hello');
        onMessageCallback(channel, 'world');
        onMessageCallback(channel, '0:"[DONE]"\n');
      });
    });

    it('should forward subscription errors', () => {
      return new Promise<void>((resolve, reject) => {
        const jobId = 'test-job-123';
        const channel = `job:stream:${jobId}`;
        const mockError = new Error('Redis sub error');

        mockSubscriber.subscribe.mockImplementation((ch: string, cb: any) => {
          if (ch === channel) cb(mockError); // error
        });

        const observable = controller.streamJob(jobId);

        observable.subscribe({
          next: () => {},
          error: (err) => {
            try {
              expect(err).toBe(mockError);
              expect(mockLogger.error).toHaveBeenCalled();
              resolve();
            } catch (e) {
              reject(e instanceof Error ? e : new Error(String(e)));
            }
          },
          complete: () => {
            reject(new Error('Should not complete normally'));
          },
        });
      });
    });

    it('should unsubscribe successfully upon early observable cleanup', () => {
      const jobId = 'test-job-123';

      mockSubscriber.subscribe.mockImplementation((_ch: string, cb: any) => {
        cb(null);
      });

      mockSubscriber.on.mockImplementation(() => {});

      const observable = controller.streamJob(jobId);
      const subscription = observable.subscribe();

      // Trigger observable disposal logic (early cleanup)
      subscription.unsubscribe();

      expect(mockSubscriber.unsubscribe).toHaveBeenCalledWith(
        `job:stream:${jobId}`,
      );
      expect(mockSubscriber.quit).toHaveBeenCalled();
    });
  });
});
