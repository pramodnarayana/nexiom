import { describe, expect, it } from 'vitest';
import {
    createPiece,
    createAction,
    Property,
    PieceAuth,
    httpClient,
    HttpMethod,
} from './index.js';

describe('Activepieces Framework Native Shim', () => {
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
    });
});
