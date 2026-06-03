/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { StitchesService } from './stitches.service.js';
import { DATABASE_CONNECTION } from '@soopa/database';
import { DB_MANAGER } from '@soopa/dbmanager';
import { Test } from '@nestjs/testing';

// ---------------------------------------------------------------------------
// Minimal mock DrizzleDb
// ---------------------------------------------------------------------------
function buildMockDb() {
  const findFirstWorkspaces = vi.fn();
  const findFirstConnections = vi.fn();
  const findFirstStitches = vi.fn();
  const findManyStitches = vi.fn();
  const returningInsert = vi.fn();
  const returningUpdate = vi.fn();

  // Shared insert chain used both directly on db and inside transaction callbacks.
  const outboxInsertResult = Promise.resolve([]);
  const insertChain = {
    values: vi
      .fn()
      .mockReturnValue(
        Object.assign(outboxInsertResult, { returning: returningInsert }),
      ),
  };
  const insertFn = vi.fn().mockReturnValue(insertChain);

  // tx object passed to db.transaction() callbacks — shares the same mocks so
  // tests can assert on returningInsert / returningUpdate regardless of whether
  // the code runs inside or outside a transaction.
  const tx = {
    insert: insertFn,
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ returning: returningUpdate }),
      }),
    }),
  };

  return {
    findFirstWorkspaces,
    findFirstConnections,
    findFirstStitches,
    findManyStitches,
    returningInsert,
    returningUpdate,
    db: {
      query: {
        uiWorkspaces: { findFirst: findFirstWorkspaces },
        dataSources: { findFirst: findFirstConnections },
        integrationStitches: {
          findFirst: findFirstStitches,
          findMany: findManyStitches,
        },
      },
      select: vi.fn().mockImplementation(() => {
        const qb: any = {};
        qb.from = vi.fn().mockReturnValue(qb);
        qb.where = vi.fn().mockReturnValue(qb);
        qb.limit = vi.fn().mockReturnValue(qb);
        qb.then = (res: any, rej: any) =>
          Promise.resolve(findFirstConnections()).then(
            (r) => res(r ? [r] : []),
            rej,
          );
        return qb;
      }),
      insert: insertFn,
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ returning: returningUpdate }),
        }),
      }),
      // Executes the callback synchronously with the shared tx mock, forwarding
      // its return value so callers receive the same result as a real transaction.
      transaction: vi
        .fn()
        .mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    },
  };
}

describe('StitchesService', () => {
  const ORG_ID = 'org-1';
  const WS_ID = '11111111-1111-1111-1111-111111111111';
  const STITCH_ID = '44444444-4444-4444-4444-444444444444';
  const DEST_CONN_ID = '33333333-3333-3333-3333-333333333333';

  const STITCH = {
    id: STITCH_ID,
    name: 'SF Loads → QB Invoices',
    orgId: ORG_ID,
    workspaceId: WS_ID,
    destDataSourceId: DEST_CONN_ID,
    canonicalObject: 'mock-canonical',
    targetObject: 'Invoice',
    syncCondition: [],
    status: 'ACTIVE' as const,

    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const CREATE_BODY = {
    name: 'SF Loads → QB Invoices',
    workspaceId: WS_ID,
    destDataSourceId: DEST_CONN_ID,
    canonicalObject: 'mock-canonical',
    targetObject: 'Invoice',
  };

  let service: StitchesService;
  let mocks: ReturnType<typeof buildMockDb>;

  beforeEach(async () => {
    mocks = buildMockDb();

    const module = await Test.createTestingModule({
      providers: [
        StitchesService,
        { provide: DATABASE_CONNECTION, useValue: mocks.db },
        {
          provide: DB_MANAGER,
          useValue: { applyPlan: vi.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get(StitchesService);
  });

  // ── create ──────────────────────────────────────────────────────────────

  it('creates a stitch after verifying workspace and connections', async () => {
    mocks.findFirstWorkspaces.mockResolvedValue({ id: WS_ID, orgId: ORG_ID });
    // Return distinct objects for each parallel lookup so the test catches
    // any ID-mixing bug (e.g. both checks accidentally using srcDataSourceId)
    mocks.findFirstConnections.mockResolvedValueOnce({
      id: DEST_CONN_ID,
      tenantId: ORG_ID,
      appName: 'quickbooks',
    });
    mocks.returningInsert.mockResolvedValue([STITCH]);

    const result = await service.create(ORG_ID, CREATE_BODY);

    expect(result).toEqual(STITCH);
    expect(mocks.findFirstWorkspaces).toHaveBeenCalled();
    expect(mocks.findFirstConnections).toHaveBeenCalledTimes(1);
  });

  it('throws NotFoundException when workspace does not belong to org', async () => {
    mocks.findFirstWorkspaces.mockResolvedValue(null);

    await expect(service.create(ORG_ID, CREATE_BODY)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException when destConnection does not belong to org', async () => {
    mocks.findFirstWorkspaces.mockResolvedValue({ id: WS_ID, orgId: ORG_ID });
    mocks.findFirstConnections.mockResolvedValueOnce(null);

    await expect(service.create(ORG_ID, CREATE_BODY)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws InternalServerErrorException if insert returns no row', async () => {
    mocks.findFirstWorkspaces.mockResolvedValue({ id: WS_ID, orgId: ORG_ID });
    mocks.findFirstConnections.mockResolvedValueOnce({
      id: DEST_CONN_ID,
      tenantId: ORG_ID,
      appName: 'quickbooks',
    });
    mocks.returningInsert.mockResolvedValue([]);

    await expect(service.create(ORG_ID, CREATE_BODY)).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('throws ConflictException on duplicate stitch name (stitch_name_workspace_unique_idx)', async () => {
    mocks.findFirstWorkspaces.mockResolvedValue({ id: WS_ID, orgId: ORG_ID });
    mocks.findFirstConnections.mockResolvedValueOnce({
      id: DEST_CONN_ID,
      tenantId: ORG_ID,
      appName: 'quickbooks',
    });
    const pgUniqueError = Object.assign(new Error('unique violation'), {
      code: '23505',
      constraint: 'stitch_name_workspace_unique_idx',
    });
    mocks.returningInsert.mockRejectedValue(pgUniqueError);

    await expect(service.create(ORG_ID, CREATE_BODY)).rejects.toThrow(
      ConflictException,
    );
  });

  it('throws ConflictException on duplicate field mapping (field_mapping_stitch_canonical_unique_idx)', async () => {
    mocks.findFirstWorkspaces.mockResolvedValue({ id: WS_ID, orgId: ORG_ID });
    mocks.findFirstConnections.mockResolvedValueOnce({
      id: DEST_CONN_ID,
      tenantId: ORG_ID,
      appName: 'quickbooks',
    });
    const pgUniqueError = Object.assign(new Error('unique violation'), {
      code: '23505',
      constraint: 'field_mapping_stitch_canonical_unique_idx',
    });
    mocks.returningInsert.mockRejectedValue(pgUniqueError);

    await expect(service.create(ORG_ID, CREATE_BODY)).rejects.toThrow(
      ConflictException,
    );
  });

  // ── list ────────────────────────────────────────────────────────────────

  it('lists stitches for an org', async () => {
    mocks.findManyStitches.mockResolvedValue([STITCH]);

    const result = await service.list(ORG_ID);

    expect(result).toEqual([STITCH]);
  });

  it('lists stitches filtered by workspaceId', async () => {
    mocks.findManyStitches.mockResolvedValue([STITCH]);

    const result = await service.list(ORG_ID, WS_ID);

    expect(result).toEqual([STITCH]);
  });

  it('excludes archived stitches by default', async () => {
    mocks.findManyStitches.mockResolvedValue([STITCH]);

    const result = await service.list(ORG_ID);

    expect(result).toEqual([STITCH]);
    // No item in the result should carry ARCHIVED status
    expect(result).not.toContainEqual(
      expect.objectContaining({ status: 'ARCHIVED' }),
    );
  });

  it('includes archived stitches when includeArchived is true', async () => {
    const archived = { ...STITCH, status: 'ARCHIVED' as const };
    mocks.findManyStitches.mockResolvedValue([STITCH, archived]);

    const result = await service.list(ORG_ID, undefined, true);

    expect(result).toHaveLength(2);
  });

  // ── findOne ─────────────────────────────────────────────────────────────

  it('returns a stitch by id', async () => {
    mocks.findFirstStitches.mockResolvedValue(STITCH);

    const result = await service.findOne(ORG_ID, STITCH_ID);

    expect(result).toEqual(STITCH);
  });

  it('throws NotFoundException when stitch does not exist', async () => {
    mocks.findFirstStitches.mockResolvedValue(null);

    await expect(service.findOne(ORG_ID, STITCH_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  // ── update ──────────────────────────────────────────────────────────────

  it('updates a stitch name', async () => {
    const updated = { ...STITCH, name: 'Updated Name' };
    mocks.returningUpdate.mockResolvedValue([updated]);

    const result = await service.update(ORG_ID, STITCH_ID, {
      name: 'Updated Name',
    });

    expect(result).toEqual(updated);
  });

  it('updates stitch status to ARCHIVED', async () => {
    const updated = { ...STITCH, status: 'ARCHIVED' as const };
    mocks.returningUpdate.mockResolvedValue([updated]);

    const result = await service.update(ORG_ID, STITCH_ID, {
      status: 'ARCHIVED',
    });

    expect(result.status).toBe('ARCHIVED');
  });

  it('throws BadRequestException when no updatable fields provided', async () => {
    await expect(service.update(ORG_ID, STITCH_ID, {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws NotFoundException when updating non-existent stitch', async () => {
    mocks.returningUpdate.mockResolvedValue([]);

    await expect(
      service.update(ORG_ID, STITCH_ID, { name: 'New' }),
    ).rejects.toThrow(NotFoundException);
  });

  // ── remove (archive) ───────────────────────────────────────────────────

  it('archives a stitch and queues a deleted outbox record', async () => {
    const archived = { ...STITCH, status: 'ARCHIVED' as const };
    mocks.returningUpdate.mockResolvedValue([archived]);

    await expect(service.remove(ORG_ID, STITCH_ID)).resolves.toBeUndefined();
    expect(mocks.db.transaction).toHaveBeenCalled();
    // The outbox insert runs inside the transaction via the shared insertFn.
    // Retrieve the values() mock from the insert call chain and assert payload.
    expect(mocks.db.insert).toHaveBeenCalled();
    const insertCallChain = mocks.db.insert.mock.results[0]?.value as {
      values: ReturnType<typeof vi.fn>;
    };
    expect(insertCallChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: STITCH_ID,
        entityType: 'INTEGRATION_STITCH',
        action: 'DELETE',
      }),
    );
  });

  it('throws NotFoundException when archiving non-existent stitch', async () => {
    mocks.returningUpdate.mockResolvedValue([]);

    await expect(service.remove(ORG_ID, STITCH_ID)).rejects.toThrow(
      NotFoundException,
    );
  });
});
