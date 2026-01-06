import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from './auth.guard';
import { IdentityProvider } from './identity-provider.abstract';
import { UnauthorizedException } from '@nestjs/common';
import { createMock } from '@golevelup/ts-jest'; // Or just manual mock if library not present
import { ExecutionContext } from '@nestjs/common';

describe('AuthGuard', () => {
    let guard: AuthGuard;
    let identityProvider: IdentityProvider;

    const mockIdentityProvider = {
        getEnrichedSession: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AuthGuard,
                { provide: IdentityProvider, useValue: mockIdentityProvider },
            ],
        }).compile();

        guard = module.get<AuthGuard>(AuthGuard);
        identityProvider = module.get<IdentityProvider>(IdentityProvider);
    });

    it('should be defined', () => {
        expect(guard).toBeDefined();
    });

    it('should throw UnauthorizedException if no token is found', async () => {
        const mockContext = {
            switchToHttp: () => ({
                getRequest: () => ({
                    headers: {},
                    cookies: {},
                }),
            }),
        } as Partial<ExecutionContext>;

        await expect(guard.canActivate(mockContext as ExecutionContext)).rejects.toThrow(UnauthorizedException);
    });

    it('should authenticate successfully with a valid cookie', async () => {
        const mockUser = { id: 'user1', organizationId: 'org1' };
        const mockSession = { token: 'valid-token' };

        mockIdentityProvider.getEnrichedSession.mockResolvedValue({
            user: mockUser,
            session: mockSession,
        });

        const mockRequest = {
            headers: {},
            cookies: { 'better-auth.session_token': 'valid-token' },
            user: undefined, // Initialize
            session: undefined
        };

        const mockContext = {
            switchToHttp: () => ({
                getRequest: () => mockRequest,
            }),
        } as unknown as ExecutionContext;

        const result = await guard.canActivate(mockContext);

        expect(result).toBe(true);
        expect(identityProvider.getEnrichedSession).toHaveBeenCalledWith('valid-token');
        expect(mockRequest.user).toEqual(mockUser);
        expect(mockRequest.session).toEqual(mockSession);
    });

    it('should authenticate successfully with a valid Bearer token', async () => {
        const mockUser = { id: 'user1', organizationId: 'org1' };
        const mockSession = { token: 'bearer-token' };

        mockIdentityProvider.getEnrichedSession.mockResolvedValue({
            user: mockUser,
            session: mockSession,
        });

        const mockContext = {
            switchToHttp: () => ({
                getRequest: () => ({
                    headers: { authorization: 'Bearer bearer-token' },
                    cookies: {},
                }),
            }),
        } as unknown as ExecutionContext;

        const result = await guard.canActivate(mockContext);

        expect(result).toBe(true);
        expect(identityProvider.getEnrichedSession).toHaveBeenCalledWith('bearer-token');
    });

    it('should throw UnauthorizedException if session is invalid', async () => {
        mockIdentityProvider.getEnrichedSession.mockResolvedValue(null);

        const mockContext = {
            switchToHttp: () => ({
                getRequest: () => ({
                    headers: {},
                    cookies: { 'better-auth.session_token': 'invalid-token' },
                }),
            }),
        } as unknown as ExecutionContext;

        await expect(guard.canActivate(mockContext)).rejects.toThrow(UnauthorizedException);
    });
});
