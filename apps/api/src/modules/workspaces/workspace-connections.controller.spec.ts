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
  const findFirst = vi.fn();
  const insert = vi.fn();
  const del = vi.fn();
  const returning = vi.fn();
  const where = vi.fn();

  insert.mockReturnValue({ values: vi.fn().mockReturnValue({ returning }) });
  del.mockReturnValue({ where });

  return {
    findFirst,
    returning,
    where,
    db: {
      query: { appConnections: { findFirst } },
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
      connectionId: CONN_ID,
      assignedAt: new Date(),
    };
    mockService.findOne.mockResolvedValue(WORKSPACE);
    mocks.findFirst.mockResolvedValue({ id: CONN_ID, tenantId: ORG_ID });
    mocks.returning.mockResolvedValue([assignment]);

    const result = await controller.assign(makeAuth(), WS_ID, CONN_ID);
    expect(result).toBe(assignment);
  });

  it('assign — throws NotFoundException when connection does not belong to org', async () => {
    mockService.findOne.mockResolvedValue(WORKSPACE);
    mocks.findFirst.mockResolvedValue(null);

    await expect(controller.assign(makeAuth(), WS_ID, CONN_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('assign — throws ConflictException on PG unique violation', async () => {
    mockService.findOne.mockResolvedValue(WORKSPACE);
    mocks.findFirst.mockResolvedValue({ id: CONN_ID, tenantId: ORG_ID });
    mocks.returning.mockRejectedValue(
      Object.assign(new Error('unique'), { code: '23505' }),
    );

    await expect(controller.assign(makeAuth(), WS_ID, CONN_ID)).rejects.toThrow(
      ConflictException,
    );
  });

  it('assign — re-throws unexpected errors', async () => {
    mockService.findOne.mockResolvedValue(WORKSPACE);
    mocks.findFirst.mockResolvedValue({ id: CONN_ID, tenantId: ORG_ID });
    mocks.returning.mockRejectedValue(new Error('db down'));

    await expect(controller.assign(makeAuth(), WS_ID, CONN_ID)).rejects.toThrow(
      'db down',
    );
  });

  // ── unassign ──────────────────────────────────────────────────────────────

  it('unassign — removes the assignment', async () => {
    mockService.findOne.mockResolvedValue(WORKSPACE);
    mocks.where.mockResolvedValue(undefined);

    await expect(
      controller.unassign(makeAuth(), WS_ID, CONN_ID),
    ).resolves.toBeUndefined();
    expect(mocks.where).toHaveBeenCalled();
  });

  it('unassign — throws NotFoundException when workspace not found', async () => {
    mockService.findOne.mockRejectedValue(new NotFoundException());

    await expect(
      controller.unassign(makeAuth(), WS_ID, CONN_ID),
    ).rejects.toThrow(NotFoundException);
  });
});
