import { describe, it, expect, vi, beforeEach, afterEach, Mocked } from 'vitest';
import { DeliveryService } from './delivery.service.js';
import { QueueService, QueueName } from '@soopa/queue';
import { StorageResolverService } from '../storage-resolver/storage-resolver.service.js';
import type { IOutboundDispatcher } from '../shared/interfaces/outbound-dispatcher.interface.js';
import { FakeOutboundGatewayRepository } from '../shared/fakes/outbound-gateway-repository.fake.js';
import { FakeSyncLogRepository } from '../shared/fakes/sync-log-repository.fake.js';
import { FakePipelineStateRepository } from '../shared/fakes/pipeline-state-repository.fake.js';
import { FakeTransactionManager } from '../shared/fakes/transaction-manager.fake.js';
import { StitchRepositoryPort } from '../shared/ports/stitch.repository.port.js';
import { DeliveryRetryService } from './delivery-retry.service.js';
import { GemHydrationService } from './gem-hydration.service.js';
import { ClaimDeliveryUseCase } from './use-cases/claim-delivery.use-case.js';
import { TokenManagerService } from '@soopa/credentials';

describe('DeliveryService', () => {
  let queueService: Mocked<QueueService>;
  let storageResolver: Mocked<StorageResolverService>;
  let outboundDispatcher: Mocked<IOutboundDispatcher>;
  let outboundGatewayRepository: FakeOutboundGatewayRepository;
  let syncLogRepository: FakeSyncLogRepository;
  let pipelineStateRepository: FakePipelineStateRepository;
  let stitchRepository: Mocked<StitchRepositoryPort>;
  let transactionManager: FakeTransactionManager;
  let retryService: Mocked<DeliveryRetryService>;
  let gemService: Mocked<GemHydrationService>;
  let claimDeliveryUseCase: Mocked<ClaimDeliveryUseCase>;
  let tokenManagerService: Mocked<TokenManagerService>;
  let service: DeliveryService;

  beforeEach(() => {
    queueService = { consume: vi.fn() } as any;
    storageResolver = { resolveSchemaName: vi.fn() } as any;
    outboundDispatcher = { dispatch: vi.fn() } as any;
    outboundGatewayRepository = new FakeOutboundGatewayRepository();
    syncLogRepository = new FakeSyncLogRepository();
    pipelineStateRepository = new FakePipelineStateRepository();
    stitchRepository = { findById: vi.fn() } as any;
    transactionManager = new FakeTransactionManager();
    retryService = {} as any;
    gemService = { writeGemMapping: vi.fn() } as any;
    claimDeliveryUseCase = { execute: vi.fn() } as any;
    tokenManagerService = { getValidCredentials: vi.fn() } as any;

    service = new DeliveryService(
      queueService,
      storageResolver,
      outboundDispatcher,
      outboundGatewayRepository,
      syncLogRepository,
      pipelineStateRepository,
      stitchRepository,
      transactionManager,
      retryService,
      gemService,
      claimDeliveryUseCase,
      tokenManagerService
    );
  });

  const validMsg = {
    traceId: 'tr-1',
    srcDataSourceId: 'ds-1',
    destDataSourceId: 'ds-2',
    routeId: 'rt-1',
    hydratedPayload: { foo: 'bar' },
    srcVendorId: 'vend-1',
    canonicalType: 'Contact',
    srcAppName: 'salesforce',
    srcTenantId: 'ten-1',
  };

  it('initializes queue consumer on module init', () => {
    service.onModuleInit();
    expect(queueService.consume).toHaveBeenCalledWith(QueueName.DeliveryQueue, expect.any(Function));
  });

  it('drops message if missing required fields', async () => {
    await (service as any).processMessage({ traceId: 'tr-1' });
    expect(claimDeliveryUseCase.execute).not.toHaveBeenCalled();
  });

  it('terminates early if claim delivery terminates', async () => {
    claimDeliveryUseCase.execute.mockResolvedValue({ status: 'TERMINATED' });
    
    await (service as any).processMessage(validMsg);
    
    expect(claimDeliveryUseCase.execute).toHaveBeenCalled();
    expect(tokenManagerService.getValidCredentials).not.toHaveBeenCalled();
  });

  it('throws error if token manager is missing', async () => {
    const serviceWithoutTokenManager = new DeliveryService(
      queueService,
      storageResolver,
      outboundDispatcher,
      outboundGatewayRepository,
      syncLogRepository,
      pipelineStateRepository,
      stitchRepository,
      transactionManager,
      retryService,
      gemService,
      claimDeliveryUseCase,
      undefined // No token manager
    );

    claimDeliveryUseCase.execute.mockResolvedValue({
      status: 'CLAIMED',
      destSchemaName: 'ws_ds-2',
      srcSchemaName: 'ws_ds-1',
      outboundGatewayId: 'gw-1',
      attemptCount: 1,
      tenantId: 'ten-1',
      targetAppName: 'quickbooks',
      targetTenantId: 'ten-1',
    });

    await expect((serviceWithoutTokenManager as any).processMessage(validMsg)).rejects.toThrow('TokenManagerService unavailable');
  });

  it('processes delivery successfully and finalizes source schema', async () => {
    claimDeliveryUseCase.execute.mockResolvedValue({
      status: 'CLAIMED',
      destSchemaName: 'ws_ds-2',
      srcSchemaName: 'ws_ds-1',
      outboundGatewayId: 'gw-1',
      attemptCount: 1,
      tenantId: 'ten-1',
      targetAppName: 'quickbooks',
      targetTenantId: 'ten-1',
    });

    tokenManagerService.getValidCredentials.mockResolvedValue({ accessToken: 'abc' } as any);
    stitchRepository.findById.mockResolvedValue({ targetObject: 'Customer' } as any);

    outboundDispatcher.dispatch.mockResolvedValue({
      statusCode: 200,
      retry: false,
      body: {},
      sentPayload: { foo: 'bar' },
      entityId: 'qb-vend-1',
    });

    const writeL6Spy = vi.spyOn(service, 'writeL6Result');

    await (service as any).processMessage(validMsg);

    expect(outboundDispatcher.dispatch).toHaveBeenCalledWith('quickbooks', {
      targetObject: 'Customer',
      payload: { foo: 'bar' },
      credentials: { accessToken: 'abc' },
    });

    expect(writeL6Spy).toHaveBeenCalled();
    expect(gemService.writeGemMapping).toHaveBeenCalledWith('ten-1', expect.objectContaining({
      srcVendorId: 'vend-1',
      destVendorId: 'qb-vend-1',
    }));
    
    // Checks that the result was recorded in destination schema
    expect(Array.from(outboundGatewayRepository.data.values()).length).toBe(1);
    expect(Array.from(outboundGatewayRepository.data.values())[0].status).toBe('SUCCESS');
  });

  it('defers to SQS for retry if API call returns RETRY', async () => {
    claimDeliveryUseCase.execute.mockResolvedValue({
      status: 'CLAIMED',
      destSchemaName: 'ws_ds-2',
      srcSchemaName: 'ws_ds-1',
      outboundGatewayId: 'gw-1',
      attemptCount: 1,
      tenantId: 'ten-1',
      targetAppName: 'quickbooks',
      targetTenantId: 'ten-1',
    });

    tokenManagerService.getValidCredentials.mockResolvedValue({ accessToken: 'abc' } as any);
    outboundDispatcher.dispatch.mockResolvedValue({
      statusCode: 429,
      retry: true,
      body: {},
    });

    await expect((service as any).processMessage(validMsg)).rejects.toThrow('API call failed with retryable error');

    // Make sure finalStatus RETRY writes FAIL to sync log
    const syncLogs = syncLogRepository.logs;
    expect(syncLogs.length).toBe(1);
    expect(syncLogs[0].status).toBe('FAIL'); // RETRY mapped to FAIL
  });

  it('defers to SQS if source finalization fails on SUCCESS', async () => {
    claimDeliveryUseCase.execute.mockResolvedValue({
      status: 'CLAIMED',
      destSchemaName: 'ws_ds-2',
      srcSchemaName: 'ws_ds-1',
      outboundGatewayId: 'gw-1',
      attemptCount: 1,
      tenantId: 'ten-1',
      targetAppName: 'quickbooks',
      targetTenantId: 'ten-1',
    });

    tokenManagerService.getValidCredentials.mockResolvedValue({ accessToken: 'abc' } as any);
    outboundDispatcher.dispatch.mockResolvedValue({ statusCode: 200, retry: false, entityId: 'qb-vend-1', body: {} });

    // Make GEM writing fail to trigger source commit failure
    gemService.writeGemMapping.mockRejectedValue(new Error('DB connection lost'));

    await expect((service as any).processMessage(validMsg)).rejects.toThrow('Delivery succeeded but source-side finalization failed');
  });
});
