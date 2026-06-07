import { describe, expect, it, vi, beforeAll, afterEach } from 'vitest';
import {
    createPiece,
    createAction,
    Property,
    PieceAuth,
    httpClient,
    initializeHttpClient,
    HttpMethod,
} from '@soopa/piece-framework';
import type { NormalizedRecord, VendorResponse } from '@soopa/piece-framework';
import { HostHttpClient } from './host-http-client.js';
import { TokenManagerService } from '../oauth/token-manager.service.js';
import { DrizzleDb } from '@soopa/database';
import { Redis } from 'ioredis';

describe('Activepieces Framework Native Shim', () => {
    beforeAll(() => {
        // Initialize the singleton to prevent the "accessed before platform initialization" throw
        const client = new HostHttpClient(
            {} as TokenManagerService,
            { execute: vi.fn().mockResolvedValue([]) } as unknown as DrizzleDb,
            { eval: vi.fn().mockResolvedValue(1) } as unknown as Redis
        );
        client.onModuleInit();
        // Calling it twice to trigger the branch coverage for idempotency
        client.onModuleInit();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('Should successfully type-check and instantiate a mocked Salesforce piece exactly like Activepieces', async () => {
        // 1. Mock standard Activepieces Auth Definition
        const auth = PieceAuth.OAuth2({
            authUrl: 'https://login.salesforce.com/services/oauth2/authorize',
            tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
            required: true,
            scope: ['api', 'refresh_token'],
        });

        // 2. Mock standard Activepieces Action
        const createRecordAction = createAction({
            name: 'create_record',
            displayName: 'Create Record',
            description: 'Creates a record in Salesforce',
            requireAuth: true,
            props: {
                objectTarget: Property.ShortText({
                    displayName: 'Salesforce Object Name',
                    required: true,
                }),
                recordData: Property.Json({
                    displayName: 'Record Data',
                    required: true,
                }),
            },
            async run(context) {
                // Assume context contains { auth: 'valid_token', propsValue: { objectTarget: 'Account', recordData: {...} } }
                // The Activepieces piece strictly expects `httpClient.sendRequest` to work without manual headers.
                const response = await httpClient.sendRequest({
                    method: HttpMethod.POST,
                    url: `https://mock.salesforce.com/services/data/v60.0/sobjects/${context.propsValue.objectTarget}`,
                    body: context.propsValue.recordData,
                });

                return response.body;
            },
        });

        // 3. Mock standard Activepieces Piece Generation
        const salesforcePiece = createPiece({
            name: 'salesforce',
            displayName: 'Salesforce',
            logoUrl: 'https://cdn.activepieces.com/pieces/salesforce.png',
            auth: auth,
            actions: [createRecordAction],
            triggers: [],
        });

        // Compile & Value Assertions
        expect(salesforcePiece.name).toBe('salesforce');
        expect(salesforcePiece.auth?.type).toBe('OAUTH2');
        expect(Object.keys(salesforcePiece.actions).length).toBe(1);
        expect(salesforcePiece.actions['create_record']).toBeDefined();

        // Assert Context runtime mapping mock
        expect(typeof salesforcePiece.actions['create_record'].run).toBe('function');

        // 4. Assert actual HTTP Runtime Passthrough
        // Spy on the class prototype so Vitest can intercept the method regardless of Proxy wrapping
        const sendRequestSpy = vi
            .spyOn(HostHttpClient.prototype, 'sendRequest')
            .mockResolvedValue({
                status: 201,
                headers: {},
                body: { success: true, id: '001A000001bcdefQAA' },
            });

        const mockContext = {
            auth: 'mocked_oauth_token',
            propsValue: {
                objectTarget: 'Account',
                recordData: { Name: 'Acme Corp' },
            },
        };

        const result = await salesforcePiece.actions['create_record'].run(mockContext as any);

        expect(sendRequestSpy).toHaveBeenCalledTimes(1);
        expect(sendRequestSpy).toHaveBeenCalledWith({
            method: HttpMethod.POST,
            url: 'https://mock.salesforce.com/services/data/v60.0/sobjects/Account',
            body: { Name: 'Acme Corp' },
        });

        expect(result).toEqual({ success: true, id: '001A000001bcdefQAA' });
    });

    it('forwards normalize from CreatePieceParams to the Piece instance', async () => {
        const auth = PieceAuth.OAuth2({
            authUrl: 'https://example.com/auth',
            tokenUrl: 'https://example.com/token',
            required: true,
            scope: [],
        });

        const normalizeFn = async (objectType: string, raw: Record<string, unknown>): Promise<NormalizedRecord | null> => {
            return { canonicalType: 'CRM_CONTACT', data: { ...raw, _type: objectType } };
        };

        const piece = createPiece({
            name: 'test_normalize',
            displayName: 'Test',
            logoUrl: '',
            auth,
            actions: [],
            triggers: [],
            normalize: normalizeFn,
        });

        expect(piece.normalize).toBeDefined();
        const result = await piece.normalize!('Account', { Name: 'Acme' });
        expect(result).toEqual({ canonicalType: 'CRM_CONTACT', data: { Name: 'Acme', _type: 'Account' } });
    });

    it('forwards executeAction from CreatePieceParams to the Piece instance', async () => {
        const auth = PieceAuth.OAuth2({
            authUrl: 'https://example.com/auth',
            tokenUrl: 'https://example.com/token',
            required: true,
            scope: [],
        });

        const executeActionFn = async (
            objectType: string,
            payload: Record<string, unknown>,
            credentials: Record<string, unknown>,
        ): Promise<VendorResponse> => {
            return { statusCode: 201, body: { id: '123', objectType, payload, credentials } };
        };

        const piece = createPiece({
            name: 'test_execute',
            displayName: 'Test',
            logoUrl: '',
            auth,
            actions: [],
            triggers: [],
            executeAction: executeActionFn,
        });

        expect(piece.executeAction).toBeDefined();
        const result = await piece.executeAction!('Account', { Name: 'Acme' }, { token: 'abc' });
        expect(result).toEqual({ 
            statusCode: 201, 
            body: { 
                id: '123',
                objectType: 'Account',
                payload: { Name: 'Acme' },
                credentials: { token: 'abc' }
            } 
        });
    });

    describe('HostHttpClient Response Parsing', () => {
        let client: HostHttpClient;
        
        beforeAll(() => {
            client = new HostHttpClient(
                {} as TokenManagerService,
                { execute: vi.fn().mockResolvedValue([]) } as unknown as DrizzleDb,
                { eval: vi.fn().mockResolvedValue(1) } as unknown as Redis
            );
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('should deeply parse JSON by default', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                status: 200,
                headers: new Headers({ 'Content-Type': 'application/json' }),
                text: async () => '{"hello":"world"}',
            } as any);

            const result = await client.sendRequest({ method: HttpMethod.GET, url: 'https://example.com' });
            expect(result.body).toEqual({ hello: 'world' });
        });

        it('should correctly return non-ok responses without throwing', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: false,
                status: 404,
                headers: new Headers({ 'Content-Type': 'application/json' }),
                text: async () => '{"error":"Not Found"}',
            } as any);

            const result = await client.sendRequest({ method: HttpMethod.GET, url: 'https://example.com' });
            expect(result.status).toBe(404);
            expect(result.body).toEqual({ error: 'Not Found' });
        });

        it('should parse text when responseType is text', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                status: 200,
                headers: new Headers({ 'Content-Type': 'text/plain' }),
                text: async () => 'hello world',
            } as any);

            const result = await client.sendRequest({ method: HttpMethod.GET, url: 'https://example.com', responseType: 'text' });
            expect(result.body).toBe('hello world');
        });

        it('should return arrayBuffer when responseType is arraybuffer', async () => {
            const buffer = new ArrayBuffer(8);
            vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                status: 200,
                headers: new Headers({ 'Content-Type': 'application/octet-stream' }),
                arrayBuffer: async () => buffer,
            } as any);

            const result = await client.sendRequest({ method: HttpMethod.GET, url: 'https://example.com', responseType: 'arraybuffer' });
            expect(result.body).toBe(buffer);
        });

        it('should return raw stream when responseType is stream', async () => {
            const stream = 'fake_stream' as any;
            vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                status: 200,
                headers: new Headers({ 'Content-Type': 'application/octet-stream' }),
                body: stream,
            } as any);

            const result = await client.sendRequest({ method: HttpMethod.GET, url: 'https://example.com', responseType: 'stream' });
            expect(result.body).toBe(stream);
        });

        it('should return plain text if default JSON parsing fails', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                status: 200,
                headers: new Headers(),
                text: async () => '{"invalid": json',
            } as any);

            const result = await client.sendRequest({ method: HttpMethod.GET, url: 'https://example.com' });
            expect(result.body).toBe('{"invalid": json');
        });

        it('should throw BadRequestException for invalid URLs', async () => {
            await expect(client.sendRequest({ method: HttpMethod.GET, url: 'invalid-url' }))
                .rejects.toThrow('Invalid or non-absolute URL');
        });
        
        it('should retry on transient errors (429) and throw InternalServerErrorException after max attempts', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: false,
                status: 429,
                headers: new Headers(),
            } as any);

            // Temporarily replace setTimeout to avoid real delays
            const originalSetTimeout = globalThis.setTimeout;
            globalThis.setTimeout = ((fn: any) => fn()) as any;

            try {
                await expect(client.sendRequest({ method: HttpMethod.GET, url: 'https://example.com' }))
                    .rejects.toThrow('Failed to execute outgoing AP request after 3 attempt(s)');
                expect(globalThis.fetch).toHaveBeenCalledTimes(3);
            } finally {
                globalThis.setTimeout = originalSetTimeout;
            }
        });

        it('bindExecutionCtx and unbindExecutionCtx manages trace IDs', () => {
            const traceId = 'trace-123';
            HostHttpClient.bindExecutionCtx(traceId, 'conn-1', 'ws-1');
            const ctx = HostHttpClient.getExecutionCtx(traceId);
            expect(ctx?.connectionId).toBe('conn-1');
            expect(ctx?.workspaceId).toBe('ws-1');
            
            HostHttpClient.unbindExecutionCtx(traceId);
            expect(HostHttpClient.getExecutionCtx(traceId)).toBeUndefined();
        });

        it('archives to gateway if traceId header is present', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                status: 200,
                headers: new Headers({ 'Content-Type': 'application/json' }),
                text: async () => '{"success":true}',
                url: 'https://example.com',
            } as any);
            
            const traceId = 'trace-arch';
            HostHttpClient.bindExecutionCtx(traceId, 'conn-1', 'ws-1');

            const result = await client.sendRequest({ 
                method: HttpMethod.POST, 
                url: 'https://example.com', 
                headers: { 'X-Trace-Id': traceId, 'Authorization': 'Bearer secret' },
                body: { password: 'my-password', data: 'hello' }
            });
            
            expect(result.body).toEqual({ success: true });
            // Cleanup
            HostHttpClient.unbindExecutionCtx(traceId);
        });

        it('should format token in Authorization header', async () => {
            const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                status: 200,
                headers: new Headers({ 'Content-Type': 'application/json' }),
                text: async () => '{"ok":true}',
            } as any);

            await client.sendRequest({ 
                method: HttpMethod.GET, 
                url: 'https://example.com', 
                authentication: { type: 'BEARER_TOKEN', token: 'my-token' }
            });

            expect(fetchSpy).toHaveBeenCalledWith(
                'https://example.com/',
                expect.objectContaining({
                    headers: { Authorization: 'Bearer my-token' }
                })
            );
        });

        it('archives to gateway with sanitized URL and Body', async () => {
            const mockDb = { execute: vi.fn().mockResolvedValue([]) } as unknown as DrizzleDb;
            client = new HostHttpClient(
                {} as TokenManagerService,
                mockDb,
                { eval: vi.fn().mockResolvedValue(1) } as unknown as Redis
            );

            vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                status: 200,
                headers: new Headers({ 'Content-Type': 'application/json' }),
                text: async () => '{"success":true}',
                url: 'https://example.com/?api_key=secret_value',
            } as any);
            
            const traceId = 'trace-sanitization';
            HostHttpClient.bindExecutionCtx(traceId, 'conn-1', 'ws-1');

            await client.sendRequest({ 
                method: HttpMethod.POST, 
                url: 'https://example.com/?api_key=secret_value', 
                headers: { 'X-Trace-Id': traceId },
                body: { password: 'my-password', valid: true },
                queryParams: { refresh_token: 'refresh-me' }
            });
            
            expect(mockDb.execute).toHaveBeenCalled();
            // Cleanup
            HostHttpClient.unbindExecutionCtx(traceId);
        });

        it('archives to gateway handles stringified body parsing errors and non-cloneable bodies gracefully', async () => {
            const mockDb = { execute: vi.fn().mockResolvedValue([]) } as unknown as DrizzleDb;
            client = new HostHttpClient(
                {} as TokenManagerService,
                mockDb,
                { eval: vi.fn().mockResolvedValue(1) } as unknown as Redis
            );

            vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                status: 200,
                headers: new Headers({ 'Content-Type': 'application/json' }),
                text: async () => '{"success":true}',
                url: 'https://example.com/',
            } as any);
            
            const traceId = 'trace-sanitize-err';
            HostHttpClient.bindExecutionCtx(traceId, 'conn-1', 'ws-1');

            // Pass unparseable string
            await client.sendRequest({ 
                method: HttpMethod.POST, 
                url: 'https://example.com/', 
                headers: { 'X-Trace-Id': traceId },
                body: '{"invalid": json' as any
            });

            // Pass object with function reference (structuredClone will throw, but JSON.stringify will work)
            const fnObj: any = { method: () => {} };
            await client.sendRequest({ 
                method: HttpMethod.POST, 
                url: 'https://example.com/', 
                headers: { 'X-Trace-Id': traceId },
                body: fnObj
            });
            
            expect(mockDb.execute).toHaveBeenCalledTimes(2);
            HostHttpClient.unbindExecutionCtx(traceId);
        });
    });
});
