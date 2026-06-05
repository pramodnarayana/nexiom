/* eslint-disable @typescript-eslint/unbound-method */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { ConnectionLifecycleService } from './connection-lifecycle.service.js';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  NotFoundException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { CredentialInvalidatedEvent } from '@soopa/credentials';
import type { MockedObject } from 'vitest';
import type { DatabaseManager } from '@soopa/dbmanager';
import type { StorageResolverService } from '@soopa/engine';
import type { DrizzleDb } from '@soopa/database';
describe('ConnectionLifecycleService', () => {
  let service: ConnectionLifecycleService;
  let db: MockedObject<DrizzleDb> & {
    limit: import('vitest').Mock;
    returning: import('vitest').Mock;
  };
  let dbManager: MockedObject<DatabaseManager>;
  let storageResolver: MockedObject<StorageResolverService>;
  let eventEmitter: EventEmitter2;

  beforeEach(() => {
    db = {
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      returning: vi
        .fn()
        .mockResolvedValue([{ id: '1', tenantId: 'tenant-123' }]),
      transaction: vi
        .fn()
        .mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
          cb(db),
        ),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      for: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: '1' }]),
    } as unknown as MockedObject<DrizzleDb> & {
      limit: import('vitest').Mock;
      returning: import('vitest').Mock;
    };

    dbManager = {
      applyPlan: vi.fn().mockResolvedValue(undefined),
      getTenantDb: vi.fn().mockResolvedValue({
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      }),
    } as unknown as MockedObject<DatabaseManager>;

    storageResolver = {
      resolveStorageProfile: vi
        .fn()
        .mockResolvedValue({ tenantId: 'tenant-123' }),
    } as unknown as MockedObject<StorageResolverService>;

    eventEmitter = {
      emit: vi.fn(),
    } as unknown as EventEmitter2;

    service = new ConnectionLifecycleService(
      db,
      dbManager,
      storageResolver,
      eventEmitter,
    );
  });

  describe('provisionNamespace', () => {
    it('returns early if schemaName is falsy', async () => {
      await service.provisionNamespace(
        'tenant-1',
        { schemaName: '', dataSourceId: 'ds-1', createdAppConnection: false },
        'provider',
        {},
      );
      expect(dbManager.applyPlan).not.toHaveBeenCalled();
    });

    it('provisions namespace and emits event', async () => {
      await service.provisionNamespace(
        'tenant-1',
        {
          schemaName: 'ws_123',
          dataSourceId: 'ds-1',
          createdAppConnection: true,
        },
        'provider',
        {},
      );

      expect(dbManager.applyPlan).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'connection.provisioned',
        expect.anything(),
      );
      expect(db.update).toHaveBeenCalled(); // sets to ACTIVE
    });

    it('rolls back and throws InternalServerErrorException if provision fails (createdAppConnection: true)', async () => {
      dbManager.applyPlan.mockRejectedValueOnce(new Error('applyPlan failed'));

      await expect(
        service.provisionNamespace(
          'tenant-1',
          {
            schemaName: 'ws_123',
            dataSourceId: 'ds-1',
            createdAppConnection: true,
          },
          'provider',
          {},
        ),
      ).rejects.toThrow(InternalServerErrorException);

      expect(db.update).toHaveBeenCalled(); // Should rollback
      const tenantDb = await dbManager.getTenantDb('tenant-1');
      expect(tenantDb.execute).toHaveBeenCalled(); // DROP SCHEMA
    });

    it('rolls back and throws InternalServerErrorException if provision fails (createdAppConnection: false)', async () => {
      dbManager.applyPlan.mockRejectedValueOnce(new Error('applyPlan failed'));

      await expect(
        service.provisionNamespace(
          'tenant-1',
          {
            schemaName: 'ws_123',
            dataSourceId: 'ds-1',
            createdAppConnection: false,
          },
          'provider',
          {},
        ),
      ).rejects.toThrow(InternalServerErrorException);

      // Should skip updating dataSources to FAILED because createdAppConnection is false
      // Only dbManager.applyPlan should throw, and then it goes to schema drop
      const tenantDb = await dbManager.getTenantDb('tenant-1');
      expect(tenantDb.execute).toHaveBeenCalled();
    });

    it('handles rollback errors gracefully without masking original error', async () => {
      dbManager.applyPlan.mockRejectedValueOnce(new Error('applyPlan failed'));
      db.transaction.mockRejectedValueOnce(new Error('tx rollback failed'));

      await expect(
        service.provisionNamespace(
          'tenant-1',
          {
            schemaName: 'ws_123',
            dataSourceId: 'ds-1',
            createdAppConnection: true,
          },
          'provider',
          {},
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('handles schema drop errors gracefully', async () => {
      dbManager.applyPlan.mockRejectedValueOnce(new Error('applyPlan failed'));
      const tenantDb = await dbManager.getTenantDb('tenant-1');
      (tenantDb.execute as Mock).mockRejectedValueOnce(
        new Error('drop failed'),
      );

      await expect(
        service.provisionNamespace(
          'tenant-1',
          {
            schemaName: 'ws_123',
            dataSourceId: 'ds-1',
            createdAppConnection: true,
          },
          'provider',
          {},
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('teardownNamespace', () => {
    it('throws NotFoundException if connection does not exist', async () => {
      db.limit.mockResolvedValueOnce([]); // no lockedConn
      await expect(
        service.teardownNamespace('tenant-1', 'ds-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException if storage profile tenant mismatch', async () => {
      storageResolver.resolveStorageProfile.mockResolvedValueOnce({
        tenantId: 'other-tenant',
        schemaName: 'other_schema',
      });
      await expect(
        service.teardownNamespace('tenant-1', 'ds-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException if mapping exists', async () => {
      const tenantDb = await dbManager.getTenantDb('tenant-123');
      (
        tenantDb as unknown as { limit: import('vitest').Mock }
      ).limit.mockResolvedValueOnce([{ id: 'mapping-1' }]);
      await expect(
        service.teardownNamespace('tenant-123', 'ds-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('proceeds with deletion if no mapping and valid tenant', async () => {
      await service.teardownNamespace('tenant-123', 'ds-1');
      expect(db.delete).toHaveBeenCalled();
      expect(db.insert).toHaveBeenCalled(); // outbox
    });

    it('proceeds if schema does not exist error is thrown during GEM check (pgCode 3F000)', async () => {
      const tenantDb = await dbManager.getTenantDb('tenant-1');
      (
        tenantDb as unknown as { limit: import('vitest').Mock }
      ).limit.mockRejectedValueOnce({ code: '3F000' });
      await service.teardownNamespace('tenant-123', 'ds-1');
      expect(db.delete).toHaveBeenCalled();
    });

    it('proceeds if undefined_table error is thrown during GEM check (pgCode 42P01)', async () => {
      const tenantDb = await dbManager.getTenantDb('tenant-1');
      (
        tenantDb as unknown as { limit: import('vitest').Mock }
      ).limit.mockRejectedValueOnce({
        cause: { code: '42P01' },
      });
      await service.teardownNamespace('tenant-123', 'ds-1');
      expect(db.delete).toHaveBeenCalled();
    });

    it('proceeds if schema does not exist string is in error message', async () => {
      const tenantDb = await dbManager.getTenantDb('tenant-1');
      (
        tenantDb as unknown as { limit: import('vitest').Mock }
      ).limit.mockRejectedValueOnce(
        new Error('schema custom_schema does not exist'),
      );
      await service.teardownNamespace('tenant-123', 'ds-1');
      expect(db.delete).toHaveBeenCalled();
    });

    it('proceeds if relation does not exist string is in error message', async () => {
      const tenantDb = await dbManager.getTenantDb('tenant-1');
      (
        tenantDb as unknown as { limit: import('vitest').Mock }
      ).limit.mockRejectedValueOnce(
        new Error('relation "global_entity_map" does not exist'),
      );
      await service.teardownNamespace('tenant-123', 'ds-1');
      expect(db.delete).toHaveBeenCalled();
    });

    it('aborts deletion if generic error is thrown during GEM check', async () => {
      const tenantDb = await dbManager.getTenantDb('tenant-1');
      (
        tenantDb as unknown as { limit: import('vitest').Mock }
      ).limit.mockRejectedValueOnce(new Error('DB connection failed'));
      await expect(
        service.teardownNamespace('tenant-123', 'ds-1'),
      ).rejects.toThrow('DB connection failed');
      expect(db.delete).not.toHaveBeenCalled();
    });
  });

  describe('handleCredentialInvalidated', () => {
    it('pauses connection when credential invalidated', async () => {
      const event = new CredentialInvalidatedEvent(
        'cred-1',
        'revoked',
        'salesforce',
      );
      await service.handleCredentialInvalidated(event);
      expect(db.update).toHaveBeenCalled();
      expect(db.insert).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'connection.paused',
        expect.anything(),
      );
    });

    it('does nothing if no connection was updated during credential invalidation', async () => {
      db.returning.mockResolvedValueOnce([]);

      const event = new CredentialInvalidatedEvent(
        'cred-missing',
        'revoked',
        'salesforce',
      );
      await service.handleCredentialInvalidated(event);

      // db.update is called (the initial update on dataSources), but insert and emit are not
      expect(db.insert).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('handles errors gracefully', async () => {
      db.transaction.mockRejectedValueOnce(new Error('tx failed'));
      const event = new CredentialInvalidatedEvent(
        'cred-1',
        'revoked',
        'salesforce',
      );
      await expect(
        service.handleCredentialInvalidated(event),
      ).resolves.not.toThrow();
    });
  });

  describe('handleCredentialDeleted', () => {
    it('logs credential deleted', () => {
      const loggerSpy = vi.spyOn(service['logger'], 'log');
      service.handleCredentialDeleted({
        credentialId: 'c1',
        dataSourceId: 'd1',
        tenantId: 't1',
      });
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Credential Deleted'),
      );
    });
  });
});
