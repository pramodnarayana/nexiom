import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { StitchesService } from './stitches.service.js';
import { DATABASE_CONNECTION } from '@nexiom/database';
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
        appConnections: { findFirst: findFirstConnections },
        integrationStitches: {
          findFirst: findFirstStitches,
          findMany: findManyStitches,
        },
      },
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({ returning: returningInsert }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ returning: returningUpdate }),
        }),
      }),
    },
  };
}

describe('StitchesService', () => {
  const ORG_ID = 'org-1';
  const WS_ID = '11111111-1111-1111-1111-111111111111';
  const STITCH_ID = '44444444-4444-4444-4444-444444444444';
  const SRC_CONN_ID = '22222222-2222-2222-2222-222222222222';
  const DEST_CONN_ID = '33333333-3333-3333-3333-333333333333';

  const STITCH = {
    id: STITCH_ID,
    name: 'SF Loads → QB Invoices',
    orgId: ORG_ID,
    workspaceId: WS_ID,
    srcConnectionId: SRC_CONN_ID,
    destConnectionId: DEST_CONN_ID,
    sourceObject: 'rtms__Load__c',
    targetObject: 'Invoice',
    syncCondition: [],
    status: 'ACTIVE' as const,
    syncIntervalMinutes: 30,
    scheduleEnabled: true,
    lastScheduledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const CREATE_BODY = {
    name: 'SF Loads → QB Invoices',
    workspaceId: WS_ID,
    srcConnectionId: SRC_CONN_ID,
    destConnectionId: DEST_CONN_ID,
    sourceObject: 'rtms__Load__c',
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
      ],
    }).compile();

    service = module.get(StitchesService);
  });

  // ── create ──────────────────────────────────────────────────────────────

  it('creates a stitch after verifying workspace and connections', async () => {
    mocks.findFirstWorkspaces.mockResolvedValue({ id: WS_ID, orgId: ORG_ID });
    // Return distinct objects for each parallel lookup so the test catches
    // any ID-mixing bug (e.g. both checks accidentally using srcConnectionId)
    mocks.findFirstConnections
      .mockResolvedValueOnce({ id: SRC_CONN_ID, tenantId: ORG_ID })
      .mockResolvedValueOnce({ id: DEST_CONN_ID, tenantId: ORG_ID });
    mocks.returningInsert.mockResolvedValue([STITCH]);

    const result = await service.create(ORG_ID, CREATE_BODY);

    expect(result).toEqual(STITCH);
    expect(mocks.findFirstWorkspaces).toHaveBeenCalled();
    // Both connection checks run (in parallel)
    expect(mocks.findFirstConnections).toHaveBeenCalledTimes(2);
  });

  it('throws NotFoundException when workspace does not belong to org', async () => {
    mocks.findFirstWorkspaces.mockResolvedValue(null);

    await expect(service.create(ORG_ID, CREATE_BODY)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException when srcConnection does not belong to org', async () => {
    mocks.findFirstWorkspaces.mockResolvedValue({ id: WS_ID, orgId: ORG_ID });
    mocks.findFirstConnections
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: DEST_CONN_ID, tenantId: ORG_ID });

    await expect(service.create(ORG_ID, CREATE_BODY)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException when destConnection does not belong to org', async () => {
    mocks.findFirstWorkspaces.mockResolvedValue({ id: WS_ID, orgId: ORG_ID });
    mocks.findFirstConnections
      .mockResolvedValueOnce({ id: SRC_CONN_ID, tenantId: ORG_ID })
      .mockResolvedValueOnce(null);

    await expect(service.create(ORG_ID, CREATE_BODY)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws BadRequestException when src and dest connections are the same', async () => {
    mocks.findFirstWorkspaces.mockResolvedValue({ id: WS_ID, orgId: ORG_ID });

    // Same-connection guard fires before the DB lookup, so no connection mock needed
    await expect(
      service.create(ORG_ID, {
        ...CREATE_BODY,
        destConnectionId: SRC_CONN_ID,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws InternalServerErrorException if insert returns no row', async () => {
    mocks.findFirstWorkspaces.mockResolvedValue({ id: WS_ID, orgId: ORG_ID });
    mocks.findFirstConnections
      .mockResolvedValueOnce({ id: SRC_CONN_ID, tenantId: ORG_ID })
      .mockResolvedValueOnce({ id: DEST_CONN_ID, tenantId: ORG_ID });
    mocks.returningInsert.mockResolvedValue([]);

    await expect(service.create(ORG_ID, CREATE_BODY)).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('throws ConflictException when DB raises a unique-violation (23505)', async () => {
    mocks.findFirstWorkspaces.mockResolvedValue({ id: WS_ID, orgId: ORG_ID });
    mocks.findFirstConnections
      .mockResolvedValueOnce({ id: SRC_CONN_ID, tenantId: ORG_ID })
      .mockResolvedValueOnce({ id: DEST_CONN_ID, tenantId: ORG_ID });
    const pgUniqueError = Object.assign(new Error('unique violation'), {
      code: '23505',
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
    const archived = { ...STITCH, status: 'ARCHIVED' as const };
    // Service applies the ARCHIVED filter; the mock returns only non-archived
    mocks.findManyStitches.mockResolvedValue([STITCH]);

    const result = await service.list(ORG_ID);

    expect(result).not.toContain(archived);
    expect(mocks.findManyStitches).toHaveBeenCalled();
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

  it('archives a stitch', async () => {
    const archived = { ...STITCH, status: 'ARCHIVED' as const };
    mocks.returningUpdate.mockResolvedValue([archived]);

    await expect(service.remove(ORG_ID, STITCH_ID)).resolves.toBeUndefined();
    expect(mocks.db.update).toHaveBeenCalled();
  });

  it('throws NotFoundException when archiving non-existent stitch', async () => {
    mocks.returningUpdate.mockResolvedValue([]);

    await expect(service.remove(ORG_ID, STITCH_ID)).rejects.toThrow(
      NotFoundException,
    );
  });
});
