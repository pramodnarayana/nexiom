import { Test, TestingModule } from '@nestjs/testing';
import { ExceptionController } from './exception.controller.js';
import { ExceptionService } from './exception.service.js';
import { BadRequestException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AuthGuard, type RequestAuthContext } from '@soopa/auth';

describe('ExceptionController', () => {
  let controller: ExceptionController;
  let exceptionService: {
    listExceptions: ReturnType<typeof vi.fn>;
    retryException: ReturnType<typeof vi.fn>;
    dismissException: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    exceptionService = {
      listExceptions: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
      retryException: vi.fn().mockResolvedValue({ success: true }),
      dismissException: vi.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExceptionController],
      providers: [
        {
          provide: ExceptionService,
          useValue: exceptionService,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ExceptionController>(ExceptionController);
  });

  describe('listExceptions', () => {
    it('should throw BadRequestException if orgId is missing', async () => {
      await expect(
        controller.listExceptions(
          { user: {} } as unknown as RequestAuthContext,
          'unresolved',
          50,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid status', async () => {
      await expect(
        controller.listExceptions(
          {
            user: { organizationId: 'org_1' },
          } as unknown as RequestAuthContext,
          'invalid_status',
          50,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should call exceptionService.listExceptions successfully', async () => {
      const res = await controller.listExceptions(
        { user: { organizationId: 'org_1' } } as unknown as RequestAuthContext,
        'unresolved',
        50,
        'cursor123',
      );
      expect(exceptionService.listExceptions).toHaveBeenCalledWith(
        'org_1',
        { status: 'unresolved' },
        { limit: 50, cursor: 'cursor123' },
      );
      expect(res).toEqual({ data: [], nextCursor: null });
    });
  });

  describe('retryException', () => {
    it('should throw BadRequestException if orgId is missing', async () => {
      await expect(
        controller.retryException(
          { user: {} } as unknown as RequestAuthContext,
          'uuid-123',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should call exceptionService.retryException successfully', async () => {
      const res = await controller.retryException(
        { user: { organizationId: 'org_1' } } as unknown as RequestAuthContext,
        'uuid-123',
      );
      expect(exceptionService.retryException).toHaveBeenCalledWith(
        'org_1',
        'uuid-123',
      );
      expect(res).toEqual({ success: true });
    });
  });

  describe('dismissException', () => {
    it('should throw BadRequestException if orgId is missing', async () => {
      await expect(
        controller.dismissException(
          { user: {} } as unknown as RequestAuthContext,
          'uuid-123',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should call exceptionService.dismissException successfully', async () => {
      const res = await controller.dismissException(
        { user: { organizationId: 'org_1' } } as unknown as RequestAuthContext,
        'uuid-123',
      );
      expect(exceptionService.dismissException).toHaveBeenCalledWith(
        'org_1',
        'uuid-123',
      );
      expect(res).toEqual({ success: true });
    });
  });
});
