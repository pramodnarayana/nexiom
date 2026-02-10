import { Test, TestingModule } from '@nestjs/testing';
import { InvitationsService } from './invitations.service';
import { AUTH_PROVIDER, IAuthProvider } from '@nexiom/identity';

describe('InvitationsService', () => {
  let service: InvitationsService;
  let authProvider: IAuthProvider;

  const mockAuthProvider = {
    createInvitation: vi.fn(),
    acceptInvitation: vi.fn(),
    getInvitation: vi.fn(),
    listInvitations: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationsService,
        {
          provide: AUTH_PROVIDER,
          useValue: mockAuthProvider,
        },
      ],
    }).compile();

    service = module.get<InvitationsService>(InvitationsService);
    authProvider = module.get<IAuthProvider>(AUTH_PROVIDER);

    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should call authProvider.createInvitation', async () => {
      const dto = {
        email: 'test@example.com',
        role: 'member',
        organizationId: 'org-123',
      };
      await service.create(dto, 'user-123');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(authProvider.createInvitation).toHaveBeenCalledWith({
        email: dto.email,
        role: dto.role,
        organizationId: dto.organizationId,
        inviterId: 'user-123',
        expiresIn: 172800, // 48 hours
      });
    });
  });

  describe('accept', () => {
    it('should call authProvider.acceptInvitation', async () => {
      await service.accept('inv-123', 'user-123');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(authProvider.acceptInvitation).toHaveBeenCalledWith(
        'inv-123',
        'user-123',
      );
    });
  });

  describe('get', () => {
    it('should call authProvider.getInvitation', async () => {
      await service.get('inv-123');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(authProvider.getInvitation).toHaveBeenCalledWith('inv-123');
    });
  });

  describe('list', () => {
    it('should call authProvider.listInvitations', async () => {
      await service.list('org-123');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(authProvider.listInvitations).toHaveBeenCalledWith('org-123');
    });
  });
});
