import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotImplementedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard, PermissionsGuard } from '@nexiom/auth';
import { StitchesController } from './stitches.controller.js';
import { StitchesService } from './stitches.service.js';
import { ORG_ID, makeAuth } from '../workspaces/workspace-test-fixtures.js';
import { UpdateScheduleBody } from './update-schedule.validation.js';

const STITCH_ID = 'stitch-uuid-1';

const mockService = {
  updateSchedule: vi.fn(),
};

describe('StitchesController — schedule endpoints', () => {
  let controller: StitchesController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [StitchesController],
      providers: [{ provide: StitchesService, useValue: mockService }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(StitchesController);
    vi.clearAllMocks();
  });

  it('updateSchedule — delegates to service with orgId', async () => {
    const updated = {
      id: STITCH_ID,
      syncIntervalMinutes: 60,
      scheduleEnabled: true,
    };
    mockService.updateSchedule.mockResolvedValue(updated);

    const result = await controller.updateSchedule(makeAuth(), STITCH_ID, {
      syncIntervalMinutes: 60,
    } satisfies UpdateScheduleBody);

    expect(result).toBe(updated);
    expect(mockService.updateSchedule).toHaveBeenCalledWith(ORG_ID, STITCH_ID, {
      syncIntervalMinutes: 60,
    });
  });

  it('triggerSchedule — throws NotImplementedException until T029 ships', () => {
    expect(() => controller.triggerSchedule(makeAuth(), STITCH_ID)).toThrow(
      NotImplementedException,
    );
  });
});
