import { describe, it, expect, vi, beforeEach } from 'vitest';
import { salesforceUniversalTrigger } from './universal-trigger.js';
import { UniversalTrigger } from '@soopa/piece-framework/discovery';
import { SalesforceFetchError } from '../../adapters/native-fetch.adapter.js';

vi.mock('@soopa/piece-framework/discovery', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@soopa/piece-framework/discovery')>();
    return {
        ...actual,
        UniversalTrigger: {
            execute: vi.fn(),
        },
        IgtLogger: class {
            info() {}
            warn() {}
            error() {}
            debug() {}
        }
    };
});

describe('salesforceUniversalTrigger', () => {
    const mockContext = {
        propsValue: { object: 'Account' },
        store: {} as any,
        auth: {
            access_token: 'test_token',
            instance_url: 'https://test.salesforce.com'
        }
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should run universal trigger and return records', async () => {
        const expectedRecords = [{ Id: '1' }, { Id: '2' }];
        (UniversalTrigger.execute as any).mockResolvedValueOnce(expectedRecords);

        const result = await salesforceUniversalTrigger.run!(mockContext as any);

        expect(result).toEqual(expectedRecords);
        expect(UniversalTrigger.execute).toHaveBeenCalledTimes(1);
        
        const executeArg = (UniversalTrigger.execute as any).mock.calls[0][0];
        expect(executeArg.objectName).toBe('Account');
        expect(executeArg.auth.access_token).toBe('test_token');
    });

    it('should handle SalesforceFetchError appropriately', async () => {
        const authError = new SalesforceFetchError('Expired token', 401);
        (UniversalTrigger.execute as any).mockRejectedValueOnce(authError);

        await expect(salesforceUniversalTrigger.run!(mockContext as any))
            .rejects.toThrow('Your Salesforce connection has expired or been revoked');
    });

    it('should throw Error if access_token or instance_url is missing', async () => {
        const badContext = {
            propsValue: { object: 'Account' },
            store: {} as any,
            auth: { access_token: undefined }
        };

        await expect(salesforceUniversalTrigger.run!(badContext as any))
            .rejects.toThrow('Missing access_token or instance_url');
    });
});
