import { Test, TestingModule } from '@nestjs/testing';
import { TenantOffboardingService } from './tenant-offboarding.service.js';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { vi, type Mock } from 'vitest';
import type { SQL } from 'drizzle-orm';

export type MockDb = {
  select: Mock;
  from: Mock;
  where: Mock;
  limit: Mock;
  execute: Mock;
  transaction: Mock;
  delete?: Mock;
};

describe('TenantOffboardingService', () => {
  let service: TenantOffboardingService;
  let db: MockDb;

  beforeEach(async () => {
    db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
      limit: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue({}),
      transaction: vi.fn((cb: (tx: any) => void) =>
        cb({
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([{ id: 'test-tenant' }]),
          delete: vi.fn().mockReturnThis(),
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantOffboardingService,
        { provide: DATABASE_CONNECTION, useValue: db },
      ],
    }).compile();

    service = module.get<TenantOffboardingService>(TenantOffboardingService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should perform hard deletion of schemas and logical cascade', async () => {
    // First query: get connections for tenant
    db.where.mockResolvedValueOnce([{ id: 'conn-1' }]);
    // Second query: get registry for connection
    db.where.mockResolvedValueOnce([
      { connectionId: 'conn-1', dataNamespace: 'ws_test_schema' },
    ]);

    await service.offboardTenant('test-tenant');

    expect(db.execute).toHaveBeenCalled();
    expect(db.transaction).toHaveBeenCalledTimes(1);

    // Assert that the SQL passed to db.execute contains DROP SCHEMA for the test schema.
    // db.execute receives a Drizzle SQL object whose text lives in queryChunks:
    //   StringChunk → .value: string[]   (raw SQL fragments)
    //   Name        → .value: string     (sql.identifier result, i.e. the schema name)
    const executeCall = db.execute.mock.calls[0][0] as unknown as SQL;
    const sqlString = (
      executeCall?.queryChunks as Array<{ value?: string | string[] }>
    )
      .flatMap((chunk) =>
        Array.isArray(chunk.value) ? chunk.value : [chunk.value ?? ''],
      )
      .join('');
    expect(sqlString).toMatch(/DROP SCHEMA/i);
    expect(sqlString).toMatch(/ws_test_schema/);
    expect(sqlString).toMatch(/CASCADE/i);
  });

  it('should handle schema drop errors gracefully without halting', async () => {
    // First query: get connections for tenant
    db.where.mockResolvedValueOnce([{ id: 'conn-1' }]);
    // Second query: get registry for connection
    db.where.mockResolvedValueOnce([
      { connectionId: 'conn-1', dataNamespace: 'ws_test_schema' },
    ]);

    db.execute.mockRejectedValueOnce(new Error('PG Connection Dead'));

    const loggerSpy = vi.spyOn(service['logger'], 'error');

    await expect(service.offboardTenant('test-tenant')).resolves.not.toThrow();
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed dropping schema'),
      expect.any(Error),
    );

    loggerSpy.mockRestore();
  });

  it('should throw when organization does not exist', async () => {
    // First query: get connections for tenant (empty)
    db.where.mockResolvedValueOnce([]);

    // Mock transaction to return empty array for organization check
    db.transaction.mockImplementationOnce((cb: (tx: any) => void) =>
      cb({
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockReturnThis(),
      }),
    );

    await expect(service.offboardTenant('non-existent')).rejects.toThrow(
      'Organization non-existent not found',
    );
  });

  it('should handle tenant with multiple connections', async () => {
    // First query: get connections for tenant - return multiple connections
    db.where.mockResolvedValueOnce([{ id: 'conn-1' }, { id: 'conn-2' }]);
    // Second query: get registries for all connections
    db.where.mockResolvedValueOnce([
      { connectionId: 'conn-1', dataNamespace: 'ws_schema_1' },
      { connectionId: 'conn-2', dataNamespace: 'ws_schema_2' },
    ]);

    await service.offboardTenant('test-tenant');

    // Assert db.execute called for each namespace (schema drop)
    expect(db.execute).toHaveBeenCalledTimes(2);
    // Assert transaction invoked once for logical deletion
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('should handle tenant with some connections missing registry entries', async () => {
    // First query: get connections for tenant
    db.where.mockResolvedValueOnce([{ id: 'conn-1' }, { id: 'conn-2' }]);
    // Second query: get registries for all connections (only conn-1 has one)
    db.where.mockResolvedValueOnce([
      { connectionId: 'conn-1', dataNamespace: 'ws_schema_1' },
    ]);

    // Should resolve without throwing
    await expect(service.offboardTenant('test-tenant')).resolves.not.toThrow();

    // Assert db.execute called only for existing namespace (conn-1)
    expect(db.execute).toHaveBeenCalledTimes(1);
    // Assert transaction still invoked for logical deletion
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
});
