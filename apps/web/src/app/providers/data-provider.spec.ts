import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist mocks to ensure they are available before imports
const mocks = vi.hoisted(() => {
    return {
        get: vi.fn(),
        create: vi.fn(),
        simpleRestProvider: vi.fn(() => ({
            getList: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            deleteOne: vi.fn(),
        })),
    };
});

// Mock simple-rest provider
vi.mock('@refinedev/simple-rest', () => ({
    default: mocks.simpleRestProvider,
}));

// Mock Axios
vi.mock('axios', () => ({
    default: {
        create: mocks.create
    }
}));

describe('DataProvider', () => {
    let dataProvider: any;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Setup default mock implementation for axios.create
        mocks.create.mockReturnValue({
            get: mocks.get,
            interceptors: {
                request: { use: vi.fn(), eject: vi.fn() },
                response: { use: vi.fn(), eject: vi.fn() },
            },
            defaults: { headers: { common: {} } }
        });

        // Re-import to ensure fresh execution and instance creation
        const module = await import('./data-provider');
        dataProvider = module.dataProvider;
    });

    afterEach(() => {
        vi.resetModules();
        vi.restoreAllMocks();
    });

    describe('Configuration', () => {
        it('should initialize axios with credentials for secure cross-origin requests', () => {
            expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
                withCredentials: true,
            }));
        });
    });

    describe('getList', () => {
        const RESOURCE = 'posts';
        const API_URL = import.meta.env.VITE_API_URL || '';

        it('should construct correct URL and parameters for pagination', async () => {
            mocks.get.mockResolvedValue({
                data: { data: [], total: 0 }
            });

            await dataProvider.getList({
                resource: RESOURCE,
                pagination: { current: 2, pageSize: 25 },
            });

            expect(mocks.get).toHaveBeenCalledWith(
                `${API_URL}/${RESOURCE}`,
                expect.objectContaining({
                    params: expect.objectContaining({
                        page: 2,
                        pageSize: 25,
                    })
                })
            );
        });

        it('should handle successful response with explicit total', async () => {
            const mockData = [{ id: 1, title: 'Item 1' }];
            const mockTotal = 100;

            mocks.get.mockResolvedValue({
                data: {
                    data: mockData,
                    total: mockTotal
                }
            });

            const result = await dataProvider.getList({ resource: RESOURCE });

            expect(result).toEqual({
                data: mockData,
                total: mockTotal,
            });
        });

        it('should fallback to data length if total is missing', async () => {
            const mockData = [{ id: 1 }, { id: 2 }];

            mocks.get.mockResolvedValue({
                data: {
                    data: mockData,
                    // total is undefined
                }
            });

            const result = await dataProvider.getList({ resource: RESOURCE });

            expect(result).toEqual({
                data: mockData,
                total: 2,
            });
        });

        it('should robustly handle invalid API response (null data)', async () => {
            // Simulate a malformed 200 OK response from a proxy or broken upstream
            mocks.get.mockResolvedValue({ data: null });

            // Suppress error logging for expected error test
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            const result = await dataProvider.getList({ resource: RESOURCE });

            expect(result).toEqual({
                data: [],
                total: 0,
            });

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('[DataProvider] Invalid response'),
                null
            );
        });

        it('should robustly handle invalid API response (missing array)', async () => {
            mocks.get.mockResolvedValue({
                data: { data: "not-an-array" }
            });
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            const result = await dataProvider.getList({ resource: RESOURCE });

            expect(result).toEqual({
                data: [],
                total: 0,
            });

            expect(consoleSpy).toHaveBeenCalled();
        });

        it('should propagate network or server errors to the caller', async () => {
            const networkError = new Error('Network Error');
            mocks.get.mockRejectedValue(networkError);
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            await expect(dataProvider.getList({ resource: RESOURCE }))
                .rejects.toThrow('Network Error');

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('[DataProvider] Error fetching'),
                networkError
            );
        });
    });
});
