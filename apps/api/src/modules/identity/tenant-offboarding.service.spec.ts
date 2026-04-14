import { Test, TestingModule } from '@nestjs/testing';
import { TenantOffboardingService } from './tenant-offboarding.service.js';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { vi, type Mock } from 'vitest';

export type MockDb = {
  select: Mock;
  from: Mock;
  where: Mock;
  limit: Mock;
  execute: Mock;
  transaction: Mock;
};

describe('TenantOffboardingService', () => {
  let service: TenantOffboardingService;
  let db: MockDb;

  beforeEach(async () => {
    db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue({}),
      transaction: vi.fn((cb: (tx: { delete: Mock; where: Mock }) => void) =>
        cb({ delete: vi.fn().mockReturnThis(), where: vi.fn() }),
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
    db.limit.mockResolvedValueOnce([{ id: 'conn-1' }]);
    // Second query: get registry for connection
    db.limit.mockResolvedValueOnce([{ dataNamespace: 'ws_test_schema' }]);

    await service.offboardTenant('test-tenant');

    expect(db.execute).toHaveBeenCalled();
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('should handle schema drop errors gracefully without halting', async () => {
    // First query: get connections for tenant
    db.limit.mockResolvedValueOnce([{ id: 'conn-1' }]);
    // Second query: get registry for connection
    db.limit.mockResolvedValueOnce([{ dataNamespace: 'ws_test_schema' }]);

    db.execute.mockRejectedValueOnce(new Error('PG Connection Dead'));

    await expect(service.offboardTenant('test-tenant')).resolves.not.toThrow();
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
});