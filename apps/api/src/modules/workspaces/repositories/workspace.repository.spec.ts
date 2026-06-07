import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspaceRepository } from './workspace.repository.js';
import { DATABASE_CONNECTION, SAVEPOINT_MANAGER } from '@soopa/database';
import { Test } from '@nestjs/testing';

const ORG_ID = 'org-111';
const WS_ID = 'ws-222';

describe('WorkspaceRepository', () => {
  let repo: WorkspaceRepository;

  // Build a chainable mock DB that works for basic select/update/delete/insert chains
  function makeMockDb() {
    const returning = vi.fn();
    const orderBy = vi.fn().mockResolvedValue([]);
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ orderBy, limit, returning });
    const set = vi.fn().mockReturnValue({ where });
    const values = vi.fn().mockReturnValue({ returning });
    const from = vi.fn().mockReturnValue({ where, orderBy });
    const select = vi.fn().mockReturnValue({ from });
    const update = vi.fn().mockReturnValue({ set });
    const del = vi.fn().mockReturnValue({ where });
    const insert = vi.fn().mockReturnValue({ values });

    return {
      returning,
      orderBy,
      limit,
      where,
      set,
      from,
      select,
      update,
      delete: del,
      insert,
    };
  }

  let db: ReturnType<typeof makeMockDb>;

  beforeEach(async () => {
    db = makeMockDb();

    const module = await Test.createTestingModule({
      providers: [
        WorkspaceRepository,
        { provide: DATABASE_CONNECTION, useValue: db },
        {
          provide: SAVEPOINT_MANAGER,
          useValue: { savepoint: vi.fn(), release: vi.fn(), rollback: vi.fn() },
        },
      ],
    }).compile();

    repo = module.get(WorkspaceRepository);
  });

  describe('findByOrg', () => {
    it('returns workspaces for the org', async () => {
      const expected = [{ id: WS_ID, orgId: ORG_ID, name: 'Test' }];
      db.orderBy.mockResolvedValue(expected);

      const result = await repo.findByOrg(ORG_ID);

      expect(db.select).toHaveBeenCalled();
      expect(result).toEqual(expected);
    });

    it('returns empty array when no workspaces found', async () => {
      db.orderBy.mockResolvedValue([]);
      expect(await repo.findByOrg(ORG_ID)).toEqual([]);
    });
  });

  describe('findByIdAndOrg', () => {
    it('returns workspace when found', async () => {
      const ws = { id: WS_ID, orgId: ORG_ID, name: 'Test' };
      db.limit.mockResolvedValue([ws]);

      expect(await repo.findByIdAndOrg(WS_ID, ORG_ID)).toBe(ws);
    });

    it('returns null when workspace not found', async () => {
      db.limit.mockResolvedValue([]);
      expect(await repo.findByIdAndOrg('missing', ORG_ID)).toBeNull();
    });
  });

  describe('updateWorkspace', () => {
    it('updates and returns the workspace', async () => {
      const updated = { id: WS_ID, orgId: ORG_ID, name: 'New Name' };
      db.returning.mockResolvedValue([updated]);

      expect(
        await repo.updateWorkspace(WS_ID, ORG_ID, { name: 'New Name' }),
      ).toBe(updated);
      expect(db.update).toHaveBeenCalled();
    });

    it('returns null when workspace not found', async () => {
      db.returning.mockResolvedValue([]);
      expect(
        await repo.updateWorkspace('missing', ORG_ID, { name: 'X' }),
      ).toBeNull();
    });
  });

  describe('deleteWorkspace', () => {
    it('deletes and returns the workspace', async () => {
      const ws = { id: WS_ID, orgId: ORG_ID, name: 'Test' };
      db.returning.mockResolvedValue([ws]);

      expect(await repo.deleteWorkspace(WS_ID, ORG_ID)).toBe(ws);
      expect(db.delete).toHaveBeenCalled();
    });

    it('returns null when workspace not found', async () => {
      db.returning.mockResolvedValue([]);
      expect(await repo.deleteWorkspace('missing', ORG_ID)).toBeNull();
    });
  });

  describe('listAvailableConnections', () => {
    it('returns available connections (with assigned IDs excluded)', async () => {
      const assigned = [{ dataSourceId: 'conn-assigned' }];
      const available = [{ id: 'conn-free', appName: 'salesforce' }];

      const mockExec = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        // First .where() call resolves to the assigned list (awaited directly)
        where: vi
          .fn()
          .mockResolvedValueOnce(assigned) // first query: SELECT from uiWorkspaceDataSources
          .mockReturnValueOnce({
            orderBy: vi.fn().mockResolvedValue(available),
          }), // second: returns chain
        innerJoin: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(available),
      };

      vi.spyOn(repo as any, 'getExecutor').mockReturnValue(mockExec);

      const result = await repo.listAvailableConnections(
        ORG_ID,
        'PRODUCTION',
        'ws-id',
      );
      expect(result).toEqual(available);
    });

    it('returns available connections when no connections are assigned', async () => {
      const available = [{ id: 'conn-free', appName: 'hubspot' }];

      const mockExec = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi
          .fn()
          .mockResolvedValueOnce([]) // no assigned connections
          .mockReturnValueOnce({
            orderBy: vi.fn().mockResolvedValue(available),
          }),
        innerJoin: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(available),
      };

      vi.spyOn(repo as any, 'getExecutor').mockReturnValue(mockExec);

      const result = await repo.listAvailableConnections(
        ORG_ID,
        'PRODUCTION',
        'ws-id',
      );
      expect(result).toEqual(available);
    });
  });

  describe('listConnections', () => {
    it('queries connections for org with envType filter', async () => {
      const connections = [{ id: 'conn-1', appName: 'salesforce' }];
      const mockExec = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(connections),
      };
      vi.spyOn(repo as any, 'getExecutor').mockReturnValue(mockExec);

      const result = await repo.listConnections(ORG_ID, 'PRODUCTION', 'ws-id');

      expect(mockExec.leftJoin).toHaveBeenCalled();
      expect(mockExec.innerJoin).toHaveBeenCalled();
      expect(result).toEqual(connections);
    });
  });

  describe('createWorkspace', () => {
    it('inserts and returns the new workspace', async () => {
      const ws = {
        id: WS_ID,
        orgId: ORG_ID,
        name: 'New WS',
        envType: 'PRODUCTION',
      };
      db.returning.mockResolvedValue([ws]);

      const result = await repo.createWorkspace(ORG_ID, { name: 'New WS' });

      expect(db.insert).toHaveBeenCalled();
      expect(result).toBe(ws);
    });

    it('returns null when insert returns no row', async () => {
      db.returning.mockResolvedValue([]);
      const result = await repo.createWorkspace(ORG_ID, { name: 'Bad' });
      expect(result).toBeNull();
    });
  });

  describe('findConnectionForAssignment', () => {
    it('returns connection when found', async () => {
      const conn = { id: 'conn-1', envType: 'PRODUCTION' };
      db.limit.mockResolvedValue([conn]);

      const result = await repo.findConnectionForAssignment('conn-1', ORG_ID);
      expect(result).toBe(conn);
    });

    it('returns null when connection not found', async () => {
      db.limit.mockResolvedValue([]);
      expect(
        await repo.findConnectionForAssignment('missing', ORG_ID),
      ).toBeNull();
    });
  });

  describe('findConnectionForSync', () => {
    it('returns connection when found in correct env', async () => {
      const conn = { id: 'conn-1' };
      db.limit.mockResolvedValue([conn]);

      const result = await repo.findConnectionForSync(
        'conn-1',
        ORG_ID,
        'PRODUCTION',
      );
      expect(result).toBe(conn);
    });

    it('returns null when connection not found or wrong env', async () => {
      db.limit.mockResolvedValue([]);
      expect(
        await repo.findConnectionForSync('conn-1', ORG_ID, 'SANDBOX'),
      ).toBeNull();
    });
  });

  describe('assignConnection', () => {
    it('inserts assignment and returns the row', async () => {
      const assignment = { workspaceId: WS_ID, dataSourceId: 'conn-1' };
      db.returning.mockResolvedValue([assignment]);

      const result = await repo.assignConnection(WS_ID, 'conn-1');
      expect(db.insert).toHaveBeenCalled();
      expect(result).toBe(assignment);
    });

    it('returns null on unique violation (23505)', async () => {
      db.returning.mockRejectedValue(
        Object.assign(new Error('duplicate'), { code: '23505' }),
      );
      const result = await repo.assignConnection(WS_ID, 'conn-1');
      expect(result).toBeNull();
    });

    it('re-throws non-unique errors', async () => {
      db.returning.mockRejectedValue(new Error('db down'));
      await expect(repo.assignConnection(WS_ID, 'conn-1')).rejects.toThrow(
        'db down',
      );
    });
  });

  describe('unassignConnection', () => {
    it('deletes the assignment', async () => {
      db.where.mockResolvedValue(undefined);

      await repo.unassignConnection(WS_ID, 'conn-1');

      expect(db.delete).toHaveBeenCalled();
    });
  });
});
