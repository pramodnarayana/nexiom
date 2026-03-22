import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nexiom/auth';
import { StitchesAdminController } from './stitches-admin.controller.js';
import { StitchesService } from './stitches.service.js';
import { SystemAdminGuard } from '../identity/auth/system-admin.guard.js';

const STITCH_ID = 'stitch-uuid-1';

const mockService = {
  updateScheduleAdmin: vi.fn(),
};

describe('StitchesAdminController', () => {
  let controller: StitchesAdminController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [StitchesAdminController],
      providers: [{ provide: StitchesService, useValue: mockService }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SystemAdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(StitchesAdminController);
    vi.clearAllMocks();
  });

  it('updateSchedule — delegates to service with no org scoping', async () => {
    const updated = {
      id: STITCH_ID,
      syncIntervalMinutes: 15,
      scheduleEnabled: true,
    };
    mockService.updateScheduleAdmin.mockResolvedValue(updated);

    const result = await controller.updateSchedule(STITCH_ID, {
      syncIntervalMinutes: 15,
    } as any);

    expect(result).toBe(updated);
    expect(mockService.updateScheduleAdmin).toHaveBeenCalledWith(STITCH_ID, {
      syncIntervalMinutes: 15,
    });
  });
});
