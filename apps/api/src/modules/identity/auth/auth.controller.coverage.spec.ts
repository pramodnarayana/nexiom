import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService, AuthGuard } from '@nexiom/auth';
import { USER_PROVIDER, TENANT_PROVIDER } from '@nexiom/identity';
import { InvitationsService } from '../invitations/invitations.service';
import { BadRequestException } from '@nestjs/common';
import { vi, describe, it, expect, beforeEach, Mock } from 'vitest';
import { Response } from 'express';
import { CompleteInvite } from '../users/users.validation';

describe('AuthController Coverage', () => {
  let controller: AuthController;
  let authService: {
    login: Mock;
    registerUser: Mock;
    resendVerificationEmail: Mock;
    createUser: Mock;
    setPassword: Mock;
    getHandler: Mock;
  };
  let userProvider: {
    findByEmail: Mock;
    update: Mock;
    forceVerifyEmail: Mock;
    delete: Mock;
  };
  let tenantProvider: {
    provisionTenantForUser: Mock;
  };
  let invitationsService: {
    get: Mock;
    accept: Mock;
  };

  let mockResponse: Response;

  const mockCompleteInvite: CompleteInvite = {
    invitationId: 'inv-1',
    email: 'test@test.com',
    firstName: 'F',
    lastName: 'L',
    password: 'p',
  };

  beforeEach(async () => {
    mockResponse = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      cookie: vi.fn(),
    } as unknown as Response;
    authService = {
      login: vi.fn(),
      registerUser: vi.fn(),
      resendVerificationEmail: vi.fn(),
      createUser: vi.fn(),
      setPassword: vi.fn(),
      getHandler: vi.fn().mockReturnValue(() => {}),
    };
    userProvider = {
      findByEmail: vi.fn(),
      update: vi.fn(),
      forceVerifyEmail: vi.fn(),
      delete: vi.fn(),
    };
    tenantProvider = {
      provisionTenantForUser: vi.fn(),
    };
    invitationsService = {
      get: vi.fn(),
      accept: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: USER_PROVIDER, useValue: userProvider },
        { provide: TENANT_PROVIDER, useValue: tenantProvider },
        { provide: InvitationsService, useValue: invitationsService },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('resendVerification', () => {
    it('should handle errors gracefully', async () => {
      authService.resendVerificationEmail.mockRejectedValue(
        new Error('Failed'),
      );
      await expect(
        controller.resendVerification({ email: 'test@example.com' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should send verification email successfully', async () => {
      authService.resendVerificationEmail.mockResolvedValue(undefined);

      const result = await controller.resendVerification({
        email: 'test@example.com',
      });

      expect(result).toEqual({
        message: 'Verification email sent successfully',
      });
      expect(authService.resendVerificationEmail).toHaveBeenCalledWith(
        'test@example.com',
      );
    });
  });

  describe('completeInvite', () => {
    const mockInviteData = {
      id: 'inv-1',
      status: 'pending',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    };

    it('should throw if invitation not found', async () => {
      invitationsService.get.mockResolvedValue(null);
      await expect(
        controller.completeInvite(mockCompleteInvite, mockResponse),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if invitation not pending', async () => {
      invitationsService.get.mockResolvedValue({
        ...mockInviteData,
        status: 'accepted',
      });
      await expect(
        controller.completeInvite(mockCompleteInvite, mockResponse),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if invitation expired', async () => {
      invitationsService.get.mockResolvedValue({
        ...mockInviteData,
        expiresAt: new Date(Date.now() - 10000).toISOString(),
      });
      await expect(
        controller.completeInvite(mockCompleteInvite, mockResponse),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if user already registered and verified', async () => {
      invitationsService.get.mockResolvedValue(mockInviteData);
      userProvider.findByEmail.mockResolvedValue({
        id: 'u1',
        emailVerified: true,
      });
      await expect(
        controller.completeInvite(mockCompleteInvite, mockResponse),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update existing unverified user', async () => {
      invitationsService.get.mockResolvedValue(mockInviteData);
      userProvider.findByEmail.mockResolvedValue({
        id: 'u1',
        emailVerified: false,
      });
      userProvider.update.mockResolvedValue({ id: 'u1' });
      authService.login.mockResolvedValue({ session: 's' });

      await controller.completeInvite(mockCompleteInvite, mockResponse);

      expect(userProvider.update).toHaveBeenCalled();
      expect(invitationsService.accept).toHaveBeenCalled();

      // Verify unverified user flow specifics
      expect(authService.setPassword).toHaveBeenCalledWith('u1', 'p');
      expect(userProvider.forceVerifyEmail).toHaveBeenCalledWith('u1');
      expect(authService.login).toHaveBeenCalled();
    });

    it('should rollback user creation if accept fails', async () => {
      invitationsService.get.mockResolvedValue(mockInviteData);
      userProvider.findByEmail.mockResolvedValue(null);
      authService.createUser.mockResolvedValue({ id: 'u1' });
      invitationsService.accept.mockRejectedValue(new Error('Accept failed'));

      await expect(
        controller.completeInvite(mockCompleteInvite, mockResponse),
      ).rejects.toThrow(BadRequestException);

      expect(userProvider.delete).toHaveBeenCalledWith('u1');
    });

    it('should create and login a new user when invite is valid', async () => {
      invitationsService.get.mockResolvedValue(mockInviteData);
      userProvider.findByEmail.mockResolvedValue(null);
      authService.createUser.mockResolvedValue({ id: 'u-new' });
      invitationsService.accept.mockResolvedValue(undefined);
      authService.login.mockResolvedValue({ session: 's' });

      await controller.completeInvite(mockCompleteInvite, mockResponse);

      expect(authService.createUser).toHaveBeenCalled();
      expect(invitationsService.accept).toHaveBeenCalled();
      expect(authService.login).toHaveBeenCalled();
    });
  });
});
