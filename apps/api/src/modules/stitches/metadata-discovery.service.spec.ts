import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
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

  return {
    selectRows,
    db: {
      select,
      insert,
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
    mocks = buildMockDb();
    redis = buildMockRedis();
    mockPieceRegistry = { getPiece: vi.fn() };
    mockEncryption = { decrypt: vi.fn() };

    // Default: connection found, no DB cache rows
    mocks.selectRows.mockResolvedValue([MOCK_CONNECTION]);

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
    vi.clearAllMocks();
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
          // DB cache check
          { objectName: 'Contact', updatedAt: freshUpdatedAt },
          { objectName: 'Account', updatedAt: freshUpdatedAt },
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
    });

    it('calls Prism for salesforce when piece has no describeObjects', async () => {
      mocks.selectRows
        .mockResolvedValueOnce([MOCK_CONNECTION])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([NULL_CREDS_ROW]);
      redis.get.mockResolvedValueOnce(null);
      mockPieceRegistry.getPiece.mockReturnValue({});

      const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
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

      const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
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

    it('returns common Id field for unknown quickbooks object', async () => {
      const qbConn = { ...MOCK_CONNECTION, appName: 'quickbooks' };
      mocks.selectRows
        .mockResolvedValueOnce([qbConn])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([NULL_CREDS_ROW]);
      redis.get.mockResolvedValueOnce(null);
      mockPieceRegistry.getPiece.mockReturnValue({});

      const result = await service.describeFields(
        ORG_ID,
        CONN_ID,
        'UnknownObject',
      );
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Id');
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
