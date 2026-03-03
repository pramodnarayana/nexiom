import {
    createPiece,
    PieceAuth,
} from '../../framework/index.js';
import type { Piece } from '../../framework/index.js';
import { newRecordTrigger } from './triggers/new-record.js';
import { updatedRecordTrigger } from './triggers/updated-record.js';

/**
 * Salesforce Piece — bundles auth, actions (to be added), and the
 * two polling triggers into a single registry object.
 */
const salesforcePiece: Piece = createPiece({
    name: 'salesforce',
    displayName: 'Salesforce',
    logoUrl: 'https://cdn.activepieces.com/pieces/salesforce.png',
    description: 'CRM software solutions and enterprise cloud computing',
    auth: PieceAuth.OAuth2({
        required: true,
        authUrl: 'https://login.salesforce.com/services/oauth2/authorize',
        tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
        scope: ['refresh_token', 'api'],
    }),
    actions: [], // Actions added separately per feature
    triggers: [newRecordTrigger, updatedRecordTrigger],
});

export { salesforcePiece };
