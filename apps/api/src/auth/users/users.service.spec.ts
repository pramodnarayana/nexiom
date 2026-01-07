import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { IdentityProvider } from '../identity-provider.abstract';

describe('UsersService', () => {
  let service: UsersService;
  let identityProvider: IdentityProvider;

  const mockIdentityProvider = {
    createUser: jest.fn().mockResolvedValue({ id: '123' }),
    listUsers: jest
      .fn()
      .mockResolvedValue([{ id: '1', email: 'test@test.com' }]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: IdentityProvider, useValue: mockIdentityProvider },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    identityProvider = module.get<IdentityProvider>(IdentityProvider);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create a user via Identity Provider', async () => {
    const createUser = { email: 'test@test.com', role: 'admin' as const };
    const result = await service.create(createUser);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(identityProvider.createUser).toHaveBeenCalledWith(createUser);
    expect(result.id).toBe('123');
  });
});
