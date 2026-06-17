import { describe, it, expect, vi, beforeEach } from "vitest";
import { DependencySweeperService } from "./dependency-sweeper.service.js";
import { QueueName } from "@soopa/queue";
import { FakeDependencySweeperRepository } from "../shared/fakes/fake-dependency-sweeper.repository.js";
import { v4 as uuidv4 } from "uuid";

describe("DependencySweeperService (Unit)", () => {
  let service: DependencySweeperService;
  let queueService: any;
  let repo: FakeDependencySweeperRepository;

  beforeEach(() => {
    queueService = { send: vi.fn() };
    repo = new FakeDependencySweeperRepository();
    
    service = new DependencySweeperService(
      queueService as any,
      repo
    );
  });

  it("should sweep deferred dependencies and re-queue them", async () => {
    const tenantId = "tenant1";
    const schemaName = "ws_123";
    const traceId = uuidv4();
    const dsId = uuidv4();
    
    repo.tenants.push({ tenantId });
    repo.activeConnections.push({
      id: uuidv4(),
      appName: "testApp",
      tenantId,
      vendorTenantId: "vendor1",
      schemaName,
    });
    
    // Older than 5 minutes
    repo.deferredTraces.push({
      tenantId,
      schemaName,
      traceId,
      routeId: 'rt-1',
      timestamp: Date.now() - 6 * 60 * 1000,
      claimed: false,
    });
    
    repo.replicaDataSources.push({
      tenantId,
      schemaName,
      traceId,
      dataSourceId: dsId,
    });

    await service.sweepDeferredDependencies();

    expect(queueService.send).toHaveBeenCalledWith(QueueName.NormalizedQueue, {
      traceId,
      dataSourceId: dsId,
    });

    // Verify it was claimed
    const trace = repo.deferredTraces.find(t => t.traceId === traceId);
    expect(trace?.claimed).toBe(true);
  });

  it("should return early if no tenants exist", async () => {
    await service.sweepDeferredDependencies();
    expect(queueService.send).not.toHaveBeenCalled();
  });

  it("should skip requeue if replica is not found", async () => {
    const tenantId = "tenant1";
    const schemaName = "ws_123";
    const traceId = uuidv4();
    
    repo.tenants.push({ tenantId });
    repo.activeConnections.push({
      id: uuidv4(),
      appName: "testApp",
      tenantId,
      vendorTenantId: "vendor1",
      schemaName,
    });
    
    repo.deferredTraces.push({
      tenantId,
      schemaName,
      traceId,
      routeId: 'rt-1',
      timestamp: Date.now() - 6 * 60 * 1000,
      claimed: false,
    });
    
    // No replica rows added

    await service.sweepDeferredDependencies();

    expect(queueService.send).not.toHaveBeenCalled();
    const trace = repo.deferredTraces.find(t => t.traceId === traceId);
    expect(trace?.claimed).toBe(false); // Should not have claimed because we early-exit when no replica
  });

  it("should not send to queue if update affects zero rows (already claimed)", async () => {
    const tenantId = "tenant1";
    const schemaName = "ws_123";
    const traceId = uuidv4();
    const dsId = uuidv4();
    
    repo.tenants.push({ tenantId });
    repo.activeConnections.push({
      id: uuidv4(),
      appName: "testApp",
      tenantId,
      vendorTenantId: "vendor1",
      schemaName,
    });
    
    repo.deferredTraces.push({
      tenantId,
      schemaName,
      traceId,
      routeId: 'rt-1',
      timestamp: Date.now() - 6 * 60 * 1000,
      claimed: true, // Already claimed by another worker!
    });
    
    repo.replicaDataSources.push({
      tenantId,
      schemaName,
      traceId,
      dataSourceId: dsId,
    });

    await service.sweepDeferredDependencies();

    expect(queueService.send).not.toHaveBeenCalled();
  });

  it("should ignore records newer than 5 minutes", async () => {
    const tenantId = "tenant1";
    const schemaName = "ws_123";
    const traceId = uuidv4();
    const dsId = uuidv4();
    
    repo.tenants.push({ tenantId });
    repo.activeConnections.push({
      id: uuidv4(),
      appName: "testApp",
      tenantId,
      vendorTenantId: "vendor1",
      schemaName,
    });
    
    repo.deferredTraces.push({
      tenantId,
      schemaName,
      traceId,
      routeId: 'rt-1',
      timestamp: Date.now() - 2 * 60 * 1000, // Only 2 mins old
      claimed: false,
    });
    
    repo.replicaDataSources.push({
      tenantId,
      schemaName,
      traceId,
      dataSourceId: dsId,
    });

    await service.sweepDeferredDependencies();

    expect(queueService.send).not.toHaveBeenCalled();
  });

  it('skips trace if already processed by another connection in same tenant sweep', async () => {
    repo.tenants.push({ tenantId: 'tenant-1' });
    
    // Two connections for same tenant
    repo.activeConnections.push(
      { tenantId: 'tenant-1', id: 'conn-1', appName: 'app1', schemaName: 'ws_conn1', vendorTenantId: 'vendor1' },
      { tenantId: 'tenant-1', id: 'conn-2', appName: 'app2', schemaName: 'ws_conn2', vendorTenantId: 'vendor1' }
    );

    // Both schemas return the same traceId
    const traceId = 'trace-1';
    repo.deferredTraces.push(
      { tenantId: 'tenant-1', schemaName: 'ws_conn1', traceId, routeId: 'rt-1', timestamp: Date.now() - 6 * 60 * 1000, claimed: false },
      { tenantId: 'tenant-1', schemaName: 'ws_conn2', traceId, routeId: 'rt-1', timestamp: Date.now() - 6 * 60 * 1000, claimed: false }
    );
    
    repo.replicaDataSources.push(
      { tenantId: 'tenant-1', schemaName: 'ws_conn1', traceId, dataSourceId: 'ds-1' },
      { tenantId: 'tenant-1', schemaName: 'ws_conn2', traceId, dataSourceId: 'ds-1' }
    );

    vi.spyOn(repo, 'getDeferredTraces');
    vi.spyOn(repo, 'claimDeferredTrace');

    await service.sweepDeferredDependencies();

    // First connection will process it, second connection should skip it (uniqueTraceIds.length === 0)
    expect(repo.getDeferredTraces).toHaveBeenCalledTimes(2); // Once for each schema
    
    // claim and send should only happen ONCE for trace-1
    expect(repo.claimDeferredTrace).toHaveBeenCalledTimes(1);
    expect(queueService.send).toHaveBeenCalledTimes(1);
  });

  it('handles per-trace error without crashing tenant loop', async () => {
    repo.tenants.push({ tenantId: 'tenant-1' });
    repo.activeConnections.push(
      { tenantId: 'tenant-1', id: 'conn-1', appName: 'app', schemaName: 'ws_conn1', vendorTenantId: 'vendor1' },
    );

    repo.deferredTraces.push(
      { tenantId: 'tenant-1', schemaName: 'ws_conn1', traceId: 'trace-good', routeId: 'rt-1', timestamp: Date.now() - 6 * 60 * 1000, claimed: false },
      { tenantId: 'tenant-1', schemaName: 'ws_conn1', traceId: 'trace-bad', routeId: 'rt-2', timestamp: Date.now() - 6 * 60 * 1000, claimed: false }
    );
    
    repo.replicaDataSources.push(
      { tenantId: 'tenant-1', schemaName: 'ws_conn1', traceId: 'trace-good', dataSourceId: 'ds-good' },
      { tenantId: 'tenant-1', schemaName: 'ws_conn1', traceId: 'trace-bad', dataSourceId: 'ds-bad' }
    );

    // Make claim fail for trace-bad
    vi.spyOn(repo, 'claimDeferredTrace').mockImplementation(async (tenantId, schema, traceId, routeId) => {
      if (traceId === 'trace-bad') throw new Error('Simulated trace error');
      return true;
    });

    await service.sweepDeferredDependencies();

    // Good trace should still process
    expect(queueService.send).toHaveBeenCalledWith(QueueName.NormalizedQueue, { traceId: 'trace-good', dataSourceId: 'ds-good' });
    expect(queueService.send).toHaveBeenCalledTimes(1);
  });

  it('handles per-connection error without crashing tenant loop', async () => {
    repo.tenants.push({ tenantId: 'tenant-1' });
    repo.activeConnections.push(
      { tenantId: 'tenant-1', id: 'conn-bad', appName: 'app', schemaName: 'ws_bad', vendorTenantId: 'vendor1' },
      { tenantId: 'tenant-1', id: 'conn-good', appName: 'app', schemaName: 'ws_good', vendorTenantId: 'vendor1' }
    );

    // Make getDeferredTraces fail for ws_bad
    vi.spyOn(repo, 'getDeferredTraces').mockImplementation(async (tenantId, schema, olderThan) => {
      if (schema === 'ws_bad') throw new Error('Simulated conn error');
      return [{ traceId: 'trace-1', routeId: 'rt-1' }];
    });

    repo.replicaDataSources.push({ tenantId: 'tenant-1', schemaName: 'ws_good', traceId: 'trace-1', dataSourceId: 'ds-1' });
    
    vi.spyOn(repo, 'claimDeferredTrace').mockResolvedValue(true);

    await service.sweepDeferredDependencies();

    // Good connection should still process
    expect(repo.claimDeferredTrace).toHaveBeenCalledWith('tenant-1', 'ws_good', 'trace-1', 'rt-1');
    expect(queueService.send).toHaveBeenCalledTimes(1);
  });

  it('handles per-tenant error', async () => {
    repo.tenants.push(
      { tenantId: 'tenant-bad' },
      { tenantId: 'tenant-good' }
    );
    
    repo.activeConnections.push(
      { tenantId: 'tenant-bad', id: 'conn-bad', appName: 'app', schemaName: 'ws_bad', vendorTenantId: 'vendor1' },
      { tenantId: 'tenant-good', id: 'conn-good', appName: 'app', schemaName: 'ws_good', vendorTenantId: 'vendor1' }
    );

    vi.spyOn(repo, 'getDeferredTraces').mockImplementation(async (tenantId, schema, older) => {
       if (tenantId === 'tenant-bad') throw new Error('Simulated tenant error');
       return [{ traceId: 'trace-good', routeId: 'rt-1' }];
    });
    
    repo.replicaDataSources.push({ tenantId: 'tenant-good', schemaName: 'ws_good', traceId: 'trace-good', dataSourceId: 'ds-good' });
    vi.spyOn(repo, 'claimDeferredTrace').mockResolvedValue(true);

    await service.sweepDeferredDependencies();

    // Good tenant should still process
    expect(queueService.send).toHaveBeenCalledTimes(1);
  });

  it('handles critical failure', async () => {
    vi.spyOn(repo, 'getActiveTenants').mockRejectedValue(new Error('Critical DB failure'));

    // Should not throw, should be caught and logged
    await expect(service.sweepDeferredDependencies()).resolves.not.toThrow();
  });
});
