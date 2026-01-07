/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { IdentityProvider } from './identity-provider.abstract';
import { UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

describe('AuthController', () => {
  let controller: AuthController;
  let identityProvider: IdentityProvider;

  const mockIdentityProvider = {
    getEnrichedSession: jest.fn(),
    getHandler: jest.fn().mockReturnValue(() => {}), // Mock the library handler
    provisionTenant: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: IdentityProvider, useValue: mockIdentityProvider },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    identityProvider = module.get<IdentityProvider>(IdentityProvider);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('refreshSession', () => {
    it('should return enriched session if token is valid', async () => {
      const mockSession = { user: { id: '1' }, session: { token: 'abc' } };
      const req = {
        cookies: { 'better-auth.session_token': 'abc' },
        headers: {},
      } as unknown as Request;

      mockIdentityProvider.getEnrichedSession.mockResolvedValue(mockSession);

      const result = await controller.refreshSession(req);

      expect(identityProvider.getEnrichedSession).toHaveBeenCalledWith('abc');
      expect(result).toEqual(mockSession);
    });

    it('should throw UnauthorizedException if no token provided', async () => {
      const req = {
        cookies: {},
        headers: {},
      } as unknown as Request;

      // The controller implementation wraps the logic.
      // Wait, looking at current implementation, does it throw?
      // "const token = ...; if (!token) throw new UnauthorizedException()"

      await expect(controller.refreshSession(req)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if session is invalid (null result)', async () => {
      const req = {
        cookies: { 'better-auth.session_token': 'bad-token' },
        headers: {},
      } as unknown as Request;

      mockIdentityProvider.getEnrichedSession.mockResolvedValue(null);

      await expect(controller.refreshSession(req)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
