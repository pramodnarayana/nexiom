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
  const deleteWhere = vi.fn();
  const selectOrderBy = vi.fn();

  return {
    findFirst,
    findMany,
    returningInsert,
    returningUpdate,
    deleteWhere,
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
        where: deleteWhere,
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: selectOrderBy,
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
    mocks.findFirst.mockResolvedValue(WORKSPACE);
    mocks.returningUpdate.mockResolvedValue([updated]);

    const result = await service.update(ORG_ID, WS_ID, {
      name: 'Logistics-EU',
    });

    expect(result).toEqual(updated);
  });

  it('throws ConflictException when update raises a unique-violation (23505)', async () => {
    mocks.findFirst.mockResolvedValue(WORKSPACE);
    const pgUniqueError = Object.assign(new Error('unique'), { code: '23505' });
    mocks.returningUpdate.mockRejectedValue(pgUniqueError);

    await expect(
      service.update(ORG_ID, WS_ID, { name: 'Logistics-EU' }),
    ).rejects.toThrow(ConflictException);
  });

  it('throws NotFoundException when updating non-existent workspace', async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(
      service.update(ORG_ID, WS_ID, { name: 'New' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws InternalServerErrorException if update returns no row', async () => {
    mocks.findFirst.mockResolvedValue(WORKSPACE);
    mocks.returningUpdate.mockResolvedValue([]);

    await expect(
      service.update(ORG_ID, WS_ID, { name: 'New' }),
    ).rejects.toThrow('Update did not return a row.');
  });

  // ── remove ────────────────────────────────────────────────────────────────

  it('deletes a workspace', async () => {
    mocks.findFirst.mockResolvedValue(WORKSPACE);
    mocks.deleteWhere.mockResolvedValue(undefined);

    await expect(service.remove(ORG_ID, WS_ID)).resolves.toBeUndefined();
    expect(mocks.db.delete).toHaveBeenCalled();
  });

  it('throws NotFoundException when deleting non-existent workspace', async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(service.remove(ORG_ID, WS_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  // ── listConnections ───────────────────────────────────────────────────────

  it('returns connections assigned to the workspace', async () => {
    const row = {
      id: CONN_ID,
      appName: 'salesforce',
      externalId: 'sf-slug',
      displayName: 'Salesforce Master',
      authType: 'OAUTH2',
      status: 'ACTIVE',
      assignedAt: new Date(),
    };
    mocks.findFirst.mockResolvedValue(WORKSPACE);
    mocks.selectOrderBy.mockResolvedValue([row]);

    const result = await service.listConnections(ORG_ID, WS_ID);

    expect(result).toEqual([row]);
    expect(mocks.db.select).toHaveBeenCalled();
  });

  it('throws NotFoundException when listing connections for a non-existent workspace', async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(service.listConnections(ORG_ID, WS_ID)).rejects.toThrow(
      NotFoundException,
    );
  });
});
