import { Test, TestingModule } from '@nestjs/testing';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';
import { AuthGuard, type RequestAuthContext } from '@soopa/auth';
import { CreateInvitation } from './invitations.validation.js';
import type { User } from '@soopa/identity';

describe('InvitationsController', () => {
  let controller: InvitationsController;
  let service: InvitationsService;

  const mockService = {
    create: vi.fn(),
    get: vi.fn(),
    accept: vi.fn(),
    list: vi.fn(),
  };

  const mockAuthGuard = {
    canActivate: vi.fn(() => true),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InvitationsController],
      providers: [
        {
          provide: InvitationsService,
          useValue: mockService,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue(mockAuthGuard)
      .compile();

    controller = module.get<InvitationsController>(InvitationsController);
    service = module.get<InvitationsService>(InvitationsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should call service.create', async () => {
      const dto: CreateInvitation = {
        email: 'test@example.com',
        role: 'member',
        organizationId: 'org-123',
      };
      const mockCtx: RequestAuthContext = {
        headers: new Headers({
          cookie: 'session=123',
          authorization: 'Bearer token',
        }),
        user: { id: 'user-123' } as User,
        session: {
          id: 'sess-1',
          token: 'tok-1',
        } as RequestAuthContext['session'],
      };

      await controller.create(dto, mockCtx);

      expect(service.create).toHaveBeenCalledWith(dto, 'user-123', {
        'x-request-id': undefined,
        'x-forwarded-for': undefined,
        cookie: 'session=123',
        authorization: 'Bearer token',
      });
    });
  });

  describe('get', () => {
    it('should call service.get', async () => {
      await controller.get('inv-123');

      expect(service.get).toHaveBeenCalledWith('inv-123');
    });
  });

  describe('accept', () => {
    it('should call service.accept', async () => {
      const mockUser = { id: 'user-123' } as User;
      const dto = { invitationId: 'inv-123', token: 'token' };

      await controller.accept(dto, mockUser);

      expect(service.accept).toHaveBeenCalledWith('inv-123', 'user-123');
    });
  });

  describe('list', () => {
    it('should call service.list with organizationId', async () => {
      const mockUser = { id: 'user-123', organizationId: 'org-123' } as User;

      await controller.list(mockUser);

      expect(service.list).toHaveBeenCalledWith('org-123');
    });

    it('should return empty list if no organizationId', async () => {
      const mockUser = { id: 'user-123' } as User;

      const result = await controller.list(mockUser);
      expect(result).toEqual([]);

      expect(service.list).not.toHaveBeenCalled();
    });
  });
});
