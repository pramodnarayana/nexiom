import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { IdentityProvider } from '../auth/identity-provider.abstract';
import { User } from '../auth/auth.schema';

describe('UsersService', () => {
  let service: UsersService;

  const mockUser: User = {
    id: '123',
    name: 'Test User',
    email: 'test@test.com',
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    role: 'user',
    banned: null,
    banReason: null,
    banExpires: null,
  };

  const mockIdentityProvider = {
    createUser: jest.fn(),
    listUsers: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: IdentityProvider, useValue: mockIdentityProvider },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a user with minimal required fields', async () => {
      const createUserDto = {
        email: 'test@test.com',
        role: 'user' as const,
      };
      mockIdentityProvider.createUser.mockResolvedValue(mockUser);

      const result = await service.create(createUserDto);

      expect(mockIdentityProvider.createUser).toHaveBeenCalledWith(
        createUserDto,
      );
      expect(result).toEqual(mockUser);
    });

    it('should create a user with all optional fields', async () => {
      const createUserDto = {
        email: 'admin@test.com',
        firstName: 'John',
        lastName: 'Doe',
        companyName: 'Test Corp',
        role: 'admin' as const,
      };
      const adminUser = { ...mockUser, role: 'admin', name: 'John Doe' };
      mockIdentityProvider.createUser.mockResolvedValue(adminUser);

      const result = await service.create(createUserDto);

      expect(mockIdentityProvider.createUser).toHaveBeenCalledWith(
        createUserDto,
      );
      expect(result).toEqual(adminUser);
      expect(result.role).toBe('admin');
    });

    it('should handle errors from identity provider', async () => {
      const createUserDto = { email: 'test@test.com', role: 'user' as const };
      const error = new Error('Email already exists');
      mockIdentityProvider.createUser.mockRejectedValue(error);

      await expect(service.create(createUserDto)).rejects.toThrow(
        'Email already exists',
      );
      expect(mockIdentityProvider.createUser).toHaveBeenCalledWith(
        createUserDto,
      );
    });
  });

  describe('findAll', () => {
    it('should return all users when no tenantId provided', async () => {
      const users = [mockUser];
      mockIdentityProvider.listUsers.mockResolvedValue(users);

      const result = await service.findAll();

      expect(mockIdentityProvider.listUsers).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(users);
    });

    it('should return users filtered by tenantId', async () => {
      const tenantId = 'org-123';
      const users = [mockUser];
      mockIdentityProvider.listUsers.mockResolvedValue(users);

      const result = await service.findAll(tenantId);

      expect(mockIdentityProvider.listUsers).toHaveBeenCalledWith(tenantId);
      expect(result).toEqual(users);
    });

    it('should return empty array when no users found', async () => {
      mockIdentityProvider.listUsers.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });

    it('should handle errors from identity provider', async () => {
      const error = new Error('Database connection failed');
      mockIdentityProvider.listUsers.mockRejectedValue(error);

      await expect(service.findAll()).rejects.toThrow(
        'Database connection failed',
      );
    });
  });

  describe('findOne', () => {
    it('should return user object with id', () => {
      const userId = 'user-456';

      const result = service.findOne(userId);

      expect(result).toEqual({ id: userId });
    });

    it('should handle different id formats', () => {
      const uuidId = '550e8400-e29b-41d4-a716-446655440000';

      const result = service.findOne(uuidId);

      expect(result).toEqual({ id: uuidId });
    });
  });
});
