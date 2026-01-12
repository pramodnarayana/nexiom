import { Test, TestingModule } from '@nestjs/testing';
import { TenantsService } from './tenants.service';
import { DRIZZLE_DB } from '../../db/db.provider';
import { Organization } from './tenant.schema';

const mockOrganizations: Organization[] = [
  {
    id: '1',
    name: 'Test Org 1',
    slug: 'test-org-1',
    logo: null,
    createdAt: new Date(),
    metadata: null,
    status: 'active',
  },
  {
    id: '2',
    name: 'Test Org 2',
    slug: 'test-org-2',
    logo: null,
    createdAt: new Date(),
    metadata: null,
    status: 'disabled',
  },
];

// Define a type for our mock that satisfies the functionality we use
// We don't try to implement the full NodePgDatabase interface as it's too complex to mock fully manually
interface MockDrizzle {
  select: jest.Mock;
  from: jest.Mock;
  where: jest.Mock;
  limit: jest.Mock;
  execute: jest.Mock;
  insert: jest.Mock;
  values: jest.Mock;
  returning: jest.Mock;
  transaction: jest.Mock;
  update: jest.Mock;
  set: jest.Mock;

  query: MockQuery;
}

interface MockQuery {
  user: {
    findFirst: jest.Mock;
  };
}

// Instantiate with type safety
const mockDb: MockDrizzle = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  execute: jest.fn(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  returning: jest.fn(),
  transaction: jest.fn(), // Placeholder, implementation below to avoid circular ref
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  query: {
    user: {
      findFirst: jest.fn(),
    },
  },
};

// Implement circular transaction logic safely
mockDb.transaction.mockImplementation(
  (cb: (tx: MockDrizzle) => Promise<unknown>) => {
    return cb(mockDb);
  },
);

describe('TenantsService', () => {
  let service: TenantsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsService,
        {
          provide: DRIZZLE_DB,
          useValue: mockDb,
        },
      ],
    }).compile();

    service = module.get<TenantsService>(TenantsService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all tenants', async () => {
      mockDb.execute.mockResolvedValue(mockOrganizations);

      const result = await service.findAll();

      expect(result).toEqual(mockOrganizations);
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('should update tenant status', async () => {
      const updatedOrg = { ...mockOrganizations[0], status: 'disabled' };
      mockDb.returning.mockResolvedValue([updatedOrg]);

      const result = await service.updateStatus('1', 'disabled');

      expect(result).toEqual(updatedOrg);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should throw error if tenant not found', async () => {
      mockDb.returning.mockResolvedValue([]);

      await expect(service.updateStatus('999', 'disabled')).rejects.toThrow();
    });
  });

  describe('createTenant', () => {
    it('should create organization and member transactionally', async () => {
      const newOrg = { ...mockOrganizations[0] };
      // specialized mocks for tx
      mockDb.returning.mockResolvedValueOnce([newOrg]); // for org insert
      // member insert doesn't return anything we check explicitly here,
      // but the tx should return the org.

      const result = await service.createTenant('user-1', 'Test Corp');

      expect(result).toEqual(newOrg);
      expect(mockDb.transaction).toHaveBeenCalled();
      expect(mockDb.insert).toHaveBeenCalledTimes(2); // Org + Member
    });
  });

  describe('provisionTenantForUser', () => {
    it('should provision a tenant with generated name', async () => {
      const mockUser = { id: 'user-1', email: 'test@example.com' };
      const newOrg = { ...mockOrganizations[0], name: 'Organization X' };

      // Mock user lookup
      mockDb.query.user.findFirst.mockResolvedValueOnce(mockUser);

      // Mock createTenant tx
      mockDb.returning.mockResolvedValueOnce([newOrg]); // Org insert

      const result = await service.provisionTenantForUser('user-1');

      expect(mockDb.query.user.findFirst).toHaveBeenCalled(); // User lookup
      expect(mockDb.transaction).toHaveBeenCalled(); // createTenant
      expect(result).toEqual(newOrg);
    });

    it('should throw if user not found', async () => {
      mockDb.query.user.findFirst.mockResolvedValueOnce(null); // No user

      await expect(
        service.provisionTenantForUser('user-999'),
      ).rejects.toThrow();
    });
  });
});
