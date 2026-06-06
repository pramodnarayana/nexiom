import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApplicationShardEventHandler } from './application-shard-event.handler.js';
import { ApplicationLoaderService } from './application-loader.service.js';

describe('ApplicationShardEventHandler', () => {
    let handler: ApplicationShardEventHandler;
    let loaderMock: any;
    let shardMock: any;

    beforeEach(() => {
        shardMock = {
            extractReplica: vi.fn(),
            normalize: vi.fn(),
            writeNormalized: vi.fn(),
            buildTarget: vi.fn(),
            provisionDomain: vi.fn(),
            prepareUpdate: vi.fn(),
            getWebhookResponse: vi.fn(),
            activeFetch: vi.fn(),
            reverseLookup: vi.fn(),
        };

        loaderMock = {
            load: vi.fn().mockResolvedValue(shardMock),
        };

        handler = new ApplicationShardEventHandler(loaderMock as unknown as ApplicationLoaderService);
    });

    it('handleExtractReplica', async () => {
        await handler.handleExtractReplica({ appName: 'app', appProfile: 'profile', data: {} });
        expect(loaderMock.load).toHaveBeenCalledWith('app/profile');
        expect(shardMock.extractReplica).toHaveBeenCalled();
    });

    it('handleNormalize', async () => {
        await handler.handleNormalize({ appName: 'app', appProfile: 'profile', replica: { entityType: 't', data: {} } });
        expect(shardMock.normalize).toHaveBeenCalled();
    });

    it('handleWriteNormalized', async () => {
        await handler.handleWriteNormalized({ appName: 'app', appProfile: 'profile', tx: {}, db: {} as any, schemaName: 's', replicaId: 'r', entityId: 'e', traceId: 't', normalizedEntityType: 'n', data: {} });
        expect(shardMock.writeNormalized).toHaveBeenCalled();
    });

    it('handleWriteNormalized when missing', async () => {
        shardMock.writeNormalized = undefined;
        const res = await handler.handleWriteNormalized({ appName: 'app', appProfile: 'profile', tx: {}, db: {} as any, schemaName: 's', replicaId: 'r', entityId: 'e', traceId: 't', normalizedEntityType: 'n', data: {} });
        expect(res).toBeUndefined();
    });

    it('handleBuildTarget', async () => {
        await handler.handleBuildTarget({ appName: 'app', appProfile: 'profile', db: {} as any, schemaName: 's', normalizedEntityType: 'n', srcEntityId: 'e' });
        expect(shardMock.buildTarget).toHaveBeenCalled();
    });

    it('handleBuildTarget when missing', async () => {
        shardMock.buildTarget = undefined;
        const res = await handler.handleBuildTarget({ appName: 'app', appProfile: 'profile', db: {} as any, schemaName: 's', normalizedEntityType: 'n', srcEntityId: 'e' });
        expect(res).toEqual({});
    });

    it('handleProvisionDomain', async () => {
        await handler.handleProvisionDomain({ appName: 'app', appProfile: 'profile', db: {} as any, schemaName: 's' });
        expect(shardMock.provisionDomain).toHaveBeenCalled();
    });

    it('handleProvisionDomain when missing', async () => {
        shardMock.provisionDomain = undefined;
        const res = await handler.handleProvisionDomain({ appName: 'app', appProfile: 'profile', db: {} as any, schemaName: 's' });
        expect(res).toBeUndefined();
    });

    it('handlePrepareUpdate', async () => {
        shardMock.prepareUpdate.mockReturnValueOnce({ ok: true });
        const res = await handler.handlePrepareUpdate({ appName: 'app', appProfile: 'profile', data: {} });
        expect(res).toEqual({ ok: true });
        expect(shardMock.prepareUpdate).toHaveBeenCalled();
    });

    it('handlePrepareUpdate catches ENOENT', async () => {
        loaderMock.load.mockRejectedValueOnce(new Error('ENOENT'));
        const res = await handler.handlePrepareUpdate({ appName: 'app', appProfile: 'profile', data: { a: 1 } });
        expect(res).toEqual({ a: 1 });
    });

    it('handlePrepareUpdate throws other errors', async () => {
        loaderMock.load.mockRejectedValueOnce(new Error('other error'));
        await expect(handler.handlePrepareUpdate({ appName: 'app', appProfile: 'profile', data: {} })).rejects.toThrow('other error');
    });

    it('handlePrepareUpdate when missing', async () => {
        shardMock.prepareUpdate = undefined;
        const res = await handler.handlePrepareUpdate({ appName: 'app', appProfile: 'profile', data: { a: 2 } });
        expect(res).toEqual({ a: 2 });
    });

    it('handleGetWebhookResponse', async () => {
        await handler.handleGetWebhookResponse({ appName: 'app', appProfile: 'profile', body: {}, headers: {} });
        expect(shardMock.getWebhookResponse).toHaveBeenCalled();
    });

    it('handleGetWebhookResponse catches ENOENT', async () => {
        loaderMock.load.mockRejectedValueOnce(new Error('ENOENT'));
        const res = await handler.handleGetWebhookResponse({ appName: 'app', appProfile: 'profile', body: {}, headers: {} });
        expect(res).toBeNull();
    });

    it('handleGetWebhookResponse throws other errors', async () => {
        loaderMock.load.mockRejectedValueOnce(new Error('other'));
        await expect(handler.handleGetWebhookResponse({ appName: 'app', appProfile: 'profile', body: {}, headers: {} })).rejects.toThrow('other');
    });

    it('handleGetWebhookResponse when missing', async () => {
        shardMock.getWebhookResponse = undefined;
        const res = await handler.handleGetWebhookResponse({ appName: 'app', appProfile: 'profile', body: {}, headers: {} });
        expect(res).toBeNull();
    });

    it('handleActiveFetch', async () => {
        await handler.handleActiveFetch({ appName: 'app', appProfile: 'profile', missingDependencies: [], dataSourceId: '1' });
        expect(shardMock.activeFetch).toHaveBeenCalled();
    });

    it('handleActiveFetch when missing', async () => {
        shardMock.activeFetch = undefined;
        const res = await handler.handleActiveFetch({ appName: 'app', appProfile: 'profile', missingDependencies: [], dataSourceId: '1' });
        expect(res).toBeUndefined();
    });

    it('handleReverseLookup', async () => {
        await handler.handleReverseLookup({ appName: 'app', appProfile: 'profile', db: {} as any, schemaName: 's', normalizedEntityType: 'n', entityId: 'e' });
        expect(shardMock.reverseLookup).toHaveBeenCalled();
    });

    it('handleReverseLookup when missing', async () => {
        shardMock.reverseLookup = undefined;
        const res = await handler.handleReverseLookup({ appName: 'app', appProfile: 'profile', db: {} as any, schemaName: 's', normalizedEntityType: 'n', entityId: 'e' });
        expect(res).toEqual([]);
    });
});
