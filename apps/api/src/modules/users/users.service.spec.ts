import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { IdentityProvider } from '../auth/identity-provider.abstract';
import { DRIZZLE_DB } from '../../db/db.provider';
import { CreateUser } from './users.validation';

// Define Mock Drizzle Interface (Same pattern as TenantsService)
interface MockDrizzle {
  select: jest.Mock;
  from: jest.Mock;
  innerJoin: jest.Mock;
  where: jest.Mock;
  execute: jest.Mock;
}

// Instantiate with type safety
const mockDb: MockDrizzle = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  execute: jest.fn(),
};

const mockIdentityProvider = {
  createUser: jest.fn(),
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: IdentityProvider, useValue: mockIdentityProvider },
        { provide: DRIZZLE_DB, useValue: mockDb },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should call identityProvider.createUser', async () => {
      const dto: CreateUser = {
        email: 'test@example.com',
        password: 'password',
      };
      mockIdentityProvider.createUser.mockResolvedValue({ id: '1', ...dto });

      await service.create(dto);

      expect(mockIdentityProvider.createUser).toHaveBeenCalledWith(dto);
    });
  });

  describe('findAll', () => {
    it('should return empty array if no tenantId provided', async () => {
      const result = await service.findAll(undefined);
      expect(result).toEqual([]);
    });

    it('should query db if tenantId is provided', async () => {
      mockDb.execute.mockResolvedValue([]);

      const result = await service.findAll('tenant-1');

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.innerJoin).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });
});
