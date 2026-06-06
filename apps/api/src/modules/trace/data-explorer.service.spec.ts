/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { DataExplorerService } from './data-explorer.service.js';
import { PinoLogger } from 'nestjs-pino';
import { DATABASE_CONNECTION } from '@soopa/database';
import { DB_MANAGER } from '@soopa/dbmanager';
import { StorageResolverService } from '@soopa/engine';
import { TraceService } from './trace.service.js';
import { NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('DataExplorerService', () => {
  let service: DataExplorerService;
  let db: any;
  let storageResolver: any;
  let logger: any;
  let dbManager: any;
  let module: TestingModule;

  const mockPageSelect = (rows: any[], count: number, hasWhere: boolean) => {
    let callCount = 0;
    const selectMock = vi.fn().mockImplementation((args?: any) => {
      callCount++;
      const isCountQuery = args && args.count !== undefined;
      const isStatusQuery = args && args.status !== undefined;

      const chain: any = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
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

    module = await Test.createTestingModule({
      providers: [
        DataExplorerService,
        { provide: PinoLogger, useValue: logger },
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: StorageResolverService, useValue: storageResolver },
        {
          provide: DB_MANAGER,
          useValue: dbManager,
        },
        {
          provide: TraceService,
          useValue: {
            getTrace: vi.fn(),
            listTraces: vi.fn(),
            resolveSourceConnectionForStitch: vi.fn().mockResolvedValue('c1'),
          },
        },
      ],
    }).compile();

    service = module.get<DataExplorerService>(DataExplorerService);
  });

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });
  describe('listConnectionInbound', () => {
    it('should return paginated inbound data for a connection', async () => {
      mockPageSelect([{ id: 'inbound_1' }], 1, true);
      const res = await service.listConnectionInbound('org_1', 'conn_1', 1, 50);
      expect(res.data).toEqual([{ id: 'inbound_1' }]);
      expect(res.total).toBe(1);
    });
  });

  describe('listConnectionReplica', () => {
    it('should return paginated replica data for a connection', async () => {
      mockPageSelect([{ id: 'replica_1' }], 2, true);
      const res = await service.listConnectionReplica('org_1', 'conn_1', 1, 50);
      expect(res.data).toEqual([{ id: 'replica_1' }]);
      expect(res.total).toBe(2);
    });
  });

  describe('listConnectionNormalized', () => {
    it('should return paginated normalized data for a connection', async () => {
      mockPageSelect([{ id: 'norm_1' }], 3, true);
      const res = await service.listConnectionNormalized(
        'org_1',
        'conn_1',
        1,
        50,
      );
      expect(res.data).toEqual([{ id: 'norm_1' }]);
      expect(res.total).toBe(3);
    });
  });

  describe('listConnectionOutbound', () => {
    it('should return paginated outbound data for a connection', async () => {
      mockPageSelect([{ id: 'outbound_1' }], 4, true);
      const res = await service.listConnectionOutbound(
        'org_1',
        'conn_1',
        1,
        50,
      );
      expect(res.data).toEqual([{ id: 'outbound_1' }]);
      expect(res.total).toBe(4);
    });
  });

  describe('getConnectionTrace', () => {
    it('should return null for missing trace components', async () => {
      dbManager.getTenantDb.mockResolvedValue({
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([]), // Return empty array
        })),
      });

      const res = await service.getConnectionTrace(
        'org_1',
        'conn_1',
        'missing_t1',
      );
      expect(res.inbound).toBeNull();
      expect(res.replica).toBeNull();
      expect(res.normalized).toBeNull();
      expect(res.outbound).toBeNull();
    });

    it('should return a connection trace', async () => {
      dbManager.getTenantDb.mockResolvedValue({
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([{ id: 't1' }]),
        })),
      });

      const res = await service.getConnectionTrace('org_1', 'conn_1', 't1');
      expect(res.inbound).toBeDefined();
      expect(res.replica).toBeDefined();
      expect(res.normalized).toBeDefined();
      expect(res.outbound).toBeDefined();
    });
  });

  describe('listTraceRoutes', () => {
    it('should return routes for a trace', async () => {
      dbManager.getTenantDb.mockResolvedValue({
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([{ routeId: 'route_1' }]),
        })),
      });

      const res = await service.listTraceRoutes('org_1', 'conn_1', 't1');
      expect(res).toEqual(['route_1']);
    });
  });

  describe('listObjectsByConnection', () => {
    it('should handle null types by defaulting to Uncategorized', async () => {
      dbManager.getTenantDb.mockResolvedValue({
        selectDistinct: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([{ type: null }]),
        })),
      });

      const res = await service.listObjectsByConnection(
        'org_1',
        'conn_1',
        'inbound',
      );
      expect(res).toEqual(['Uncategorized']);

      const resReplica = await service.listObjectsByConnection(
        'org_1',
        'conn_1',
        'replica',
      );
      expect(resReplica).toEqual(['Uncategorized']);

      dbManager.getTenantDb.mockResolvedValue({
        selectDistinct: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockResolvedValue([{ type: null }]),
        })),
      });
      const resNorm = await service.listObjectsByConnection(
        'org_1',
        'conn_1',
        'normalized',
      );
      expect(resNorm).toEqual(['Uncategorized']);
    });

    it('should list object types for a tab', async () => {
      dbManager.getTenantDb.mockResolvedValue({
        selectDistinct: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([{ type: 'Account' }]),
        })),
      });

      const res = await service.listObjectsByConnection(
        'org_1',
        'conn_1',
        'inbound',
      );
      expect(res).toEqual(['Account']);

      const resReplica = await service.listObjectsByConnection(
        'org_1',
        'conn_1',
        'replica',
      );
      expect(resReplica).toEqual(['Account']);

      dbManager.getTenantDb.mockResolvedValue({
        selectDistinct: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockResolvedValue([{ type: 'Contact' }]),
        })),
      });
      const resNorm = await service.listObjectsByConnection(
        'org_1',
        'conn_1',
        'normalized',
      );
      expect(resNorm).toEqual(['Contact']);

      const resEmpty = await service.listObjectsByConnection(
        'org_1',
        'conn_1',
        'invalid',
      );
      expect(resEmpty).toEqual([]);
    });
  });
});
