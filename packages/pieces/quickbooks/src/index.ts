import {
  createPiece,
  createCustomApiCallAction,
  PieceCategory
} from '@nexiom/connectors/framework';
import { quickbooksAuth } from './lib/auth.js';
import { quickbooksCommon } from './lib/common.js';
import { quickbooksUniversalTrigger } from './triggers/universal-trigger.js';
import type { QuickBooksAuth } from './triggers/quickbooks-polling.helper.js';

const customApiAction = createCustomApiCallAction({
  auth: quickbooksAuth,
  baseUrl: (auth: QuickBooksAuth) => {
    const companyId = auth.props?.['companyId'];
    if (!companyId || typeof companyId !== 'string' || companyId.trim() === '') {
      throw new Error('QuickBooks authentication missing or invalid companyId');
    }

    const useSandbox = auth.props?.['environment'] === 'test';
    const apiUrl = quickbooksCommon.getApiUrl(companyId, useSandbox);
    return apiUrl;
  },
  authMapping: async (auth: QuickBooksAuth) => {
    return {
      Authorization: `Bearer ${auth.access_token}`
    }
  }
});

export const quickbooks = createPiece({
  name: "quickbooks",
  displayName: "Quickbooks Online",
  auth: quickbooksAuth,
  minimumSupportedRelease: '0.36.1',
  logoUrl: "https://cdn.activepieces.com/pieces/quickbooks.png",
  authors: [
    'onyedikachi-david'
  ],
  categories: [PieceCategory.ACCOUNTING],
  actions: [
    customApiAction
  ],
  triggers: [
    quickbooksUniversalTrigger
  ],
});
