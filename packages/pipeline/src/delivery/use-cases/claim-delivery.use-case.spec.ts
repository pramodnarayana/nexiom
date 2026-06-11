import { describe, it, expect, vi, beforeEach, Mocked, Mock } from 'vitest';
import { ClaimDeliveryUseCase, ClaimDeliveryInput } from './claim-delivery.use-case.js';
import { StorageResolverService } from '../../storage-resolver/storage-resolver.service.js';
import { FakeConnectionRepository } from '../../shared/fakes/fake-connection.repository.js';
import { FakeOutboundGatewayRepository } from '../../shared/fakes/fake-outbound-gateway.repository.js';
import { DeliveryRetryService } from '../delivery-retry.service.js';
import { MAX_DELIVERY_ATTEMPTS } from '../delivery.service.js';
import type { TransactionManagerPort } from '../../shared/ports/transaction-manager.port.js';
describe('ClaimDeliveryUseCase', () => {
  let storageResolver: Mocked<StorageResolverService>;
  let connectionPort: FakeConnectionRepository;
  let outboundGatewayRepository: FakeOutboundGatewayRepository;
  let retryService: Mocked<DeliveryRetryService>;
  let useCase: ClaimDeliveryUseCase;
  let writeL6ResultFn: any;
  let transactionManager: Mocked<TransactionManagerPort>;

  beforeEach(() => {
    storageResolver = {
      resolveSchemaName: vi.fn().mockImplementation(async (id: string) => `ws_${id}`),
    } as any;
    connectionPort = new FakeConnectionRepository();
    outboundGatewayRepository = new FakeOutboundGatewayRepository();
    retryService = {
      isSourceFinalized: vi.fn(),
      retrySourceFinalization: vi.fn(),
    } as any;

    writeL6ResultFn = vi.fn().mockResolvedValue(true);

    useCase = new ClaimDeliveryUseCase(
      storageResolver,
      connectionPort,
      outboundGatewayRepository,
      retryService
    );
  });

  const defaultInput: ClaimDeliveryInput = {
    traceId: 'tr-1',
    dataSourceId: 'src-1',
    targetConnectionId: 'tgt-1',
    routeId: 'rt-1',
    hydratedPayload: { foo: 'bar' },
    canonicalType: 'Contact',
    srcAppName: 'test-app',
    srcTenantId: 'ten-1',
    start: Date.now(),
    writeL6ResultFn: vi.fn(),
  };

  it('throws error if target connection not found', async () => {
    await expect(useCase.execute({ ...defaultInput, targetConnectionId: 'missing' })).rejects.toThrow('Connection missing not found in global DB');
  });

  it('claims delivery successfully for pending record', async () => {
    connectionPort.connections.push({ dataSourceId: 'tgt-1', tenantId: 'ten-1', appName: 'target-app' } as any);

    const result = await useCase.execute({ ...defaultInput, writeL6ResultFn });

    expect(result).toMatchObject({
      status: 'CLAIMED',
      destSchemaName: 'ws_tgt-1',
      srcSchemaName: 'ws_src-1',
      tenantId: 'ten-1',
      targetAppName: 'target-app',
      attemptCount: 2,
    });
  });

  it('terminates if max delivery attempts exceeded', async () => {
    connectionPort.connections.push({ dataSourceId: 'tgt-1', tenantId: 'ten-1', appName: 'target-app' } as any);

    const gatewayRec = {
      id: 'gw-1',
      attempts: MAX_DELIVERY_ATTEMPTS,
      status: 'PENDING',
    };
    outboundGatewayRepository.data.set('ten-1_ws_tgt-1_tr-1_rt-1', gatewayRec as any);

    const result = await useCase.execute({ ...defaultInput, writeL6ResultFn });

    expect(result).toEqual({ status: 'TERMINATED' });
    expect(writeL6ResultFn).toHaveBeenCalledWith(
      'ws_tgt-1', 'ws_src-1', 'gw-1', MAX_DELIVERY_ATTEMPTS, 'src-1', 'tr-1', 'rt-1', null, null, 500, 'FAIL', expect.any(Number), undefined, 'Contact', 'test-app', 'ten-1', undefined, 'tgt-1', undefined, undefined, undefined, 'ten-1'
    );
  });

  it('terminates and does not claim if another worker claimed it', async () => {
    connectionPort.connections.push({ dataSourceId: 'tgt-1', tenantId: 'ten-1', appName: 'target-app' } as any);

    const claimMock = vi.spyOn(outboundGatewayRepository, 'claimForProcessing').mockResolvedValue({ claimed: false, attemptCount: 1 });

    const result = await useCase.execute({ ...defaultInput, writeL6ResultFn });

    expect(result).toEqual({ status: 'TERMINATED' });
    claimMock.mockRestore();
  });

  it('retries source finalization if delivery succeeded but source not finalized', async () => {
    connectionPort.connections.push({ dataSourceId: 'tgt-1', tenantId: 'ten-1', appName: 'target-app' } as any);

    outboundGatewayRepository.data.set('ten-1_ws_tgt-1_tr-1_rt-1', {
      id: 'gw-1',
      attempts: 1,
      status: 'SUCCESS',
    } as any);

    retryService.isSourceFinalized.mockResolvedValue(false);
    retryService.retrySourceFinalization.mockResolvedValue(true);

    const result = await useCase.execute({ ...defaultInput, writeL6ResultFn });

    expect(result).toEqual({ status: 'TERMINATED' });
    expect(retryService.isSourceFinalized).toHaveBeenCalledWith('ten-1', 'ws_src-1', 'tr-1', 'rt-1');
    expect(retryService.retrySourceFinalization).toHaveBeenCalled();
  });

  it('retries source finalization if delivery failed but source not finalized', async () => {
    connectionPort.connections.push({ dataSourceId: 'tgt-1', tenantId: 'ten-1', appName: 'target-app' } as any);

    outboundGatewayRepository.data.set('ten-1_ws_tgt-1_tr-1_rt-1', {
      id: 'gw-1',
      attempts: 1,
      status: 'FAIL',
    } as any);

    retryService.isSourceFinalized.mockResolvedValue(false);
    retryService.retrySourceFinalization.mockResolvedValue(true);

    const result = await useCase.execute({ ...defaultInput, writeL6ResultFn });

    expect(result).toEqual({ status: 'TERMINATED' });
    expect(retryService.isSourceFinalized).toHaveBeenCalledWith('ten-1', 'ws_src-1', 'tr-1', 'rt-1');
    expect(retryService.retrySourceFinalization).toHaveBeenCalled();
  });

  it('terminates if delivery already succeeded and source is finalized', async () => {
    connectionPort.connections.push({ dataSourceId: 'tgt-1', tenantId: 'ten-1', appName: 'target-app' } as any);

    outboundGatewayRepository.data.set('ten-1_ws_tgt-1_tr-1_rt-1', {
      id: 'gw-1',
      attempts: 1,
      status: 'SUCCESS',
    } as any);

    retryService.isSourceFinalized.mockResolvedValue(true);

    const result = await useCase.execute({ ...defaultInput, writeL6ResultFn });

    expect(result).toEqual({ status: 'TERMINATED' });
    expect(retryService.isSourceFinalized).toHaveBeenCalledWith('ten-1', 'ws_src-1', 'tr-1', 'rt-1');
    expect(retryService.retrySourceFinalization).not.toHaveBeenCalled();
  });

  it('terminates if delivery already failed and source is finalized', async () => {
    connectionPort.connections.push({ dataSourceId: 'tgt-1', tenantId: 'ten-1', appName: 'target-app' } as any);

    outboundGatewayRepository.data.set('ten-1_ws_tgt-1_tr-1_rt-1', {
      id: 'gw-1',
      attempts: 1,
      status: 'FAIL',
    } as any);

    retryService.isSourceFinalized.mockResolvedValue(true);

    const result = await useCase.execute({ ...defaultInput, writeL6ResultFn });

    expect(result).toEqual({ status: 'TERMINATED' });
    expect(retryService.isSourceFinalized).toHaveBeenCalledWith('ten-1', 'ws_src-1', 'tr-1', 'rt-1');
    expect(retryService.retrySourceFinalization).not.toHaveBeenCalled();
  });

  it('throws error if writeL6ResultFn fails after max attempts', async () => {
    connectionPort.connections.push({ dataSourceId: 'tgt-1', tenantId: 'ten-1', appName: 'target-app' } as any);

    const gatewayRec = {
      id: 'gw-1',
      attempts: MAX_DELIVERY_ATTEMPTS,
      status: 'PENDING',
    };
    outboundGatewayRepository.data.set('ten-1_ws_tgt-1_tr-1_rt-1', gatewayRec as any);
    
    writeL6ResultFn.mockResolvedValueOnce(false); // Simulate failure

    await expect(useCase.execute({ ...defaultInput, writeL6ResultFn })).rejects.toThrow('Source-side finalization failed after max attempts');
  });

  it('throws error if retrySourceFinalization fails for SUCCESS status', async () => {
    connectionPort.connections.push({ dataSourceId: 'tgt-1', tenantId: 'ten-1', appName: 'target-app' } as any);

    outboundGatewayRepository.data.set('ten-1_ws_tgt-1_tr-1_rt-1', {
      id: 'gw-1',
      attempts: 1,
      status: 'SUCCESS',
    } as any);

    retryService.isSourceFinalized.mockResolvedValue(false);
    retryService.retrySourceFinalization.mockResolvedValue(false); // Simulate failure

    await expect(useCase.execute({ ...defaultInput, writeL6ResultFn })).rejects.toThrow('Source-side finalization retry failed');
  });

  it('throws error if retrySourceFinalization fails for FAIL status', async () => {
    connectionPort.connections.push({ dataSourceId: 'tgt-1', tenantId: 'ten-1', appName: 'target-app' } as any);

    outboundGatewayRepository.data.set('ten-1_ws_tgt-1_tr-1_rt-1', {
      id: 'gw-1',
      attempts: 1,
      status: 'FAIL',
    } as any);

    retryService.isSourceFinalized.mockResolvedValue(false);
    retryService.retrySourceFinalization.mockResolvedValue(false); // Simulate failure

    await expect(useCase.execute({ ...defaultInput, writeL6ResultFn })).rejects.toThrow('Source-side finalization retry failed');
  });

  it('throws error if target connection metadata is missing in tenant DB', async () => {
    // Add it to global so getGlobalConnectionMeta passes
    const globalMeta = { dataSourceId: 'tgt-1', tenantId: 'ten-1', appName: 'target-app' };
    connectionPort.connections.push(globalMeta as any);

    // Spy on getTenantConnectionMeta and mock it to return null
    vi.spyOn(connectionPort, 'getTenantConnectionMeta').mockResolvedValue(null);

    await expect(useCase.execute({ ...defaultInput, writeL6ResultFn })).rejects.toThrow('Target connection tgt-1 not found');
  });

});
