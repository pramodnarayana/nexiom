/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { IdentityProvider } from '../auth/identity-provider.abstract';
import { DRIZZLE_DB } from '../../db/db.provider';
import { CreateUser } from './users.validation';

// Define Mock Drizzle Interface
interface MockDrizzle {
  select: jest.Mock;
  from: jest.Mock;
  innerJoin: jest.Mock;
  where: jest.Mock;
  execute: jest.Mock;
}

describe('UsersService', () => {
  let service: UsersService;
  let identityProvider: jest.Mocked<IdentityProvider>;
  let db: MockDrizzle;

  beforeEach(async () => {
    // Strict Typed Mock for IdentityProvider
    const mockIdentityProvider = {
      createUser: jest.fn(),
      login: jest.fn(),
      validateSession: jest.fn(),
      getEnrichedSession: jest.fn(),
      createInvitation: jest.fn(),
      getInvitation: jest.fn(),
      acceptInvitation: jest.fn(),
      getHandler: jest.fn(),
    };

    const mockDb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: IdentityProvider, useValue: mockIdentityProvider },
        { provide: DRIZZLE_DB, useValue: mockDb },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    identityProvider = module.get(IdentityProvider);
    db = module.get(DRIZZLE_DB);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should successfully create a user', async () => {
      const newUser: CreateUser = {
        email: 'test@example.com',
        password: 'password',
        role: 'user',
      };
      const createdUser = {
        id: '1',
        ...newUser,
        name: 'Test User',
        emailVerified: false,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        banned: false,
        banReason: null,
        banExpires: null,
      };

      // Type-safe mock implementation
      identityProvider.createUser.mockResolvedValue(createdUser);

      const result = await service.create(newUser);

      expect(identityProvider.createUser).toHaveBeenCalledWith(newUser);
      expect(result).toEqual(createdUser);
    });

    it('should propagate error if identity provider fails', async () => {
      const newUser: CreateUser = {
        email: 'fail@example.com',
        role: 'user',
      };
      identityProvider.createUser.mockRejectedValue(new Error('IDP Error'));

      await expect(service.create(newUser)).rejects.toThrow('IDP Error');
    });
  });

  describe('findAll', () => {
    it('should return empty array if no tenantId provided', async () => {
      const result = await service.findAll(undefined);
      expect(result).toEqual([]);
      expect(db.select).not.toHaveBeenCalled();
    });

    it('should query db and return users if tenantId is provided', async () => {
      const tenantId = 'org-123';
      const mockUsers = [{ id: '1', name: 'User', role: 'admin' }];

      db.execute.mockResolvedValue(mockUsers);

      const result = await service.findAll(tenantId);

      expect(result).toEqual(mockUsers);
      expect(db.select).toHaveBeenCalled();
      expect(db.from).toHaveBeenCalled();
      expect(db.innerJoin).toHaveBeenCalled();
    });

    it('should propagate db errors', async () => {
      db.execute.mockRejectedValue(new Error('DB Connection Failed'));
      await expect(service.findAll('org-1')).rejects.toThrow(
        'DB Connection Failed',
      );
    });
  });

  describe('findOne', () => {
    it('should return user object', () => {
      const result = service.findOne('123');
      expect(result).toEqual({ id: '123' });
    });
  });
});
