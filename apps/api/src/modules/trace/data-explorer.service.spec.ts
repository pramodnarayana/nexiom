/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unused-vars, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { DataExplorerService } from './data-explorer.service.js';
import { PinoLogger } from 'nestjs-pino';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { DB_MANAGER } from '@nexiom/dbmanager';
import { StorageResolverService } from '@nexiom/engine';
import { NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('DataExplorerService', () => {
  let service: DataExplorerService;
  let db: any;
  let storageResolver: any;
  let logger: any;
  let dbManager: any;

  const mockPageSelect = (rows: any[], count: number, hasWhere: boolean) => {
    let callCount = 0;
    const selectMock = vi.fn().mockImplementation((args?: any) => {
      callCount++;
      const isCountQuery = args && args.count !== undefined;
      const isStatusQuery = args && args.status !== undefined;

      const chain: any = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue(rows),
        getSQL: vi.fn().mockReturnValue({ sql: '', params: [] }), // for Drizzle subqueries
      };

      if (isCountQuery) {
        if (hasWhere) {
          chain.where = vi.fn().mockResolvedValue([{ count }]);
        } else {
          chain.from = vi.fn().mockResolvedValue([{ count }]);
        }
      } else if (isStatusQuery) {
        chain.where = vi
          .fn()
          .mockResolvedValue([{ traceId: 'dummy', status: 'SUCCESS' }]);
      }

      return chain;
    });

    dbManager.getTenantDb.mockResolvedValue({
      select: selectMock,
    });
  };

  beforeEach(async () => {
    logger = { setContext: vi.fn(), log: vi.fn(), error: vi.fn() };

    db = {
      query: {
        integrationStitches: {
          findFirst: vi.fn(),
        },
      },
      select: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockResolvedValue([]),
      transaction: vi.fn().mockImplementation(async (cb) => {
        const tx = {
          execute: vi.fn(),
          select: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
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
      resolveStorageProfile: vi.fn().mockResolvedValue({
        schemaName: 'ws_salesforce_abc',
        tenantId: 'tenant-1',
      }),
    };

    dbManager = {
      getTenantDb: vi.fn().mockResolvedValue({
        transaction: vi
          .fn()
          .mockImplementationOnce(async (cb: any) => {
            // First call: data rows query
            const tx = {
              execute: vi.fn(),
              select: vi.fn().mockReturnThis(),
              innerJoin: vi.fn().mockReturnThis(),
              leftJoin: vi.fn().mockReturnThis(),
              from: vi.fn().mockReturnThis(),
              where: vi.fn().mockReturnThis(),
              orderBy: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              offset: vi.fn().mockResolvedValue([{ id: 'gem_1' }]),
            };
            return cb(tx);
          })
          .mockImplementationOnce(async (cb: any) => {
            // Second call: count query
            const tx = {
              execute: vi.fn(),
              select: vi.fn().mockReturnThis(),
              innerJoin: vi.fn().mockReturnThis(),
              leftJoin: vi.fn().mockReturnThis(),
              from: vi.fn().mockReturnThis(),
              where: vi.fn().mockResolvedValue([{ count: 4 }]),
              orderBy: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              offset: vi.fn().mockResolvedValue([]),
            };
            return cb(tx);
          }),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataExplorerService,
        { provide: PinoLogger, useValue: logger },
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: StorageResolverService, useValue: storageResolver },
        {
          provide: DB_MANAGER,
          useValue: dbManager,
        },
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
        srcDataSourceId: 'c1',
        destDataSourceId: 'c2',
      });
      mockPageSelect([{ id: 'inbound_1' }], 1, true);

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
        srcDataSourceId: 'c1',
        destDataSourceId: 'c2',
      });
      mockPageSelect([{ id: 'replica_1' }], 2, true);

      const res = await service.listReplica('org_1', 'stitch_1', 1, 50, 'ws_1');
      expect(res.data).toEqual([{ id: 'replica_1' }]);
      expect(res.total).toBe(2);
    });
  });

  describe('listNormalized', () => {
    it('should return paginated normalized data', async () => {
      db.query.integrationStitches.findFirst.mockResolvedValue({
        id: 'stitch_1',
        srcDataSourceId: 'c1',
        destDataSourceId: 'c2',
      });
      mockPageSelect([{ id: 'norm_1' }], 3, true);

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
        srcDataSourceId: 'c1',
        destDataSourceId: 'c2',
      });

      // Provide select mock directly on tenantDb
      dbManager.getTenantDb.mockResolvedValue({
        select: vi.fn().mockImplementation((args?: any) => {
          const isCount = args && args.count !== undefined;
          if (isCount) {
            return {
              from: vi.fn().mockReturnThis(),
              where: vi.fn().mockResolvedValue([{ count: 4 }]),
            };
          }
          return {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            offset: vi.fn().mockResolvedValue([{ id: 'gem_1' }]),
          };
        }),
      });

      const res = await service.listEntityMap(
        'org_1',
        'stitch_1',
        1,
        50,
        'ws_1',
      );
      expect(Array.isArray(res.data)).toBe(true);
      expect(typeof res.total).toBe('number');
      expect(res.page).toBe(1);
    });
  });

  describe('listOutbound', () => {
    it('should return paginated outbound gateway data', async () => {
      db.query.integrationStitches.findFirst.mockResolvedValue({
        id: 'stitch_1',
        srcDataSourceId: 'c1',
        destDataSourceId: 'c2',
      });
      mockPageSelect([{ id: 'outbound_1' }], 5, true);

      const res = await service.listOutbound('org_1', 'stitch_1', 1, 50); // no workspaceId
      expect(res.data).toEqual([{ id: 'outbound_1' }]);
      expect(res.total).toBe(5);
    });
  });

  describe('getTrace', () => {
    it('should return a trace by id', async () => {
      db.query.integrationStitches.findFirst.mockResolvedValue({
        id: 'stitch_1',
        srcDataSourceId: 'c1',
        destDataSourceId: 'c2',
      });

      vi.spyOn(service as any, 'attachTraceStatuses').mockResolvedValue(
        undefined,
      );

      const tracePayload = {
        inbound: { traceId: 't1', status: 'SUCCESS' },
        replica: { traceId: 't1', status: 'SUCCESS' },
        normalized: { traceId: 't1', status: 'SUCCESS' },
        gem: { traceId: 't1', status: 'SUCCESS' },
        outbound: { traceId: 't1', status: 'SUCCESS' },
      };

      // We don't have to perfectly mock the physical multi-tenancy chained calls
      // because getTrace runs numerous subqueries, we'll just mock the main transaction
      // and ensure the mock structure doesn't crash the method and returns the final mapped output.
      dbManager.getTenantDb.mockResolvedValue({
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi
            .fn()
            .mockResolvedValue([{ traceId: 't1', status: 'SUCCESS' }]),
        })),
        transaction: vi.fn().mockImplementation(async (cb) => {
          const tx = {
            select: vi.fn().mockImplementation(() => {
              return {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                limit: vi
                  .fn()
                  .mockResolvedValue([{ traceId: 't1', status: 'SUCCESS' }]),
              };
            }),
          };
          return cb(tx);
        }),
      });

      const res = await service.getTrace('org_1', 'stitch_1', 't1');
      expect(res).toBeDefined();
      expect(res.layers).toBeDefined();
      expect(res.layers.l1).toBeDefined();
      expect(res.layers.l1?.traceId).toBe('t1');
      expect(res.layers.l1?.status).toBe('SUCCESS');
    });
  });

  describe('listObjectsByStitch', () => {
    it('should list specific object types', async () => {
      db.query.integrationStitches.findFirst.mockResolvedValue({
        id: 'stitch_1',
        srcDataSourceId: 'c1',
        destDataSourceId: 'c2',
      });

      // Mock db returns objectTypes natively via distinct query
      const distinctChain: any = {
        where: vi.fn().mockResolvedValue([{ type: 'Account' }]),
      };
      distinctChain.from = vi.fn().mockReturnValue(distinctChain);

      const selectChain: any = {
        where: vi.fn().mockReturnThis(),
        getSQL: vi.fn().mockReturnValue({ sql: '', params: [] }),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue([]),
      };
      selectChain.from = vi.fn().mockReturnValue(selectChain);

      dbManager.getTenantDb.mockResolvedValue({
        select: vi.fn().mockReturnValue(selectChain),
        selectDistinct: vi.fn().mockReturnValue(distinctChain),
      });

      const res = await service.listObjectsByStitch(
        'org_1',
        'stitch_1',
        'normalized',
      );
      expect(res).toEqual(['Account']);
    });

    it('should list specific object types for outbound tab', async () => {
      db.query.integrationStitches.findFirst.mockResolvedValue({
        id: 'stitch_1',
        srcDataSourceId: 'c1',
        destDataSourceId: 'c2',
      });
      const distinctChain: any = {
        where: vi.fn().mockResolvedValue([{ type: 'Contact' }]),
      };
      distinctChain.from = vi.fn().mockReturnValue(distinctChain);

      dbManager.getTenantDb.mockResolvedValue({
        selectDistinct: vi.fn().mockReturnValue(distinctChain),
      });

      const res = await service.listObjectsByStitch(
        'org_1',
        'stitch_1',
        'outbound',
      );
      expect(res).toEqual([]);
    });

    it('should list specific object types for entity-map tab', async () => {
      db.query.integrationStitches.findFirst.mockResolvedValue({
        id: 'stitch_1',
        srcDataSourceId: 'c1',
        destDataSourceId: 'c2',
      });
      const distinctChain: any = {
        where: vi.fn().mockResolvedValue([{ type: 'Lead' }]),
      };
      distinctChain.from = vi.fn().mockReturnValue(distinctChain);

      dbManager.getTenantDb.mockResolvedValue({
        selectDistinct: vi.fn().mockReturnValue(distinctChain),
      });

      const res = await service.listObjectsByStitch(
        'org_1',
        'stitch_1',
        'entity-map',
      );
      expect(res).toEqual(['Lead']);
    });
  });
});
