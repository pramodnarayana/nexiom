import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { CapacityManagerService } from './capacity-manager.service.js';
import { DATABASE_CONNECTION } from '@soopa/database';
import { QueueService, QueueName } from '@soopa/queue';
import { Logger } from '@nestjs/common';

describe('CapacityManagerService', () => {
  let service: CapacityManagerService;
  let mockDb: { execute: ReturnType<typeof vi.fn> };
  let mockQueueService: { send: ReturnType<typeof vi.fn> };
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let module: import('@nestjs/testing').TestingModule;

  beforeEach(async () => {
    mockDb = {
      execute: vi.fn(),
    };

    mockQueueService = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    module = await Test.createTestingModule({
      providers: [
        CapacityManagerService,
        { provide: DATABASE_CONNECTION, useValue: mockDb },
        { provide: QueueService, useValue: mockQueueService },
      ],
    }).compile();

    service = module.get(CapacityManagerService);

    // Silence logger during tests
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
    errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb';
  });

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  describe('replenishPool', () => {
    it('does nothing if the pool is fully provisioned (count >= 5)', async () => {
      // Mock countWarm to return 5
      mockDb.execute.mockResolvedValueOnce({ rows: [{ count: '5' }] });

      await service.replenishPool();

      // Should check the count
      expect(mockDb.execute).toHaveBeenCalledTimes(1);

      // Should NOT insert or queue anything
      expect(mockQueueService.send).not.toHaveBeenCalled();
    });

    it('dispatches jobs and inserts INITIALIZING rows for the deficit', async () => {
      // Mock countWarm to return 3 (deficit = 2)
      mockDb.execute.mockResolvedValueOnce({ rows: [{ count: '3' }] });

      // Mock the two INSERT executions
      mockDb.execute.mockResolvedValue({ rowCount: 1 });

      await service.replenishPool();

      // 1 select count + 2 inserts = 3 DB calls
      expect(mockDb.execute).toHaveBeenCalledTimes(3);

      // Should dispatch 2 queue messages
      expect(mockQueueService.send).toHaveBeenCalledTimes(2);
      expect(mockQueueService.send).toHaveBeenCalledWith(
        QueueName.TenantProvisionQueue,
        expect.objectContaining({
          poolSlotId: expect.any(String) as unknown as string,
          hostUrl: expect.any(String) as unknown as string,
        }),
      );
    });

    it('handles count string conversion correctly even if null', async () => {
      // Mock countWarm to return null/undefined (fallback to '0')
      mockDb.execute.mockResolvedValueOnce({ rows: [{ count: null }] });

      // Mock the 5 INSERT executions
      mockDb.execute.mockResolvedValue({ rowCount: 1 });

      await service.replenishPool();

      // Should dispatch 5 queue messages
      expect(mockQueueService.send).toHaveBeenCalledTimes(5);
    });

    it('catches and logs errors without crashing the cron job', async () => {
      // Simulate database failure
      const error = new Error('Database down');
      mockDb.execute.mockRejectedValue(error);

      // Should not throw
      await expect(service.replenishPool()).resolves.toBeUndefined();

      // Ensure error was logged
      expect(errorSpy).toHaveBeenCalledWith(
        'CapacityManager: pool replenishment failed',
        error,
      );
    });
  });
});
