/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unused-vars, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { DataExplorerService } from './data-explorer.service.js';
import { PinoLogger } from 'nestjs-pino';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { StorageResolverService } from '@nexiom/engine';
import { NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('DataExplorerService', () => {
  let service: DataExplorerService;
  let db: any;
  let storageResolver: any;
  let logger: any;

  beforeEach(async () => {
    logger = { setContext: vi.fn(), log: vi.fn(), error: vi.fn() };

    db = {
      query: {
        integrationStitches: {
          findFirst: vi.fn(),
        },
      },
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockResolvedValue([]),
      transaction: vi.fn().mockImplementation(async (cb) => {
        const tx = {
          execute: vi.fn(),
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          offset: vi.fn().mockResolvedValue([]),
        };
        // Mock the Promise.all array response shape for [rows, count]
        tx.offset = vi.fn().mockResolvedValue([]);
        // For count
        tx.where = vi.fn().mockReturnThis();

        // Override tx.select to handle the count(*) case separately if needed
        const selectMock = vi.fn().mockReturnThis();
        tx.select = selectMock;

        return cb(tx);
      }),
    };

    storageResolver = {
      resolveSchemaName: vi.fn().mockResolvedValue('ws_1'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataExplorerService,
        { provide: PinoLogger, useValue: logger },
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: StorageResolverService, useValue: storageResolver },
      ],
    }).compile();

    service = module.get<DataExplorerService>(DataExplorerService);
  });

  describe('resolveStitch', () => {
    it('should throw NotFoundException if stitch is missing', async () => {
      db.query.integrationStitches.findFirst.mockResolvedValue(null);
      await expect(
        service.listInbound('org_1', 'stitch_1', 1, 10),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listInbound', () => {
    it('should return paginated inbound gateway data', async () => {
      db.query.integrationStitches.findFirst.mockResolvedValue({
        id: 'stitch_1',
        srcConnectionId: 'c1',
        destConnectionId: 'c2',
      });
      db.transaction.mockImplementationOnce(async (cb: any) => {
        const tx = {
          execute: vi.fn(),
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          offset: vi.fn().mockResolvedValue([{ id: 'inbound_1' }]), // rows mock
        };
        // Quick override for the count array
        tx.select = vi.fn().mockImplementation((args) => {
          if (args && args.count) {
            return {
              from: () => ({ where: () => Promise.resolve([{ count: 1 }]) }),
            };
          }
          return tx;
        });
        return cb(tx);
      });

      const res = await service.listInbound('org_1', 'stitch_1', 1, 50, 'ws_1');
      expect(res.data).toEqual([{ id: 'inbound_1' }]);
      expect(res.total).toBe(1);
      expect(res.page).toBe(1);
    });
  });

  describe('listReplica', () => {
    it('should return paginated replica data', async () => {
      db.query.integrationStitches.findFirst.mockResolvedValue({
        id: 'stitch_1',
        srcConnectionId: 'c1',
        destConnectionId: 'c2',
      });
      db.transaction.mockImplementationOnce(async (cb: any) => {
        const tx = {
          execute: vi.fn(),
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          offset: vi.fn().mockResolvedValue([{ id: 'replica_1' }]), // rows mock
        };
        const originalSelect = tx.select;
        tx.select = vi.fn().mockImplementation((args) => {
          if (args && args.count) {
            return {
              from: () => ({ where: () => Promise.resolve([{ count: 2 }]) }),
            };
          }
          return tx;
        });
        return cb(tx);
      });

      const res = await service.listReplica('org_1', 'stitch_1', 1, 50, 'ws_1');
      expect(res.data).toEqual([{ id: 'replica_1' }]);
      expect(res.total).toBe(2);
    });
  });

  describe('listNormalized', () => {
    it('should return paginated normalized data', async () => {
      db.query.integrationStitches.findFirst.mockResolvedValue({
        id: 'stitch_1',
        srcConnectionId: 'c1',
        destConnectionId: 'c2',
      });
      db.transaction.mockImplementationOnce(async (cb: any) => {
        const tx = {
          execute: vi.fn(),
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          offset: vi.fn().mockResolvedValue([{ id: 'norm_1' }]), // rows mock
        };
        const originalSelect = tx.select;
        tx.select = vi.fn().mockImplementation((args) => {
          if (args && args.count) {
            return { from: () => Promise.resolve([{ count: 3 }]) };
          }
          return tx;
        });
        return cb(tx);
      });

      const res = await service.listNormalized(
        'org_1',
        'stitch_1',
        2,
        50,
        'ws_1',
      );
      expect(res.data).toEqual([{ id: 'norm_1' }]);
      expect(res.total).toBe(3);
      expect(res.page).toBe(2);
    });
  });

  describe('listEntityMap', () => {
    it('should return paginated gem data', async () => {
      db.query.integrationStitches.findFirst.mockResolvedValue({
        id: 'stitch_1',
        srcConnectionId: 'c1',
        destConnectionId: 'c2',
      });

      const originalSelect = db.select;
      db.select = vi.fn().mockImplementation((args) => {
        if (args && args.count) {
          return {
            from: () => ({ where: () => Promise.resolve([{ count: 4 }]) }),
          };
        }
        return db;
      });
      db.offset.mockResolvedValueOnce([{ id: 'gem_1' }]);

      const res = await service.listEntityMap(
        'org_1',
        'stitch_1',
        1,
        50,
        'ws_1',
      );
      expect(res.data).toEqual([{ id: 'gem_1' }]);
      expect(res.total).toBe(4);
    });
  });

  describe('listOutbound', () => {
    it('should return paginated outbound gateway data', async () => {
      db.query.integrationStitches.findFirst.mockResolvedValue({
        id: 'stitch_1',
        srcConnectionId: 'c1',
        destConnectionId: 'c2',
      });
      db.transaction.mockImplementationOnce(async (cb: any) => {
        const tx = {
          execute: vi.fn(),
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          offset: vi.fn().mockResolvedValue([{ id: 'outbound_1' }]), // rows mock
        };
        const originalSelect = tx.select;
        tx.select = vi.fn().mockImplementation((args) => {
          if (args && args.count) {
            return {
              from: () => ({ where: () => Promise.resolve([{ count: 5 }]) }),
            };
          }
          return tx;
        });
        return cb(tx);
      });

      const res = await service.listOutbound('org_1', 'stitch_1', 1, 50); // no workspaceId
      expect(res.data).toEqual([{ id: 'outbound_1' }]);
      expect(res.total).toBe(5);
    });
  });
});