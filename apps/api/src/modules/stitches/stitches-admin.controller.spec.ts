import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nexiom/auth';
import { StitchesAdminController } from './stitches-admin.controller.js';
import { StitchesService } from './stitches.service.js';
import { SystemAdminGuard } from '../identity/auth/system-admin.guard.js';
import { AdminUpdateScheduleBody } from './update-schedule.validation.js';

const STITCH_ID = '550e8400-e29b-41d4-a716-446655440000';

const ORG_ID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

const mockService = {
  updateScheduleAdmin: vi.fn(),
  listAdmin: vi.fn(),
  bulkUpdateScheduleByOrg: vi.fn(),
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

  it('listAll — returns all stitches from service', async () => {
    const rows = [{ id: STITCH_ID, orgId: ORG_ID }];
    mockService.listAdmin.mockResolvedValue(rows);

    const result = await controller.listAll();

    expect(result).toBe(rows);
    expect(mockService.listAdmin).toHaveBeenCalledOnce();
  });

  it('bulkUpdateOrgSchedule — delegates to service with orgId and body', async () => {
    const updated = [{ id: STITCH_ID, orgId: ORG_ID, syncIntervalMinutes: 30 }];
    mockService.bulkUpdateScheduleByOrg.mockResolvedValue(updated);

    const result = await controller.bulkUpdateOrgSchedule(ORG_ID, {
      syncIntervalMinutes: 30,
    } satisfies AdminUpdateScheduleBody);

    expect(result).toBe(updated);
    expect(mockService.bulkUpdateScheduleByOrg).toHaveBeenCalledWith(ORG_ID, {
      syncIntervalMinutes: 30,
    });
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
    } satisfies AdminUpdateScheduleBody);

    expect(result).toBe(updated);
    expect(mockService.updateScheduleAdmin).toHaveBeenCalledWith(STITCH_ID, {
      syncIntervalMinutes: 15,
    });
  });
});
