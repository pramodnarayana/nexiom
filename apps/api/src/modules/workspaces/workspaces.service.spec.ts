import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service.js';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { Test } from '@nestjs/testing';

// ---------------------------------------------------------------------------
// Minimal mock DrizzleDb — only the query/insert/update/delete/select surface
// ---------------------------------------------------------------------------
function buildMockDb() {
  const findFirst = vi.fn();
  const findMany = vi.fn();
  const returningInsert = vi.fn();
  const returningUpdate = vi.fn();
  const deleteReturning = vi.fn();
  const selectOrderBy = vi.fn();

  return {
    findFirst,
    findMany,
    returningInsert,
    returningUpdate,
    deleteReturning,
    selectOrderBy,
    db: {
      query: {
        uiWorkspaces: { findFirst, findMany },
      },
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({ returning: returningInsert }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ returning: returningUpdate }),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ returning: deleteReturning }),
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: selectOrderBy,
              }),
            }),
          }),
        }),
      }),
    },
  };
}

describe('WorkspacesService', () => {
  const ORG_ID = 'org-1';
  const WS_ID = 'ws-uuid-1';
  const CONN_ID = 'conn-uuid-1';
  const WORKSPACE = {
    id: WS_ID,
    orgId: ORG_ID,
    name: 'Logistics',
    envType: 'PRODUCTION' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  let service: WorkspacesService;
  let mocks: ReturnType<typeof buildMockDb>;

  beforeEach(async () => {
    mocks = buildMockDb();

    const module = await Test.createTestingModule({
      providers: [
        WorkspacesService,
        { provide: DATABASE_CONNECTION, useValue: mocks.db },
      ],
    }).compile();

    service = module.get(WorkspacesService);
  });

  // ── create ────────────────────────────────────────────────────────────────

  it('creates a workspace', async () => {
    mocks.returningInsert.mockResolvedValue([WORKSPACE]);

    const result = await service.create(ORG_ID, { name: 'Logistics' });

    expect(result).toEqual(WORKSPACE);
    expect(mocks.db.insert).toHaveBeenCalled();
  });

  it('throws ConflictException when DB raises a unique-violation (23505)', async () => {
    const pgUniqueError = Object.assign(new Error('unique'), { code: '23505' });
    mocks.returningInsert.mockRejectedValue(pgUniqueError);

    await expect(service.create(ORG_ID, { name: 'Logistics' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('re-throws unexpected errors from insert', async () => {
    const boom = new Error('connection lost');
    mocks.returningInsert.mockRejectedValue(boom);

    await expect(service.create(ORG_ID, { name: 'Logistics' })).rejects.toThrow(
      'connection lost',
    );
  });

  it('throws InternalServerErrorException if insert returns no row', async () => {
    mocks.returningInsert.mockResolvedValue([]);

    await expect(service.create(ORG_ID, { name: 'Logistics' })).rejects.toThrow(
      'Insert did not return a row.',
    );
  });

  // ── list ──────────────────────────────────────────────────────────────────

  it('lists workspaces for an org', async () => {
    mocks.findMany.mockResolvedValue([WORKSPACE]);

    const result = await service.list(ORG_ID);

    expect(result).toEqual([WORKSPACE]);
  });

  // ── findOne ───────────────────────────────────────────────────────────────

  it('returns a workspace by id', async () => {
    mocks.findFirst.mockResolvedValue(WORKSPACE);

    const result = await service.findOne(ORG_ID, WS_ID);

    expect(result).toEqual(WORKSPACE);
  });

  it('throws NotFoundException when workspace does not exist', async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(service.findOne(ORG_ID, WS_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  // ── update ────────────────────────────────────────────────────────────────

  it('updates a workspace name', async () => {
    const updated = { ...WORKSPACE, name: 'Logistics-EU' };
    mocks.returningUpdate.mockResolvedValue([updated]);

    const result = await service.update(ORG_ID, WS_ID, {
      name: 'Logistics-EU',
    });

    expect(result).toEqual(updated);
  });

  it('throws ConflictException when update raises a unique-violation (23505)', async () => {
    const pgUniqueError = Object.assign(new Error('unique'), { code: '23505' });
    mocks.returningUpdate.mockRejectedValue(pgUniqueError);

    await expect(
      service.update(ORG_ID, WS_ID, { name: 'Logistics-EU' }),
    ).rejects.toThrow(ConflictException);
  });

  it('throws NotFoundException when updating non-existent workspace', async () => {
    mocks.returningUpdate.mockResolvedValue([]);

    await expect(
      service.update(ORG_ID, WS_ID, { name: 'New' }),
    ).rejects.toThrow(NotFoundException);
  });

  // ── remove ────────────────────────────────────────────────────────────────

  it('deletes a workspace', async () => {
    mocks.deleteReturning.mockResolvedValue([WORKSPACE]);

    await expect(service.remove(ORG_ID, WS_ID)).resolves.toBeUndefined();
    expect(mocks.db.delete).toHaveBeenCalled();
  });

  it('throws NotFoundException when deleting non-existent workspace', async () => {
    mocks.deleteReturning.mockResolvedValue([]);

    await expect(service.remove(ORG_ID, WS_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  // ── listConnections ───────────────────────────────────────────────────────

  it('returns connections assigned to the workspace', async () => {
    const assignedAt = new Date();
    // Raw row includes workspaceId (selected for the exists-check); service strips it
    const rawRow = {
      workspaceId: WS_ID,
      id: CONN_ID,
      appName: 'salesforce',
      externalId: 'sf-slug',
      displayName: 'Salesforce Master',
      authType: 'OAUTH2',
      status: 'ACTIVE',
      assignedAt,
    };
    mocks.selectOrderBy.mockResolvedValue([rawRow]);

    const result = await service.listConnections(ORG_ID, WS_ID);

    // workspaceId is stripped from returned objects
    const { workspaceId: _ws, ...expectedRow } = rawRow;
    expect(result).toEqual([expectedRow]);
    expect(mocks.db.select).toHaveBeenCalled();
  });

  it('throws NotFoundException when listing connections for a non-existent workspace', async () => {
    mocks.selectOrderBy.mockResolvedValue([]);

    await expect(service.listConnections(ORG_ID, WS_ID)).rejects.toThrow(
      NotFoundException,
    );
  });
});
