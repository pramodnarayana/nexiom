import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard, PermissionsGuard } from '@soopa/auth';
import { WorkspaceConnectionsController } from './workspace-connections.controller.js';
import { SyncRunner } from '../scheduler/sync-runner.js';
import { WorkspaceRepository } from './repositories/workspace.repository.js';
import { ORG_ID, WS_ID, CONN_ID, makeAuth } from './workspace-test-fixtures.js';

const WORKSPACE = {
  id: WS_ID,
  orgId: ORG_ID,
  name: 'Logistics',
  envType: 'PRODUCTION' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const CONN = { id: CONN_ID, envType: 'PRODUCTION' as const };
const ASSIGNMENT = {
  workspaceId: WS_ID,
  dataSourceId: CONN_ID,
  assignedAt: new Date(),
};

describe('WorkspaceConnectionsController', () => {
  let controller: WorkspaceConnectionsController;
  let repo: {
    findByIdAndOrg: ReturnType<typeof vi.fn>;
    listConnections: ReturnType<typeof vi.fn>;
    listAvailableConnections: ReturnType<typeof vi.fn>;
    findConnectionForAssignment: ReturnType<typeof vi.fn>;
    findConnectionForSync: ReturnType<typeof vi.fn>;
    assignConnection: ReturnType<typeof vi.fn>;
    unassignConnection: ReturnType<typeof vi.fn>;
  };
  let syncRunner: { run: ReturnType<typeof vi.fn> };
  let module: import('@nestjs/testing').TestingModule;

  beforeEach(async () => {
    repo = {
      findByIdAndOrg: vi.fn().mockResolvedValue(WORKSPACE),
      listConnections: vi.fn().mockResolvedValue([]),
      listAvailableConnections: vi.fn().mockResolvedValue([]),
      findConnectionForAssignment: vi.fn().mockResolvedValue(CONN),
      findConnectionForSync: vi.fn().mockResolvedValue(CONN),
      assignConnection: vi.fn().mockResolvedValue(ASSIGNMENT),
      unassignConnection: vi.fn().mockResolvedValue(undefined),
    };

    syncRunner = { run: vi.fn() };

    module = await Test.createTestingModule({
      controllers: [WorkspaceConnectionsController],
      providers: [
        { provide: WorkspaceRepository, useValue: repo },
        { provide: SyncRunner, useValue: syncRunner },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(WorkspaceConnectionsController);
  });

  afterEach(() => module.close());

  // ── listConnections ───────────────────────────────────────────────────────

  it('listConnections — returns connections for the workspace', async () => {
    const rows = [{ id: CONN_ID, appName: 'salesforce' }];
    repo.listConnections.mockResolvedValue(rows);

    const result = await controller.listConnections(makeAuth(), WS_ID);

    expect(result).toBe(rows);
    expect(repo.findByIdAndOrg).toHaveBeenCalledWith(WS_ID, ORG_ID);
    expect(repo.listConnections).toHaveBeenCalledWith(
      ORG_ID,
      WORKSPACE.envType,
      WS_ID,
    );
  });

  it('listConnections — throws NotFoundException when workspace not found', async () => {
    repo.findByIdAndOrg.mockResolvedValueOnce(null);
    await expect(controller.listConnections(makeAuth(), WS_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  // ── listAvailable ─────────────────────────────────────────────────────────

  it('listAvailable — returns available connections', async () => {
    const rows = [
      { id: CONN_ID, appName: 'salesforce', envType: 'PRODUCTION' },
    ];
    repo.listAvailableConnections.mockResolvedValue(rows);

    const result = await controller.listAvailable(makeAuth(), WS_ID);

    expect(result).toBe(rows);
    expect(repo.listAvailableConnections).toHaveBeenCalledWith(
      ORG_ID,
      WORKSPACE.envType,
      WS_ID,
    );
  });

  it('listAvailable — throws NotFoundException when workspace not found', async () => {
    repo.findByIdAndOrg.mockResolvedValueOnce(null);
    await expect(controller.listAvailable(makeAuth(), WS_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  // ── assign ────────────────────────────────────────────────────────────────

  it('assign — inserts and returns the assignment', async () => {
    const result = await controller.assign(makeAuth(), WS_ID, CONN_ID);

    expect(result).toBe(ASSIGNMENT);
    expect(repo.findConnectionForAssignment).toHaveBeenCalledWith(
      CONN_ID,
      ORG_ID,
    );
    expect(repo.assignConnection).toHaveBeenCalledWith(WS_ID, CONN_ID);
  });

  it('assign — throws NotFoundException when workspace not found', async () => {
    repo.findByIdAndOrg.mockResolvedValueOnce(null);
    await expect(controller.assign(makeAuth(), WS_ID, CONN_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('assign — throws NotFoundException when connection not found', async () => {
    repo.findConnectionForAssignment.mockResolvedValueOnce(null);
    await expect(controller.assign(makeAuth(), WS_ID, CONN_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('assign — throws ConflictException when env_type does not match', async () => {
    repo.findConnectionForAssignment.mockResolvedValueOnce({
      id: CONN_ID,
      envType: 'SANDBOX',
    });
    await expect(controller.assign(makeAuth(), WS_ID, CONN_ID)).rejects.toThrow(
      ConflictException,
    );
  });

  it('assign — throws ConflictException when connection already assigned (repo returns null)', async () => {
    repo.assignConnection.mockResolvedValueOnce(null);
    await expect(controller.assign(makeAuth(), WS_ID, CONN_ID)).rejects.toThrow(
      ConflictException,
    );
  });

  it('assign — re-throws unexpected repository errors', async () => {
    repo.assignConnection.mockRejectedValueOnce(new Error('db down'));
    await expect(controller.assign(makeAuth(), WS_ID, CONN_ID)).rejects.toThrow(
      'db down',
    );
  });

  // ── unassign ──────────────────────────────────────────────────────────────

  it('unassign — removes the assignment', async () => {
    await expect(
      controller.unassign(makeAuth(), WS_ID, CONN_ID),
    ).resolves.toBeUndefined();
    expect(repo.unassignConnection).toHaveBeenCalledWith(WS_ID, CONN_ID);
  });

  it('unassign — throws NotFoundException when workspace not found', async () => {
    repo.findByIdAndOrg.mockResolvedValueOnce(null);
    await expect(
      controller.unassign(makeAuth(), WS_ID, CONN_ID),
    ).rejects.toThrow(NotFoundException);
  });

  // ── sync ──────────────────────────────────────────────────────────────────

  describe('sync', () => {
    it('throws BadRequestException for invalid objectType', async () => {
      await expect(
        controller.sync(makeAuth(), WS_ID, CONN_ID, 'invalid/object!'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when workspace not found', async () => {
      repo.findByIdAndOrg.mockResolvedValueOnce(null);
      await expect(
        controller.sync(makeAuth(), WS_ID, CONN_ID, 'ValidObject_1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when connection not found', async () => {
      repo.findConnectionForSync.mockResolvedValueOnce(null);
      await expect(
        controller.sync(makeAuth(), WS_ID, CONN_ID, 'ValidObject_1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('executes sync via syncRunner and returns result', async () => {
      const syncResult = { status: 'success' };
      syncRunner.run.mockResolvedValue(syncResult);

      const result = await controller.sync(
        makeAuth(),
        WS_ID,
        CONN_ID,
        'ValidObject_1',
      );

      expect(result).toBe(syncResult);
      expect(repo.findConnectionForSync).toHaveBeenCalledWith(
        CONN_ID,
        ORG_ID,
        WORKSPACE.envType,
      );
      expect(syncRunner.run).toHaveBeenCalledWith(CONN_ID, 'ValidObject_1');
    });
  });
});
