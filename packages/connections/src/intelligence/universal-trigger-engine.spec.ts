import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UniversalTriggerEngine } from './universal-trigger-engine.js';
import { SmartCursorSelector } from './smart-cursor-selector.js';
import type {
    UniversalEngineConfig,
    IDiscoveryAdapter,
    IQueryAdapter,
    IBulkAdapter,
    ObjectSchema
} from './interfaces.js';
import type { TriggerStore } from '../framework/index.js';

// Mock dependencies
vi.mock('./smart-cursor-selector.js', () => ({
    SmartCursorSelector: {
        pick: vi.fn(),
    },
}));

vi.mock('./igt-logger.js', () => ({
    IgtLogger: class {
        debug = vi.fn();
        info = vi.fn();
        warn = vi.fn();
        error = vi.fn();
    }
}));

vi.mock('../apps/salesforce/sf-fetch.js', () => ({
    checkSalesforceLimits: vi.fn().mockResolvedValue({ total: 15000, remaining: 14000 })
}));

describe('UniversalTriggerEngine', () => {
    let mockStore: any;
    let mockDiscoveryAdapter: IDiscoveryAdapter;
    let mockQueryAdapter: IQueryAdapter & { buildCountQuery: ReturnType<typeof vi.fn> };
    let mockBulkAdapter: IBulkAdapter;
    let mockExecuteStandardQuery: any;
    let mockExecuteCountQuery: any;

    const mockSchema: ObjectSchema = {
        objectName: 'TestObject',
        fields: [{ name: 'LastModifiedDate', type: 'datetime', filterable: true, sortable: true, nillable: false } as any],
        childRelationships: [],
        fetchedAt: Date.now()
    };

    const createStore = (): TriggerStore => ({
        put: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
    });

    beforeEach(() => {
        vi.clearAllMocks();

        mockStore = createStore();

        mockDiscoveryAdapter = {
            describe: vi.fn().mockResolvedValue(mockSchema),
            fieldExists: vi.fn().mockResolvedValue(true),
            invalidate: vi.fn().mockResolvedValue(undefined),
        };

        mockQueryAdapter = {
            buildQuery: vi.fn().mockReturnValue('SELECT * FROM TestObject'),
            buildCountQuery: vi.fn().mockReturnValue('SELECT COUNT() FROM TestObject'),
        };

        mockBulkAdapter = {
            runBulkJob: vi.fn().mockResolvedValue([{ id: '1', LastModifiedDate: '2026-03-01T00:00:00.000Z' }]),
        };

        mockExecuteStandardQuery = vi.fn().mockResolvedValue([
            { id: '1', LastModifiedDate: '2026-03-01T00:00:00.000Z' },
            { id: '2', LastModifiedDate: '2026-03-02T00:00:00.000Z' },
        ]);

        mockExecuteCountQuery = vi.fn().mockResolvedValue(10);

        vi.mocked(SmartCursorSelector.pick).mockReturnValue('LastModifiedDate');
    });

    const createConfig = (overrides = {}): UniversalEngineConfig<unknown> => ({
        auth: {},
        objectName: 'TestObject',
        store: mockStore as unknown as TriggerStore,
        discoveryAdapter: mockDiscoveryAdapter,
        queryAdapter: mockQueryAdapter,
        bulkAdapter: mockBulkAdapter,
        executeStandardQuery: mockExecuteStandardQuery,
        executeCountQuery: mockExecuteCountQuery,
        ...overrides,
    });

    it('should halt and return empty array if field drift is detected', async () => {
        (mockDiscoveryAdapter.fieldExists as any).mockResolvedValue(false);
        const config = createConfig();

        const records = await UniversalTriggerEngine.execute(config);

        expect(records).toEqual([]);
        expect(mockStore.get).not.toHaveBeenCalledWith('igt_TestObject_LastModifiedDate');
        expect(mockExecuteStandardQuery).not.toHaveBeenCalled();
    });

    it('should fetch last cursor and execute standard query when size is under bulk threshold', async () => {
        (mockStore.get).mockResolvedValue('2026-01-01T00:00:00.000Z');
        (mockExecuteCountQuery).mockResolvedValue(100);

        const config = createConfig({
            hint: { bulkThreshold: 500 }
        });

        const records = await UniversalTriggerEngine.execute(config);

        expect(mockDiscoveryAdapter.describe).toHaveBeenCalled();
        expect(mockStore.get).toHaveBeenCalledWith('igt_TestObject_LastModifiedDate');

        expect(mockQueryAdapter.buildCountQuery).toHaveBeenCalledWith(
            mockSchema,
            expect.objectContaining({ objectName: 'TestObject', cursorValue: '2026-01-01T00:00:00.000Z' })
        );
        expect(mockQueryAdapter.buildQuery).toHaveBeenCalledWith(
            mockSchema,
            expect.objectContaining({ objectName: 'TestObject', cursorValue: '2026-01-01T00:00:00.000Z' })
        );

        expect(mockExecuteCountQuery).toHaveBeenCalled();
        expect(mockExecuteStandardQuery).toHaveBeenCalled();
        expect(mockBulkAdapter.runBulkJob).not.toHaveBeenCalled();

        // Assert we got records
        expect(records.length).toBe(2);

        // Assert cursor was saved with typed unix epoch
        expect(mockStore.put).toHaveBeenCalledWith(
            'igt_TestObject_LastModifiedDate',
            '1772409600000||2'
        );
    });

    it('should correctly replay an epoch-based cursor and format it as ISO string for queries', async () => {
        (mockStore.get).mockResolvedValue('1772409600000||2');
        (mockExecuteCountQuery).mockResolvedValue(100);

        const config = createConfig({
            hint: { bulkThreshold: 500 }
        });

        await UniversalTriggerEngine.execute(config);

        expect(mockQueryAdapter.buildCountQuery).toHaveBeenCalledWith(
            mockSchema,
            expect.objectContaining({ objectName: 'TestObject', cursorValue: '2026-03-02T00:00:00.000Z' })
        );
        expect(mockQueryAdapter.buildQuery).toHaveBeenCalledWith(
            mockSchema,
            expect.objectContaining({ objectName: 'TestObject', cursorValue: '2026-03-02T00:00:00.000Z' })
        );
    });

    it('should execute bulk job when preflight count exceeds bulk threshold', async () => {
        (mockExecuteCountQuery).mockResolvedValue(600);

        const config = createConfig({
            hint: { bulkThreshold: 500 }
        });

        const records = await UniversalTriggerEngine.execute(config);

        expect(mockQueryAdapter.buildCountQuery).toHaveBeenCalledWith(
            mockSchema,
            expect.anything()
        );
        expect(mockQueryAdapter.buildQuery).toHaveBeenCalledWith(
            mockSchema,
            expect.anything()
        );

        expect(mockExecuteCountQuery).toHaveBeenCalled();
        expect(mockBulkAdapter.runBulkJob).toHaveBeenCalled();
        expect(mockExecuteStandardQuery).not.toHaveBeenCalled();
        expect(records.length).toBe(1);
    });

    it('should bypass query entirely if preflight count is exactly 0', async () => {
        (mockExecuteCountQuery).mockResolvedValue(0);

        const config = createConfig();

        const records = await UniversalTriggerEngine.execute(config);

        expect(mockQueryAdapter.buildCountQuery).toHaveBeenCalledWith(
            mockSchema,
            expect.anything()
        );

        expect(mockExecuteCountQuery).toHaveBeenCalled();
        expect(mockBulkAdapter.runBulkJob).not.toHaveBeenCalled();
        expect(mockExecuteStandardQuery).not.toHaveBeenCalled();
        expect(records.length).toBe(0);
        expect(mockStore.put).not.toHaveBeenCalled();
    });

    it('should handle engines without a Count API implementation', async () => {
        const config = createConfig({
            executeCountQuery: undefined
        });

        const records = await UniversalTriggerEngine.execute(config);

        expect(mockQueryAdapter.buildQuery).toHaveBeenCalledWith(
            mockSchema,
            expect.anything()
        );
        expect(mockExecuteStandardQuery).toHaveBeenCalled();
        expect(mockBulkAdapter.runBulkJob).not.toHaveBeenCalled();
        expect(records.length).toBe(2);
    });

    it('should handle engines without a Bulk Adapter implementation', async () => {
        (mockExecuteCountQuery).mockResolvedValue(10000); // Massive size

        const config = createConfig({
            bulkAdapter: undefined
        });

        const records = await UniversalTriggerEngine.execute(config);

        // Even though size is massive, we have no bulk adapter, must route to standard
        expect(mockQueryAdapter.buildCountQuery).toHaveBeenCalledWith(mockSchema, expect.anything());
        expect(mockQueryAdapter.buildQuery).toHaveBeenCalledWith(mockSchema, expect.anything());
        expect(mockExecuteCountQuery).toHaveBeenCalled();
        expect(mockExecuteStandardQuery).toHaveBeenCalled();
        expect(records.length).toBe(2);
    });

    it('should block polling if API-limit gating triggers', async () => {
        // Mock the bounds checker to return limits < threshold (e.g., extremely low ratio)
        const checkSalesforceLimitsMock = await import('../apps/salesforce/sf-fetch.js');
        vi.mocked(checkSalesforceLimitsMock.checkSalesforceLimits).mockResolvedValueOnce({ total: 10000, remaining: 100 });

        const config = createConfig();

        const records = await UniversalTriggerEngine.execute(config);

        // Expect empty array due to block
        expect(records).toEqual([]);

        // Assert core downstream polling adapters were completely bypassed
        expect(mockDiscoveryAdapter.describe).not.toHaveBeenCalled();
        expect(mockQueryAdapter.buildCountQuery).not.toHaveBeenCalled();
        expect(mockExecuteCountQuery).not.toHaveBeenCalled();
        expect(mockExecuteStandardQuery).not.toHaveBeenCalled();
        expect(mockBulkAdapter.runBulkJob).not.toHaveBeenCalled();
    });

    it('should fall back to standard path if count-query preflight throws', async () => {
        // Reject the executeCountQuery callback so that `totalSize = -1`
        (mockExecuteCountQuery).mockRejectedValue(new Error('Syntax error on COUNT() clause'));

        const config = createConfig();

        const records = await UniversalTriggerEngine.execute(config);

        // Preflight count should be flagged as failed without throwing entirely
        expect(mockExecuteCountQuery).toHaveBeenCalled();

        // The system should fall back to standard fetch because bulk relies on valid threshold exceeding
        expect(mockExecuteStandardQuery).toHaveBeenCalled();
        expect(mockBulkAdapter.runBulkJob).not.toHaveBeenCalled();

        // Assert standard fetch behavior continued downstream
        expect(records.length).toBe(2);
    });
});
