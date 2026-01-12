import { Test, TestingModule } from '@nestjs/testing';
import { InvitationsService } from './invitations.service';
import { IdentityProvider } from '../auth/identity-provider.abstract';

describe('InvitationsService', () => {
  let service: InvitationsService;
  let identityProvider: IdentityProvider;

  const mockIdentityProvider = {
    createInvitation: jest.fn(),
    acceptInvitation: jest.fn(),
    getInvitation: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationsService,
        {
          provide: IdentityProvider,
          useValue: mockIdentityProvider,
        },
      ],
    }).compile();

    service = module.get<InvitationsService>(InvitationsService);
    identityProvider = module.get<IdentityProvider>(IdentityProvider);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should call identityProvider.createInvitation', async () => {
      const dto = {
        email: 'test@example.com',
        role: 'user',
        organizationId: 'org-123',
      };
      await service.create(dto, 'user-123');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(identityProvider.createInvitation).toHaveBeenCalledWith({
        email: dto.email,
        role: dto.role,
        organizationId: dto.organizationId,
        inviterId: 'user-123',
      });
    });
  });

  describe('accept', () => {
    it('should call identityProvider.acceptInvitation', async () => {
      await service.accept('inv-123', 'user-123');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(identityProvider.acceptInvitation).toHaveBeenCalledWith(
        'inv-123',
        'user-123',
      );
    });
  });

  describe('get', () => {
    it('should call identityProvider.getInvitation', async () => {
      await service.get('inv-123');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(identityProvider.getInvitation).toHaveBeenCalledWith('inv-123');
    });
  });
});
