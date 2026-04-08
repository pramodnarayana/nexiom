import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { TraceController } from './trace.controller.js';
import { TraceService } from './trace.service.js';
import { AuthGuard } from '@nexiom/auth';
import { BadRequestException } from '@nestjs/common';

type MockedTraceService = {
  listTraces: Mock;
  getTrace: Mock;
};

describe('TraceController', () => {
  let controller: TraceController;
  let mockTraceService: MockedTraceService;

  beforeEach(async () => {
    mockTraceService = {
      listTraces: vi.fn(),
      getTrace: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TraceController],
      providers: [
        {
          provide: TraceService,
          useValue: mockTraceService,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<TraceController>(TraceController);
  });

  describe('listTraces', () => {
    it('calls traceService.listTraces globally with valid organization payload', async () => {
      const mockResult = { items: [], nextCursor: null };
      mockTraceService.listTraces.mockResolvedValue(mockResult);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx = { user: { organizationId: 'org-1' } } as any;
      const stitchId = 'stitch-1';

      const result = await controller.listTraces(
        ctx,
        stitchId,
        10,
        'cursor',
        'ws-1',
      );

      expect(mockTraceService.listTraces).toHaveBeenCalledWith(
        'org-1',
        'stitch-1',
        'ws-1',
        10,
        'cursor',
      );
      expect(result).toBe(mockResult);
    });

    it('throws BadRequestException immediately if organization is null in Auth context', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx = { user: null } as any;

      await expect(controller.listTraces(ctx, 's', 10)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockTraceService.listTraces).not.toHaveBeenCalled();
    });
  });

  describe('getTrace', () => {
    it('calls traceService.getTrace comprehensively for deep resolution payload', async () => {
      const mockTrace = { id: 'trace-1', steps: [] };
      mockTraceService.getTrace.mockResolvedValue(mockTrace);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx = { user: { organizationId: 'org-1' } } as any;
      const stitchId = 'stitch-1';
      const traceId = 'trace-1';

      const result = await controller.getTrace(ctx, stitchId, traceId, 'ws-1');

      expect(mockTraceService.getTrace).toHaveBeenCalledWith(
        'org-1',
        'stitch-1',
        'trace-1',
        'ws-1',
      );
      expect(result).toBe(mockTrace);
    });

    it('throws BadRequestException instantly isolating logic failures from Auth context mapping', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx = { user: { organizationId: undefined } } as any;

      await expect(controller.getTrace(ctx, 's', 't')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockTraceService.getTrace).not.toHaveBeenCalled();
    });
  });
});