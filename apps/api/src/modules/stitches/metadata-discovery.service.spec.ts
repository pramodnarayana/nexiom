import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GatewayTimeoutException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '@nexiom/connectors';
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

  // transaction mock: executes the callback immediately with the same db surface.
  const transaction = vi
    .fn()
    .mockImplementation((cb: (tx: unknown) => Promise<unknown>) =>
      cb({ select, insert, delete: deleteFn }),
    );

  return {
    selectRows,
    db: {
      select,
      insert,
      delete: deleteFn,
      transaction,
    },
  };
}

// ── Mock Redis ────────────────────────────────────────────────────────────────

function buildMockRedis() {
  return {
    get: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
    set: vi.fn<() => Promise<string>>().mockResolvedValue('OK'),
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

// Row returned by resolveCredentials (value column present but null → returns {})
const NULL_CREDS_ROW = { value: null };

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
  let mockEncryption: { decrypt: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();

    mocks = buildMockDb();
    redis = buildMockRedis();
    mockPieceRegistry = { getPiece: vi.fn() };
    mockEncryption = { decrypt: vi.fn() };

    const module = await Test.createTestingModule({
      providers: [
        MetadataDiscoveryService,
        { provide: DATABASE_CONNECTION, useValue: mocks.db },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: PieceRegistryService, useValue: mockPieceRegistry },
        { provide: EncryptionService, useValue: mockEncryption },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((_key: string, defaultVal: string) => defaultVal),
          },
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

    it('calls piece.describeObjects with decrypted credentials when piece implements it', async () => {
      mocks.selectRows
        .mockResolvedValueOnce([MOCK_CONNECTION]) // resolveConnection
        .mockResolvedValueOnce([]) // empty DB cache
        .mockResolvedValueOnce([NULL_CREDS_ROW]); // resolveCredentials
      redis.get.mockResolvedValueOnce(null);
      const describeObjectsMock = vi.fn().mockResolvedValue(MOCK_OBJECTS);
      mockPieceRegistry.getPiece.mockReturnValue({
        describeObjects: describeObjectsMock,
      });

      const result = await service.describeObjects(ORG_ID, CONN_ID);
      expect(result).toEqual(MOCK_OBJECTS);
      expect(describeObjectsMock).toHaveBeenCalledWith({});
      expect(redis.set).toHaveBeenCalledOnce();
      // Upsert + stale-delete must run atomically inside a transaction.
      expect(mocks.db.transaction).toHaveBeenCalledOnce();
    });

    it('decrypts credentials and passes them to piece.describeObjects', async () => {
      const encryptedValue = 'encrypted-blob-xyz';
      const decryptedCredentials = {
        accessToken: 'sf-access-token',
        refreshToken: null,
        clientId: null,
        data: { instanceUrl: 'https://sf.example.com' },
      };
      mocks.selectRows
        .mockResolvedValueOnce([MOCK_CONNECTION]) // resolveConnection
        .mockResolvedValueOnce([]) // empty DB cache
        .mockResolvedValueOnce([{ value: encryptedValue }]); // resolveCredentials
      redis.get.mockResolvedValueOnce(null);
      mockEncryption.decrypt.mockResolvedValue(
        JSON.stringify(decryptedCredentials),
      );
      const describeObjectsMock = vi.fn().mockResolvedValue(MOCK_OBJECTS);
      mockPieceRegistry.getPiece.mockReturnValue({
        describeObjects: describeObjectsMock,
      });

      await service.describeObjects(ORG_ID, CONN_ID);

      // Decryption must be called with the raw encrypted string from the DB.
      expect(mockEncryption.decrypt).toHaveBeenCalledWith(encryptedValue);

      // piece.describeObjects must receive the flattened credential map —
      // nested data fields (e.g. instanceUrl) are spread to the top level,
      // and all top-level credential fields (including null ones) are present.
      expect(describeObjectsMock).toHaveBeenCalledWith({
        accessToken: 'sf-access-token',
        refreshToken: null,
        clientId: null,
        instanceUrl: 'https://sf.example.com',
      });
    });

    it('purges all cached rows (not notInArray) when piece returns empty object list', async () => {
      mocks.selectRows
        .mockResolvedValueOnce([MOCK_CONNECTION]) // resolveConnection
        .mockResolvedValueOnce([]) // empty DB cache
        .mockResolvedValueOnce([NULL_CREDS_ROW]); // resolveCredentials
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

    it('calls Prism for salesforce when piece has no describeObjects', async () => {
      mocks.selectRows
        .mockResolvedValueOnce([MOCK_CONNECTION])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([NULL_CREDS_ROW]);
      redis.get.mockResolvedValueOnce(null);
      mockPieceRegistry.getPiece.mockReturnValue({});

      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sobjects: MOCK_OBJECTS }),
      } as Response);

      const result = await service.describeObjects(ORG_ID, CONN_ID);
      expect(result).toEqual(MOCK_OBJECTS);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/services/data/v59.0/sobjects'),
        expect.any(Object),
      );

      fetchMock.mockRestore();
    });

    it('returns hardcoded stub for quickbooks', async () => {
      const qbConn = { ...MOCK_CONNECTION, appName: 'quickbooks' };
      mocks.selectRows
        .mockResolvedValueOnce([qbConn])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([NULL_CREDS_ROW]);
      redis.get.mockResolvedValueOnce(null);
      mockPieceRegistry.getPiece.mockReturnValue({});

      const result = await service.describeObjects(ORG_ID, CONN_ID);
      expect(result.map((o) => o.name)).toEqual([
        'Customer',
        'Invoice',
        'Item',
        'Payment',
        'Vendor',
      ]);
    });

    it('throws NotFoundException for unsupported connector', async () => {
      const unknownConn = { ...MOCK_CONNECTION, appName: 'unknown-app' };
      mocks.selectRows
        .mockResolvedValueOnce([unknownConn])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([NULL_CREDS_ROW]);
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

    it('throws InternalServerErrorException when Salesforce returns a non-ok status', async () => {
      mocks.selectRows
        .mockResolvedValueOnce([MOCK_CONNECTION])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([NULL_CREDS_ROW]);
      redis.get.mockResolvedValueOnce(null);
      mockPieceRegistry.getPiece.mockReturnValue({});

      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as Response);

      await expect(service.describeObjects(ORG_ID, CONN_ID)).rejects.toThrow(
        InternalServerErrorException,
      );

      fetchMock.mockRestore();
    });

    it('throws GatewayTimeoutException when Salesforce fetch times out', async () => {
      mocks.selectRows
        .mockResolvedValueOnce([MOCK_CONNECTION])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([NULL_CREDS_ROW]);
      redis.get.mockResolvedValueOnce(null);
      mockPieceRegistry.getPiece.mockReturnValue({});

      const abortError = Object.assign(new Error('The operation was aborted'), {
        name: 'AbortError',
      });
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValueOnce(abortError);

      await expect(service.describeObjects(ORG_ID, CONN_ID)).rejects.toThrow(
        GatewayTimeoutException,
      );

      fetchMock.mockRestore();
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

    it('calls piece.describeFields with decrypted credentials when piece implements it', async () => {
      mocks.selectRows
        .mockResolvedValueOnce([MOCK_CONNECTION])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([NULL_CREDS_ROW]);
      redis.get.mockResolvedValueOnce(null);
      const describeFieldsMock = vi.fn().mockResolvedValue(MOCK_FIELDS);
      mockPieceRegistry.getPiece.mockReturnValue({
        describeFields: describeFieldsMock,
      });

      const result = await service.describeFields(ORG_ID, CONN_ID, 'Contact');
      expect(result).toEqual(MOCK_FIELDS);
      expect(describeFieldsMock).toHaveBeenCalledWith({}, 'Contact');
    });

    it('calls Prism for salesforce when piece has no describeFields', async () => {
      mocks.selectRows
        .mockResolvedValueOnce([MOCK_CONNECTION])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([NULL_CREDS_ROW]);
      redis.get.mockResolvedValueOnce(null);
      mockPieceRegistry.getPiece.mockReturnValue({});

      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ fields: MOCK_FIELDS }),
      } as Response);

      const result = await service.describeFields(ORG_ID, CONN_ID, 'Contact');
      expect(result).toEqual(MOCK_FIELDS);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/sobjects/Contact/describe'),
        expect.any(Object),
      );

      fetchMock.mockRestore();
    });

    it('returns quickbooks Invoice stub fields', async () => {
      const qbConn = { ...MOCK_CONNECTION, appName: 'quickbooks' };
      mocks.selectRows
        .mockResolvedValueOnce([qbConn])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([NULL_CREDS_ROW]);
      redis.get.mockResolvedValueOnce(null);
      mockPieceRegistry.getPiece.mockReturnValue({});

      const result = await service.describeFields(ORG_ID, CONN_ID, 'Invoice');
      const names = result.map((f) => f.name);
      expect(names).toContain('TotalAmt');
      expect(names).toContain('DocNumber');
    });

    it('throws NotFoundException for unknown quickbooks object', async () => {
      const qbConn = { ...MOCK_CONNECTION, appName: 'quickbooks' };
      mocks.selectRows
        .mockResolvedValueOnce([qbConn])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([NULL_CREDS_ROW]);
      redis.get.mockResolvedValueOnce(null);
      mockPieceRegistry.getPiece.mockReturnValue({});

      await expect(
        service.describeFields(ORG_ID, CONN_ID, 'UnknownObject'),
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
  });
});
