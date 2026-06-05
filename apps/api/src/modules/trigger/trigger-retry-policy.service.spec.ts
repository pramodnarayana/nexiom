import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TriggerRetryPolicyService } from './trigger-retry-policy.service.js';
import { Logger } from '@nestjs/common';
import type {
  TriggerRunParams,
  WebhookRunParams,
} from './trigger-executor.service.js';
import type { MockedObject } from 'vitest';
import type { ITriggerDlqService } from './interfaces/trigger-dlq.interface.js';

describe('TriggerRetryPolicyService', () => {
  let service: TriggerRetryPolicyService;
  let dlqService: MockedObject<ITriggerDlqService>;
  let pushJobMock: import('vitest').Mock;
  let logger: Logger;
  let loggerErrorSpy: any;

  beforeEach(() => {
    pushJobMock = vi.fn().mockResolvedValue(undefined);
    dlqService = {
      pushJob: pushJobMock,
    } as unknown as MockedObject<ITriggerDlqService>;
    service = new TriggerRetryPolicyService(dlqService);
    logger = new Logger();
    loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
  });

  describe('handleRecordIngestFailure', () => {
    const baseParams: TriggerRunParams = {
      trigger: {} as unknown as import('@soopa/piece-framework').Trigger,
      appName: 'test-app',
      triggerName: 'test-trigger',
      objectType: 'test-object',
      auth: {},
      propsValue: {},
      workspaceId: 'ws-1',
      dataSourceId: 'ds-1',
      tenantId: 'tenant-1',
    };

    it('should throw immediately if fromDlqRetry is true', async () => {
      const err = new Error('Test error');
      await expect(
        service.handleRecordIngestFailure(
          baseParams,
          true,
          [],
          0,
          'source-id',
          err,
          logger,
        ),
      ).rejects.toThrow('Test error');

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Record ingest failed',
        expect.objectContaining({
          error: 'Test error',
        }),
      );
      expect(pushJobMock).not.toHaveBeenCalled();
    });

    it('should push to DLQ and throw if fromDlqRetry is false', async () => {
      const err = new Error('Test error');
      await expect(
        service.handleRecordIngestFailure(
          baseParams,
          false,
          [],
          0,
          'source-id',
          err,
          logger,
        ),
      ).rejects.toThrow('Test error');

      expect(pushJobMock).toHaveBeenCalled();
    });

    it('should handle non-Error thrown objects', async () => {
      const err = 'String error';
      await expect(
        service.handleRecordIngestFailure(
          baseParams,
          false,
          [],
          0,
          'source-id',
          err,
          logger,
        ),
      ).rejects.toThrow('String error');

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Record ingest failed',
        expect.objectContaining({
          error: 'String error',
        }),
      );

      expect(pushJobMock).toHaveBeenCalled();
    });

    it('should slice array payload if webhook params', async () => {
      const webhookParams: WebhookRunParams = {
        ...baseParams,
        headers: {},
        rawBody: Buffer.from(''),
        payload: [1, 2, 3, 4],
      };

      const err = new Error('Test error');
      await expect(
        service.handleRecordIngestFailure(
          webhookParams,
          false,
          [1, 2, 3, 4],
          2,
          'source-id',
          err,
          logger,
        ),
      ).rejects.toThrow('Test error');

      expect(pushJobMock).toHaveBeenCalled();
      const jobCall = JSON.parse(pushJobMock.mock.calls[0][0] as string) as {
        payload: number[];
      };
      expect(jobCall.payload).toEqual([3, 4]); // sliced remaining records
    });

    it('should preserve non-array payload if webhook params', async () => {
      const webhookParams: WebhookRunParams = {
        ...baseParams,
        headers: {},
        rawBody: Buffer.from(''),
        payload: { single: 'record' },
      };

      const err = new Error('Test error');
      await expect(
        service.handleRecordIngestFailure(
          webhookParams,
          false,
          [{ single: 'record' }],
          0,
          'source-id',
          err,
          logger,
        ),
      ).rejects.toThrow('Test error');

      expect(pushJobMock).toHaveBeenCalled();
      const jobCall = JSON.parse(pushJobMock.mock.calls[0][0] as string) as {
        payload: Record<string, string>;
      };
      expect(jobCall.payload).toEqual({ single: 'record' });
    });
  });

  describe('pushToDlq', () => {
    it('should handle non-Error objects', async () => {
      const params: TriggerRunParams = {
        trigger: {} as unknown as import('@soopa/piece-framework').Trigger,
        appName: 'test-app',
        triggerName: 'test-trigger',
        objectType: 'test-object',
        auth: {},
        propsValue: {},
        workspaceId: 'ws-1',
        dataSourceId: 'ds-1',
        tenantId: 'tenant-1',
      };

      await service.pushToDlq(params, 'String error');
      expect(pushJobMock).toHaveBeenCalled();
      const jobCall = JSON.parse(pushJobMock.mock.calls[0][0] as string) as {
        error: string;
      };
      expect(jobCall.error).toEqual('String error');
    });
  });
});
