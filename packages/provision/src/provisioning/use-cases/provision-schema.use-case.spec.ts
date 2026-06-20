import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProvisionSchemaUseCase } from './provision-schema.use-case.js';
import type { RegistryReplicationPort } from '../../shared/ports/registry-replication.port.js';
import type { DatabaseManager } from '@soopa/dbmanager';
import { SchemaPlan } from '@soopa/dbmanager';

describe('ProvisionSchemaUseCase', () => {
  let useCase: ProvisionSchemaUseCase;
  let registryPort: import('vitest').Mocked<RegistryReplicationPort>;
  let dbManager: import('vitest').Mocked<DatabaseManager>;

  beforeEach(() => {
    registryPort = {
      fetchGlobalOutboxRecord: vi.fn(),
      replicateEntity: vi.fn(),
      markGlobalOutboxSuccess: vi.fn(),
      getStitchDataSources: vi.fn(),
      activateConnection: vi.fn(),
      registerCdcTables: vi.fn(),
    };
    
    dbManager = {
      applyPlan: vi.fn(),
      getTenantDb: vi.fn(),
    } as any;

    useCase = new ProvisionSchemaUseCase(registryPort, dbManager);
  });

  it('should ignore if outbox record is not found', async () => {
    registryPort.fetchGlobalOutboxRecord.mockResolvedValue(null);
    await useCase.execute({ outboxId: '123' });
    expect(dbManager.applyPlan).not.toHaveBeenCalled();
    expect(registryPort.markGlobalOutboxSuccess).not.toHaveBeenCalled();
  });

  it('should provision schema and mark success', async () => {
    registryPort.fetchGlobalOutboxRecord.mockResolvedValue({
      id: '123',
      tenantId: 'tenant-1',
      entityType: 'SCHEMA_PROVISION' as any,
      entityId: 'conn-1',
      action: 'APPLY' as any,
      payload: {
        plan: SchemaPlan.STANDARD_ACTIVE,
        schemaName: 'ws_test_schema',
        appName: 'test-app',
        appProfile: 'test-profile'
      },
      createdAt: new Date(),
    } as any);

    await useCase.execute({ outboxId: '123' });

    expect(dbManager.applyPlan).toHaveBeenCalledWith(
      'tenant-1',
      'ws_test_schema',
      SchemaPlan.STANDARD_ACTIVE,
      { appName: 'test-app', appProfile: 'test-profile' }
    );
    expect(registryPort.registerCdcTables).toHaveBeenCalledWith('tenant-1', 'ws_test_schema');
    expect(registryPort.activateConnection).toHaveBeenCalledWith('tenant-1', 'conn-1', SchemaPlan.STANDARD_ACTIVE);
    expect(registryPort.markGlobalOutboxSuccess).toHaveBeenCalledWith('123');
  });

  it('should throw if entityType is unrecognized', async () => {
    registryPort.fetchGlobalOutboxRecord.mockResolvedValue({
      id: '123',
      tenantId: 'tenant-1',
      entityType: 'UNKNOWN_EVENT' as any,
      entityId: 'conn-1',
      action: 'APPLY' as any,
      payload: {},
      createdAt: new Date(),
    } as any);

    await expect(useCase.execute({ outboxId: '123' })).rejects.toThrow('Unexpected outbox row type or action');

    expect(dbManager.applyPlan).not.toHaveBeenCalled();
    expect(registryPort.markGlobalOutboxSuccess).not.toHaveBeenCalled();
  });
});
