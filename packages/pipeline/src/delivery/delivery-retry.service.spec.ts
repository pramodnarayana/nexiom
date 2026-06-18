import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest';
import { DeliveryRetryService } from './delivery-retry.service.js';
import { ModuleRef } from '@nestjs/core';

describe('DeliveryRetryService', () => {
  let moduleRef: Mocked<ModuleRef>;
  let syncLogRepository: any;
  let connectionRepository: any;
  let stitchRepository: any;
  let outboundGatewayRepository: any;
  let deliveryService: any;
  let service: DeliveryRetryService;

  beforeEach(() => {
    deliveryService = { writeL6Result: vi.fn() };
    moduleRef = { get: vi.fn().mockReturnValue(deliveryService) } as any;
    syncLogRepository = { hasCompletedSyncLog: vi.fn() };
    connectionRepository = { getTenantConnectionMeta: vi.fn() };
    stitchRepository = { findById: vi.fn() };
    outboundGatewayRepository = { fetchOutboundGatewayResult: vi.fn() };

    service = new DeliveryRetryService(
      moduleRef,
      syncLogRepository,
      connectionRepository,
      stitchRepository,
      outboundGatewayRepository,
      {} as any
    );
  });

  describe('isSourceFinalized', () => {
    it('returns true if sync log exists', async () => {
      syncLogRepository.hasCompletedSyncLog.mockResolvedValue(true);
      const res = await service.isSourceFinalized('ten-1', 'ws_1', 'tr-1', 'rt-1');
      expect(res).toBe(true);
    });

    it('returns false and catches error if DB call fails', async () => {
      syncLogRepository.hasCompletedSyncLog.mockRejectedValue(new Error('DB connection failed'));
      const res = await service.isSourceFinalized('ten-1', 'ws_1', 'tr-1', 'rt-1');
      expect(res).toBe(false);
    });
  });

  describe('retrySourceFinalization', () => {
    it('throws error if outbound gateway result is not found', async () => {
      outboundGatewayRepository.fetchOutboundGatewayResult.mockResolvedValue(null);

      await expect(
        service.retrySourceFinalization('ws_2', 'ws_1', 'gw-1', 'tr-1', 'rt-1', 'ds-1', 'conn-1', 'SUCCESS', 200, 'Customer', 'app-1', 'ten-1', 'ent-1', 100, 'ten-1')
      ).rejects.toThrow('Outbound gateway result not found for retry');
    });

    it('retries source finalization by calling deliveryService.writeL6Result', async () => {
      outboundGatewayRepository.fetchOutboundGatewayResult.mockResolvedValue({
        id: 'gw-1',
        attempts: 2,
        statusCode: 201,
        response: { foo: 'bar' },
        destEntityId: 'dest-org-1'
      });

      connectionRepository.getTenantConnectionMeta.mockResolvedValue({
        appName: 'quickbooks',
        tenantId: 'qb-ten-1'
      });

      stitchRepository.findById.mockResolvedValue({
        targetObject: 'Invoice'
      });

      deliveryService.writeL6Result.mockResolvedValue(true);

      const res = await service.retrySourceFinalization(
        'ws_2', 'ws_1', 'gw-1', 'tr-1', 'rt-1', 'ds-1', 'conn-1', 'SUCCESS', 200, 'Customer', 'app-1', 'ten-1', 'ent-1', 100, 'ten-1'
      );

      expect(res).toBe(true);
      expect(deliveryService.writeL6Result).toHaveBeenCalledWith(
        'ws_2', 'ws_1', 'gw-1', 2, 'ds-1', 'tr-1', 'rt-1', { foo: 'bar' }, null, 201, 'SUCCESS', 100, 'dest-org-1', 'Customer', 'app-1', 'ten-1', 'ent-1', 'conn-1', 'quickbooks', 'qb-ten-1', 'Invoice', 'ten-1'
      );
    });
    
    it('handles undefined target object gracefully', async () => {
      outboundGatewayRepository.fetchOutboundGatewayResult.mockResolvedValue({
        id: 'gw-1',
        attempts: 1,
        statusCode: null,
        response: null,
      });

      connectionRepository.getTenantConnectionMeta.mockResolvedValue(undefined);
      stitchRepository.findById.mockResolvedValue(null);
      deliveryService.writeL6Result.mockResolvedValue(false);

      const res = await service.retrySourceFinalization(
        'ws_2', 'ws_1', 'gw-1', 'tr-1', 'rt-1', 'ds-1', 'conn-1', 'FAIL', 500, 'Customer', 'app-1', 'ten-1', 'ent-1', 100, 'ten-1'
      );

      expect(res).toBe(false);
      expect(deliveryService.writeL6Result).toHaveBeenCalledWith(
        'ws_2', 'ws_1', 'gw-1', 1, 'ds-1', 'tr-1', 'rt-1', null, null, 500, 'FAIL', 100, undefined, 'Customer', 'app-1', 'ten-1', 'ent-1', 'conn-1', undefined, undefined, '', 'ten-1'
      );
    });
  });
});
