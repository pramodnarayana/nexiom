import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotImplementedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard, PermissionsGuard } from '@nexiom/auth';
import { StitchesController } from './stitches.controller.js';
import { StitchesService } from './stitches.service.js';
import { ORG_ID, makeAuth } from '../workspaces/workspace-test-fixtures.js';
import { UpdateScheduleBody } from './update-schedule.validation.js';
import type { CreateStitch, UpdateStitch } from './stitches.validation.js';

const STITCH_ID = 'stitch-uuid-1';

const mockService = {
  create: vi.fn(),
  list: vi.fn(),
  findOne: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
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

  it('create — delegates to service', async () => {
    const body = { name: 'Test Stitch' } as unknown as CreateStitch;
    mockService.create.mockResolvedValue({ id: STITCH_ID });
    const result = await controller.create(makeAuth(), body);
    expect(result).toEqual({ id: STITCH_ID });
    expect(mockService.create).toHaveBeenCalledWith(ORG_ID, body);
  });

  it('list — delegates to service', async () => {
    mockService.list.mockResolvedValue([]);
    const result = await controller.list(makeAuth(), 'workspace-1', 'true');
    expect(result).toEqual([]);
    expect(mockService.list).toHaveBeenCalledWith(ORG_ID, 'workspace-1', true);
  });

  it('findOne — delegates to service', async () => {
    mockService.findOne.mockResolvedValue({ id: STITCH_ID });
    const result = await controller.findOne(makeAuth(), STITCH_ID);
    expect(result).toEqual({ id: STITCH_ID });
    expect(mockService.findOne).toHaveBeenCalledWith(ORG_ID, STITCH_ID);
  });

  it('update — delegates to service', async () => {
    const body = { name: 'Updated Stitch' } as unknown as UpdateStitch;
    mockService.update.mockResolvedValue({ id: STITCH_ID });
    const result = await controller.update(makeAuth(), STITCH_ID, body);
    expect(result).toEqual({ id: STITCH_ID });
    expect(mockService.update).toHaveBeenCalledWith(ORG_ID, STITCH_ID, body);
  });

  it('remove — delegates to service', async () => {
    mockService.remove.mockResolvedValue(undefined);
    const result = await controller.remove(makeAuth(), STITCH_ID);
    expect(result).toBeUndefined();
    expect(mockService.remove).toHaveBeenCalledWith(ORG_ID, STITCH_ID);
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
