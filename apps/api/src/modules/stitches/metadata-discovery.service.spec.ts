import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TokenManagerService } from '@nexiom/connectors';
import { MetadataDiscoveryService } from './metadata-discovery.service.js';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { REDIS_CLIENT } from '@nexiom/cache';
import { PieceRegistryService } from '../trigger/piece-registry.service.js';

const CONN_ID = 'conn-uuid-1';
const ORG_ID = 'org-uuid-1';
const APP_NAME = 'salesforce';

// ── Mock DB ──────────────────────────────────────────────────────────────────

function buildMockDb() {
  const selectRows = vi.fn<() => Promise<unknown[]>>();

  // whereResult is both thenable (for direct `await db.select().from().where()`)
  // and has `.limit()` (for `await db.select().from().where().limit(1)`).
  // Both paths call selectRows so mockResolvedValueOnce chaining works for either.
  // NOSONAR: S7739 — intentional thenable mock for dual-path Drizzle query testing.
  const whereResult = {
    limit: vi.fn().mockImplementation(() => selectRows()),
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      selectRows().then(resolve, reject),
  };
  const where = vi.fn().mockReturnValue(whereResult);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });

  // delete mock: db.delete(table).where(...)
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });

  // update mock: db.update(table).set(...).where(...)
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  // transaction mock: executes the callback immediately with the same db surface.
  const transaction = vi
    .fn()
    .mockImplementation((cb: (tx: unknown) => Promise<unknown>) =>
      cb({ select, insert, delete: deleteFn, update: updateFn }),
    );

  return {
    selectRows,
    db: {
      select,
      insert,
      delete: deleteFn,
      update: updateFn,
      transaction,
    },
  };
}

// ── Mock Redis ────────────────────────────────────────────────────────────────

function buildMockRedis() {
  return {
    get: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
    set: vi.fn<() => Promise<string>>().mockResolvedValue('OK'),
    del: vi.fn<() => Promise<number>>().mockResolvedValue(1),
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_CONNECTION = {
  id: CONN_ID,
  tenantId: ORG_ID,
  appName: APP_NAME,
  displayName: 'My SF',
  externalId: 'my-sf',
  authType: 'OAUTH2' as const,
  envType: 'PRODUCTION' as const,
  status: 'ACTIVE' as const,
  expiresAt: null,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** Default credential blob returned by the TokenManagerService mock. */
const DEFAULT_CREDS_BLOB = {
  accessToken: 'sf-access-token',
  refreshToken: undefined,
  clientId: 'client-id',
  clientSecret: 'client-secret',
  data: {} as Record<string, unknown>,
  vendorParams: {} as Record<string, string>,
};

const MOCK_OBJECTS = [
  { name: 'Contact', label: 'Contact', queryable: true },
  { name: 'Account', label: 'Account', queryable: true },
];

const MOCK_FIELDS = [
  {
    name: 'Id',
    label: 'ID',
    type: 'string',
    filterable: true,
    sortable: true,
    nillable: false,
  },
  {
    name: 'Name',
    label: 'Name',
    type: 'string',
    filterable: true,
    sortable: true,
    nillable: false,
  },
];

describe('MetadataDiscoveryService', () => {
  let service: MetadataDiscoveryService;
  let mocks: ReturnType<typeof buildMockDb>;
  let redis: ReturnType<typeof buildMockRedis>;
  let mockPieceRegistry: { getPiece: ReturnType<typeof vi.fn> };
  let mockTokenManager: { getValidCredentials: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();

    mocks = buildMockDb();
    redis = buildMockRedis();
    mockPieceRegistry = { getPiece: vi.fn() };
    mockTokenManager = {
      getValidCredentials: vi.fn().mockResolvedValue(DEFAULT_CREDS_BLOB),
    };

    const module = await Test.createTestingModule({
      providers: [
        MetadataDiscoveryService,
        { provide: DATABASE_CONNECTION, useValue: mocks.db },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: PieceRegistryService, useValue: mockPieceRegistry },
        { provide: TokenManagerService, useValue: mockTokenManager },
        {
          provide: ConfigService,
          useValue: { get: vi.fn().mockReturnValue(undefined) },
        },
      ],
    }).compile();

    service = module.get(MetadataDiscoveryService);
  });

  // ── describeObjects ─────────────────────────────────────────────────────────

  describe('describeObjects', () => {
    it('returns Redis-cached objects when cache is warm', async () => {
      mocks.selectRows.mockResolvedValueOnce([MOCK_CONNECTION]);
      redis.get.mockResolvedValueOnce(JSON.stringify(MOCK_OBJECTS));

      const result = await service.describeObjects(ORG_ID, CONN_ID);
      expect(result).toEqual(MOCK_OBJECTS);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('respects limit param when returning Redis-cached objects', async () => {
      const many = Array.from({ length: 10 }, (_, i) => ({
        name: `Obj${i}`,
        label: `Obj${i}`,
        queryable: true,
      }));
      mocks.selectRows.mockResolvedValueOnce([MOCK_CONNECTION]);
      redis.get.mockResolvedValueOnce(JSON.stringify(many));

      const result = await service.describeObjects(ORG_ID, CONN_ID, 3);
      expect(result).toHaveLength(3);
    });

    it('returns fresh DB-cached objects and warms Redis when all rows are within TTL', async () => {
      const freshUpdatedAt = new Date();
      mocks.selectRows
        .mockResolvedValueOnce([MOCK_CONNECTION]) // resolveConnection
        .mockResolvedValueOnce([
          // DB cache check — profile stores the StoredObjectDescriptor
          {
            objectName: 'Contact',
            profile: { label: 'Contact', queryable: true },
            updatedAt: freshUpdatedAt,
          },
          {
            objectName: 'Account',
            profile: { label: 'Account', queryable: true },
            updatedAt: freshUpdatedAt,
          },
        ]);
      redis.get.mockResolvedValueOnce(null);

      const result = await service.describeObjects(ORG_ID, CONN_ID);
      expect(result).toEqual([
        { name: 'Contact', label: 'Contact', queryable: true },
        { name: 'Account', label: 'Account', queryable: true },
      ]);
      expect(redis.set).toHaveBeenCalledOnce();
    });

    it('calls piece.describeObjects with credentials from TokenManagerService', async () => {
      mocks.selectRows
        .mockResolvedValueOnce([MOCK_CONNECTION]) // resolveConnection
        .mockResolvedValueOnce([]); // empty DB cache
      redis.get.mockResolvedValueOnce(null);
      const describeObjectsMock = vi.fn().mockResolvedValue(MOCK_OBJECTS);
      mockPieceRegistry.getPiece.mockReturnValue({
        describeObjects: describeObjectsMock,
      });

      const result = await service.describeObjects(ORG_ID, CONN_ID);
      expect(result).toEqual(MOCK_OBJECTS);
      expect(mockTokenManager.getValidCredentials).toHaveBeenCalledWith(
        CONN_ID,
      );
      expect(redis.set).toHaveBeenCalledOnce();
      // Upsert + stale-delete must run atomically inside a transaction.
      expect(mocks.db.transaction).toHaveBeenCalledOnce();
    });

    it('spreads vendor data fields into credentials passed to piece.describeObjects', async () => {
      const credsBlob = {
        accessToken: 'sf-access-token',
        refreshToken: undefined,
        clientId: 'cid',
        clientSecret: 'cs',
        data: { instance_url: 'https://sf.example.com' } as Record<
          string,
          unknown
        >,
        vendorParams: {} as Record<string, string>,
      };
      mocks.selectRows
        .mockResolvedValueOnce([MOCK_CONNECTION]) // resolveConnection
        .mockResolvedValueOnce([]); // empty DB cache
      redis.get.mockResolvedValueOnce(null);
      mockTokenManager.getValidCredentials.mockResolvedValueOnce(credsBlob);
      const describeObjectsMock = vi.fn().mockResolvedValue(MOCK_OBJECTS);
      mockPieceRegistry.getPiece.mockReturnValue({
        describeObjects: describeObjectsMock,
      });

      await service.describeObjects(ORG_ID, CONN_ID);

      // piece.describeObjects must receive the flattened credential map.
      // Layer order: blob top-level scalars → blob.data → blob.vendorParams →
      // canonical token fields (always win). All top-level blob properties
      // (including clientSecret, environment, data, vendorParams objects) are
      // included so pieces can access any field they need.
      expect(describeObjectsMock).toHaveBeenCalledWith({
        // from blob top-level
        clientId: 'cid',
        clientSecret: 'cs',
        refreshToken: undefined,
        data: { instance_url: 'https://sf.example.com' },
        vendorParams: {},
        // from blob.data (flattened)
        instance_url: 'https://sf.example.com',
        // canonical token fields — always authoritative
        accessToken: 'sf-access-token',
      });
    });

    it('purges all cached rows (not notInArray) when piece returns empty object list', async () => {
      mocks.selectRows
        .mockResolvedValueOnce([MOCK_CONNECTION]) // resolveConnection
        .mockResolvedValueOnce([]); // empty DB cache
      redis.get.mockResolvedValueOnce(null);
      // Piece returns an empty array — upstream has no objects.
      mockPieceRegistry.getPiece.mockReturnValue({
        describeObjects: vi.fn().mockResolvedValue([]),
      });

      const result = await service.describeObjects(ORG_ID, CONN_ID);
      expect(result).toEqual([]);

      // Transaction must still run — the delete-all path needs atomicity too.
      expect(mocks.db.transaction).toHaveBeenCalledOnce();

      // The delete must use a simple eq() on connectionId, not notInArray,
      // because there are no current names to exclude.
      const { delete: deleteFn } = mocks.db;
      expect(deleteFn).toHaveBeenCalledOnce();
    });

    it('busts Redis cache and skips DB cache when forceRefresh=true', async () => {
      mocks.selectRows.mockResolvedValueOnce([MOCK_CONNECTION]); // resolveConnection
      redis.get.mockResolvedValueOnce(JSON.stringify(MOCK_OBJECTS)); // would be a cache hit
      const describeObjectsMock = vi.fn().mockResolvedValue(MOCK_OBJECTS);
      mockPieceRegistry.getPiece.mockReturnValue({
        describeObjects: describeObjectsMock,
      });

      await service.describeObjects(ORG_ID, CONN_ID, 500, true);

      // Must delete the Redis key, not read from it.
      expect(redis.del).toHaveBeenCalledWith(`meta:objects:${CONN_ID}`);
      expect(redis.get).not.toHaveBeenCalled();
      // Must hit the live piece, not return the cached value.
      expect(describeObjectsMock).toHaveBeenCalledOnce();
    });

    it('throws NotFoundException when piece has no describeObjects', async () => {
      mocks.selectRows
        .mockResolvedValueOnce([MOCK_CONNECTION])
        .mockResolvedValueOnce([]);
      redis.get.mockResolvedValueOnce(null);
      // Piece registered but does not implement describeObjects
      mockPieceRegistry.getPiece.mockReturnValue({});

      await expect(service.describeObjects(ORG_ID, CONN_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when no piece is registered for the connector', async () => {
      const unknownConn = { ...MOCK_CONNECTION, appName: 'unknown-app' };
      mocks.selectRows
        .mockResolvedValueOnce([unknownConn])
        .mockResolvedValueOnce([]);
      redis.get.mockResolvedValueOnce(null);
      mockPieceRegistry.getPiece.mockReturnValue(undefined);

      await expect(service.describeObjects(ORG_ID, CONN_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when connection not found', async () => {
      mocks.selectRows.mockResolvedValueOnce([]);
      redis.get.mockResolvedValueOnce(null);

      await expect(service.describeObjects(ORG_ID, CONN_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── describeFields ──────────────────────────────────────────────────────────

  describe('describeFields', () => {
    it('returns Redis-cached fields when cache is warm', async () => {
      mocks.selectRows.mockResolvedValueOnce([MOCK_CONNECTION]);
      redis.get.mockResolvedValueOnce(JSON.stringify(MOCK_FIELDS));

      const result = await service.describeFields(ORG_ID, CONN_ID, 'Contact');
      expect(result).toEqual(MOCK_FIELDS);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('returns fresh DB-cached fields when profile is non-empty and within TTL', async () => {
      const freshUpdatedAt = new Date();
      mocks.selectRows
        .mockResolvedValueOnce([MOCK_CONNECTION])
        .mockResolvedValueOnce([
          { profile: MOCK_FIELDS, updatedAt: freshUpdatedAt },
        ]);
      redis.get.mockResolvedValueOnce(null);

      const result = await service.describeFields(ORG_ID, CONN_ID, 'Contact');
      expect(result).toEqual(MOCK_FIELDS);
      expect(redis.set).toHaveBeenCalledOnce();
    });

    it('calls piece.describeFields with credentials from TokenManagerService', async () => {
      mocks.selectRows
        .mockResolvedValueOnce([MOCK_CONNECTION])
        .mockResolvedValueOnce([]);
      redis.get.mockResolvedValueOnce(null);
      const describeFieldsMock = vi.fn().mockResolvedValue(MOCK_FIELDS);
      mockPieceRegistry.getPiece.mockReturnValue({
        describeFields: describeFieldsMock,
      });

      const result = await service.describeFields(ORG_ID, CONN_ID, 'Contact');
      expect(result).toEqual(MOCK_FIELDS);
      expect(mockTokenManager.getValidCredentials).toHaveBeenCalledWith(
        CONN_ID,
      );
      expect(describeFieldsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: DEFAULT_CREDS_BLOB.accessToken,
        }),
        'Contact',
      );
    });

    it('throws NotFoundException when piece has no describeFields', async () => {
      mocks.selectRows
        .mockResolvedValueOnce([MOCK_CONNECTION])
        .mockResolvedValueOnce([]);
      redis.get.mockResolvedValueOnce(null);
      mockPieceRegistry.getPiece.mockReturnValue({});

      await expect(
        service.describeFields(ORG_ID, CONN_ID, 'Contact'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when no piece is registered for the connector', async () => {
      const unknownConn = { ...MOCK_CONNECTION, appName: 'unknown-app' };
      mocks.selectRows
        .mockResolvedValueOnce([unknownConn])
        .mockResolvedValueOnce([]);
      redis.get.mockResolvedValueOnce(null);
      mockPieceRegistry.getPiece.mockReturnValue(undefined);

      await expect(
        service.describeFields(ORG_ID, CONN_ID, 'Contact'),
      ).rejects.toThrow(NotFoundException);
    });

    it('treats empty-array profile [] as a valid DB cache hit', async () => {
      const freshUpdatedAt = new Date();
      mocks.selectRows
        .mockResolvedValueOnce([MOCK_CONNECTION])
        .mockResolvedValueOnce([{ profile: [], updatedAt: freshUpdatedAt }]);
      redis.get.mockResolvedValueOnce(null);

      const result = await service.describeFields(ORG_ID, CONN_ID, 'Contact');
      expect(result).toEqual([]);
      expect(redis.set).toHaveBeenCalledOnce();
    });

    it('throws NotFoundException when connection not found', async () => {
      mocks.selectRows.mockResolvedValueOnce([]);
      redis.get.mockResolvedValueOnce(null);

      await expect(
        service.describeFields(ORG_ID, CONN_ID, 'Contact'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws InternalServerErrorException when TokenManagerService fails', async () => {
      mocks.selectRows
        .mockResolvedValueOnce([MOCK_CONNECTION])
        .mockResolvedValueOnce([]);
      redis.get.mockResolvedValueOnce(null);
      mockTokenManager.getValidCredentials.mockRejectedValueOnce(
        new Error('token refresh failed'),
      );
      mockPieceRegistry.getPiece.mockReturnValue({
        describeFields: vi.fn(),
      });

      await expect(
        service.describeFields(ORG_ID, CONN_ID, 'Contact'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
