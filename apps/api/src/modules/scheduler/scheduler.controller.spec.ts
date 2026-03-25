import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { SchedulerController } from './scheduler.controller.js';
import { SchedulerService } from './scheduler.service.js';
import { InternalSchedulerGuard } from './internal-scheduler.guard.js';

const STITCH_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('SchedulerController', () => {
  let controller: SchedulerController;
  let service: { executeStitch: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    service = { executeStitch: vi.fn() };

    const module = await Test.createTestingModule({
      controllers: [SchedulerController],
      providers: [{ provide: SchedulerService, useValue: service }],
    })
      .overrideGuard(InternalSchedulerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(SchedulerController);
  });

  it('returns the result when status is succeeded', async () => {
    const result = {
      stitchId: STITCH_ID,
      status: 'succeeded' as const,
      streamResults: [],
    };
    service.executeStitch.mockResolvedValue(result);

    await expect(
      controller.executeStitch({ stitchId: STITCH_ID }),
    ).resolves.toEqual(result);
  });

  it('returns the result when status is skipped', async () => {
    const result = { stitchId: STITCH_ID, status: 'skipped' as const };
    service.executeStitch.mockResolvedValue(result);

    await expect(
      controller.executeStitch({ stitchId: STITCH_ID }),
    ).resolves.toEqual(result);
  });

  it('throws InternalServerErrorException when status is failed', async () => {
    service.executeStitch.mockResolvedValue({
      stitchId: STITCH_ID,
      status: 'failed' as const,
      streamResults: [
        {
          streamName: 'Account',
          status: 'failed',
          recordsIngested: 0,
          error: 'vendor timeout',
        },
      ],
    });

    await expect(
      controller.executeStitch({ stitchId: STITCH_ID }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('propagates thrown errors from the service without wrapping', async () => {
    service.executeStitch.mockRejectedValue(
      new Error(`Stitch not found: ${STITCH_ID}`),
    );

    await expect(
      controller.executeStitch({ stitchId: STITCH_ID }),
    ).rejects.toThrow(`Stitch not found: ${STITCH_ID}`);
  });
});
