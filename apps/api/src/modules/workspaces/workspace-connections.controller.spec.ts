import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard, PermissionsGuard } from '@nexiom/auth';
import { WorkspaceConnectionsController } from './workspace-connections.controller.js';
import { WorkspacesService } from './workspaces.service.js';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { ORG_ID, WS_ID, CONN_ID, makeAuth } from './workspace-test-fixtures.js';

const WORKSPACE = {
  id: WS_ID,
  orgId: ORG_ID,
  name: 'Logistics',
  envType: 'PRODUCTION' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildMockDb() {
  // Supports .select({}).from().where().limit() — returns an array
  const selectRows = vi.fn<() => Promise<unknown[]>>();
  const limit = vi.fn().mockImplementation(() => selectRows());
  const selectWhere = vi.fn().mockReturnValue({ limit });
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const select = vi.fn().mockReturnValue({ from: selectFrom });

  const insert = vi.fn();
  const del = vi.fn();
  const returning = vi.fn();
  const deleteWhere = vi.fn();

  insert.mockReturnValue({ values: vi.fn().mockReturnValue({ returning }) });
  del.mockReturnValue({ where: deleteWhere });

  return {
    selectRows,
    returning,
    deleteWhere,
    db: {
      select,
      insert,
      delete: del,
    },
  };
}

describe('WorkspaceConnectionsController', () => {
  let controller: WorkspaceConnectionsController;
  let mocks: ReturnType<typeof buildMockDb>;

  const mockService = {
    findOne: vi.fn(),
    listConnections: vi.fn(),
    listAvailableConnections: vi.fn(),
  };

  beforeEach(async () => {
    mocks = buildMockDb();

    const module = await Test.createTestingModule({
      controllers: [WorkspaceConnectionsController],
      providers: [
        { provide: WorkspacesService, useValue: mockService },
        { provide: DATABASE_CONNECTION, useValue: mocks.db },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(WorkspaceConnectionsController);
    vi.clearAllMocks();
  });

  // ── listConnections ───────────────────────────────────────────────────────

  it('listConnections — delegates to service', async () => {
    const rows = [{ id: CONN_ID, appName: 'salesforce' }];
    mockService.listConnections.mockResolvedValue(rows);

    const result = await controller.listConnections(makeAuth(), WS_ID);
    expect(result).toBe(rows);
    expect(mockService.listConnections).toHaveBeenCalledWith(ORG_ID, WS_ID);
  });

  // ── assign ────────────────────────────────────────────────────────────────

  it('assign — inserts and returns the assignment', async () => {
    const assignment = {
      workspaceId: WS_ID,
      dataSourceId: CONN_ID,
      assignedAt: new Date(),
    };
    mockService.findOne.mockResolvedValue(WORKSPACE);
    mocks.selectRows.mockResolvedValue([
      {
        id: CONN_ID,
        tenantId: ORG_ID,
        envType: 'PRODUCTION',
      },
    ]);
    mocks.returning.mockResolvedValue([assignment]);

    const result = await controller.assign(makeAuth(), WS_ID, CONN_ID);
    expect(result).toBe(assignment);
  });

  it('assign — throws NotFoundException when connection is not ACTIVE (inactive/revoked)', async () => {
    mockService.findOne.mockResolvedValue(WORKSPACE);
    // DB returns empty because status filter excludes non-ACTIVE connections
    mocks.selectRows.mockResolvedValue([]);

    await expect(controller.assign(makeAuth(), WS_ID, CONN_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('assign — throws NotFoundException when connection does not belong to org', async () => {
    mockService.findOne.mockResolvedValue(WORKSPACE);
    mocks.selectRows.mockResolvedValue([]);

    await expect(controller.assign(makeAuth(), WS_ID, CONN_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('assign — throws ConflictException when connection env_type does not match workspace env_type', async () => {
    mockService.findOne.mockResolvedValue(WORKSPACE); // envType: 'PRODUCTION'
    mocks.selectRows.mockResolvedValue([
      {
        id: CONN_ID,
        tenantId: ORG_ID,
        envType: 'SANDBOX',
      },
    ]);

    await expect(controller.assign(makeAuth(), WS_ID, CONN_ID)).rejects.toThrow(
      ConflictException,
    );
  });

  it('assign — throws ConflictException on PG unique violation', async () => {
    mockService.findOne.mockResolvedValue(WORKSPACE);
    mocks.selectRows.mockResolvedValue([
      {
        id: CONN_ID,
        tenantId: ORG_ID,
        envType: 'PRODUCTION',
      },
    ]);
    mocks.returning.mockRejectedValue(
      Object.assign(new Error('unique'), { code: '23505' }),
    );

    await expect(controller.assign(makeAuth(), WS_ID, CONN_ID)).rejects.toThrow(
      ConflictException,
    );
  });

  it('assign — re-throws unexpected errors', async () => {
    mockService.findOne.mockResolvedValue(WORKSPACE);
    mocks.selectRows.mockResolvedValue([
      {
        id: CONN_ID,
        tenantId: ORG_ID,
        envType: 'PRODUCTION',
      },
    ]);
    mocks.returning.mockRejectedValue(new Error('db down'));

    await expect(controller.assign(makeAuth(), WS_ID, CONN_ID)).rejects.toThrow(
      'db down',
    );
  });

  // ── listAvailable ─────────────────────────────────────────────────────────

  it('listAvailable — delegates to service', async () => {
    const rows = [
      { id: CONN_ID, appName: 'salesforce', envType: 'PRODUCTION' },
    ];
    mockService.listAvailableConnections.mockResolvedValue(rows);

    const result = await controller.listAvailable(makeAuth(), WS_ID);
    expect(result).toBe(rows);
    expect(mockService.listAvailableConnections).toHaveBeenCalledWith(
      ORG_ID,
      WS_ID,
    );
  });

  // ── unassign ──────────────────────────────────────────────────────────────

  it('unassign — removes the assignment', async () => {
    mockService.findOne.mockResolvedValue(WORKSPACE);
    mocks.deleteWhere.mockResolvedValue(undefined);

    await expect(
      controller.unassign(makeAuth(), WS_ID, CONN_ID),
    ).resolves.toBeUndefined();
    expect(mocks.deleteWhere).toHaveBeenCalled();
  });

  it('unassign — throws NotFoundException when workspace not found', async () => {
    mockService.findOne.mockRejectedValue(new NotFoundException());

    await expect(
      controller.unassign(makeAuth(), WS_ID, CONN_ID),
    ).rejects.toThrow(NotFoundException);
  });
});
