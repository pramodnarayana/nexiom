import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { IdentityProvider } from '../auth/identity-provider.abstract';

describe('UsersService', () => {
    let service: UsersService;
    let identityProvider: IdentityProvider;

    const mockIdentityProvider = {
        createHumanUser: jest.fn().mockResolvedValue({ userId: '123' }),
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

        expect(identityProvider.createHumanUser).toHaveBeenCalledWith(createUser);
        expect(result.userId).toBe('123');
    });
});
