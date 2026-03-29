/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { ReplicaService } from './replica.service.js';
import { QueueService, QueueName } from '@nexiom/queue';
import { StorageResolverService } from '@nexiom/engine';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { getLoggerToken } from 'nestjs-pino';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('ReplicaService', () => {
  let service: ReplicaService;
  let queueServiceMock: any;
  let storageResolverMock: any;
  let dbMock: any;
  let txMock: any;

  beforeEach(async () => {
    queueServiceMock = {
      consume: vi.fn(),
      send: vi.fn(),
    };

    storageResolverMock = {
      resolveSchemaName: vi.fn().mockResolvedValue('ws_test123'),
    };

    txMock = {
      execute: vi.fn(),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([
        {
          traceId: '123-abc',
          status: 'RECEIVED',
          objectType: 'Contact',
          extReqId: 'ext-456',
          payload: { id: 'sf-789', name: 'Test' },
          createdAt: new Date().toISOString(),
        },
      ]),
      limit: vi.fn().mockResolvedValue([
        {
          traceId: '123-abc',
          status: 'RECEIVED',
          objectType: 'Contact',
          extReqId: 'ext-456',
          payload: { id: 'sf-789', name: 'Test' },
          createdAt: new Date().toISOString(),
        },
      ]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      onConflictDoNothing: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };

    dbMock = {
      transaction: vi.fn(async (cb) => cb(txMock)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReplicaService,
        {
          provide: getLoggerToken(ReplicaService.name),
          useValue: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            assign: vi.fn(),
          },
        },
        { provide: QueueService, useValue: queueServiceMock },
        { provide: StorageResolverService, useValue: storageResolverMock },
        { provide: DATABASE_CONNECTION, useValue: dbMock },
      ],
    }).compile();

    service = module.get<ReplicaService>(ReplicaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should start consuming InboundQueue', () => {
      service.onModuleInit();
      expect(queueServiceMock.consume).toHaveBeenCalledWith(
        QueueName.InboundQueue,
        expect.any(Function),
        { maxConcurrent: 5 },
      );
    });
  });

  describe('processMessage', () => {
    let processMessageFn: (msg: any) => Promise<void>;

    beforeEach(() => {
      service.onModuleInit();
      processMessageFn = queueServiceMock.consume.mock.calls[0][1];
    });

    it('should process a valid message and send to ReplicaQueue', async () => {
      await processMessageFn({ traceId: '123-abc', connectionId: 'conn-1' });

      expect(storageResolverMock.resolveSchemaName).toHaveBeenCalledWith(
        'conn-1',
      );
      expect(dbMock.transaction).toHaveBeenCalled();

      // Verify L1 fetched with atomic update
      expect(txMock.update).toHaveBeenCalled();
      expect(txMock.returning).toHaveBeenCalled();

      // Verify UPSERT Replica
      expect(txMock.insert).toHaveBeenCalled();
      expect(txMock.values).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'conn-1',
          traceId: '123-abc',
          entityType: 'Contact',
          sourceId: 'sf-789',
        }),
      );

      // Verify L2 audit insert directly (for syncLog)
      expect(txMock.insert).toHaveBeenCalledTimes(2);
      expect(txMock.values).toHaveBeenCalledWith(
        expect.objectContaining({
          traceId: '123-abc',
          layer: 'L2',
          status: 'PENDING',
          durationMs: expect.any(Number),
        }),
      );

      // Verify updates (Atomic PROCESSING -> REPLICATED -> syncLog SUCCESS)
      expect(txMock.update).toHaveBeenCalledTimes(3);
      expect(txMock.set).toHaveBeenCalledWith({ status: 'PROCESSING' });
      expect(txMock.set).toHaveBeenCalledWith({ status: 'REPLICATED' });
      expect(txMock.set).toHaveBeenCalledWith({ status: 'SUCCESS' });

      // Verify L2 send
      expect(queueServiceMock.send).toHaveBeenCalledWith(
        QueueName.ReplicaQueue,
        {
          traceId: '123-abc',
          connectionId: 'conn-1',
        },
      );
    });

    it('should throw if L1 record is missing', async () => {
      txMock.returning.mockResolvedValueOnce([]); // No records updated
      txMock.limit.mockResolvedValueOnce([]); // No records found fallback
      await expect(
        processMessageFn({ traceId: 'missing', connectionId: 'conn-1' }),
      ).rejects.toThrow('Inbound gateway record not found');
    });

    it('should return early if L1 record is already REPLICATED', async () => {
      txMock.returning.mockResolvedValueOnce([]); // No row updated (already handled)
      txMock.limit.mockResolvedValueOnce([
        { traceId: '123', status: 'REPLICATED' },
      ]);
      await processMessageFn({ traceId: '123', connectionId: 'conn-1' });
      expect(txMock.insert).not.toHaveBeenCalled();
      expect(queueServiceMock.send).not.toHaveBeenCalled();
    });
  });
});
