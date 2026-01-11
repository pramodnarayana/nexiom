/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AuthGuard } from '../auth/auth.guard';
import { CreateUser } from './users.schema';
import { Request } from 'express';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: UsersService;

  const mockUsersService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
  };

  const mockAuthGuard = {
    canActivate: jest.fn().mockImplementation(() => true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    })
      .overrideGuard(AuthGuard)
      .useValue(mockAuthGuard)
      .compile();

    controller = module.get<UsersController>(UsersController);
    usersService = module.get<UsersService>(UsersService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should call usersService.create with correct parameters', async () => {
      const createUserDto: CreateUser = {
        email: 'test@example.com',
        role: 'user',
      };
      const result = { id: '1', ...createUserDto };
      mockUsersService.create.mockResolvedValue(result);

      expect(await controller.create(createUserDto)).toEqual(result);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(usersService.create).toHaveBeenCalledWith(createUserDto);
    });
  });

  describe('findAll', () => {
    it('should return empty list if no organizationId in request', async () => {
      const req = {
        user: {},
      } as unknown as Request & { user: { organizationId?: string } };

      const result = await controller.findAll(req);
      expect(result).toEqual([]);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(usersService.findAll).not.toHaveBeenCalled();
    });

    it('should call usersService.findAll with tenantId if present', async () => {
      const tenantId = 'org-123';
      const req = {
        user: { organizationId: tenantId },
      } as unknown as Request & { user: { organizationId?: string } };
      const users = [{ id: '1' }];

      mockUsersService.findAll.mockResolvedValue(users);

      const result = await controller.findAll(req);
      expect(result).toEqual(users);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(usersService.findAll).toHaveBeenCalledWith(tenantId);
    });
  });

  describe('findOne', () => {
    it('should call usersService.findOne with correct id', () => {
      const id = '1';
      const user = { id: '1', email: 'test@example.com' };
      // Service returns object synchronously in current impl
      mockUsersService.findOne.mockReturnValue(user);

      const result = controller.findOne(id);
      expect(result).toEqual(user);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(usersService.findOne).toHaveBeenCalledWith(id);
    });
  });
});
