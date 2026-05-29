import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SchedulerController } from './scheduler.controller.js';
import { SchedulerService } from './scheduler.service.js';
import { InternalSchedulerGuard } from './internal-scheduler.guard.js';

const CONN_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('SchedulerController', () => {
  let controller: SchedulerController;
  let service: { executeConnection: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    service = { executeConnection: vi.fn() };

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
      connectionId: CONN_ID,
      status: 'succeeded' as const,
      streamResults: [],
    };
    service.executeConnection.mockResolvedValue(result);

    await expect(
      controller.executeConnection({ dataSourceId: CONN_ID }),
    ).resolves.toEqual(result);
  });

  it('returns the result when status is skipped', async () => {
    const result = { connectionId: CONN_ID, status: 'skipped' as const };
    service.executeConnection.mockResolvedValue(result);

    await expect(
      controller.executeConnection({ dataSourceId: CONN_ID }),
    ).resolves.toEqual(result);
  });

  it('throws InternalServerErrorException when status is failed', async () => {
    service.executeConnection.mockResolvedValue({
      connectionId: CONN_ID,
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
      controller.executeConnection({ dataSourceId: CONN_ID }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('propagates NotFoundException from service as 404 (not wrapped as 500)', async () => {
    service.executeConnection.mockRejectedValue(
      new NotFoundException('Connection not found: ' + CONN_ID),
    );

    await expect(
      controller.executeConnection({ dataSourceId: CONN_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('wraps unexpected service throws in InternalServerErrorException to prevent raw error leakage', async () => {
    // Raw errors (e.g. DB connection strings, vendor tokens) must never reach
    // the Windmill worker response body.
    service.executeConnection.mockRejectedValue(
      new Error(`DB connection string: postgres://secret@host/db`),
    );

    try {
      await controller.executeConnection({ dataSourceId: 'conn-1' });
      expect.fail('Should have thrown InternalServerErrorException');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(InternalServerErrorException);
      expect((err as InternalServerErrorException).message).not.toContain(
        'postgres://',
      );
    }
  });
});
