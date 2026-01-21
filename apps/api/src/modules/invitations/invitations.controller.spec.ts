import { Test, TestingModule } from '@nestjs/testing';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { AuthGuard } from '../auth/auth.guard';
import { CreateInvitation } from './invitations.validation';
import { Request } from 'express';

describe('InvitationsController', () => {
  let controller: InvitationsController;
  let service: InvitationsService;

  const mockService = {
    create: jest.fn(),
    get: jest.fn(),
    accept: jest.fn(),
  };

  const mockAuthGuard = {
    canActivate: jest.fn(() => true),
  };

  beforeEach(async () => {
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
        role: 'user',
        organizationId: 'org-123',
      };
      const req = {
        user: { id: 'user-123' },
        headers: { 'user-agent': 'jest' },
      } as unknown as Request & {
        user: { id: string };
      };

      await controller.create(dto, req);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(service.create).toHaveBeenCalledWith(dto, 'user-123', {
        'user-agent': 'jest',
      });
    });
  });

  describe('get', () => {
    it('should call service.get', async () => {
      await controller.get('inv-123');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(service.get).toHaveBeenCalledWith('inv-123');
    });
  });

  describe('accept', () => {
    it('should call service.accept', async () => {
      const req = {
        user: { id: 'user-123' },
        headers: { 'user-agent': 'jest' },
      } as unknown as Request & {
        user: { id: string };
      };
      const dto = { invitationId: 'inv-123', token: 'token' };

      await controller.accept(dto, req);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(service.accept).toHaveBeenCalledWith('inv-123', 'user-123', {
        'user-agent': 'jest',
      });
    });
  });
});
