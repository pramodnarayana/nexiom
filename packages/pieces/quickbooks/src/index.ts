import {
  createPiece,

  PieceAuth,

  Property,
  createCustomApiCallAction,
} from '@nexiom/connectors/framework';
import { quickbooksCommon } from './lib/common';
import { quickbooksUniversalTrigger } from './triggers/universal-trigger.js';

export const quickbooksAuth = PieceAuth.OAuth2({
  description: 'You can find Company ID under **settings->Additional Info**.',
  required: true,
  props: {
    companyId: Property.ShortText({
      displayName: 'Company ID',
      required: true,
    }),
    useSandbox: Property.Checkbox({
      displayName: 'Use Sandbox',
      description: 'Check to use the QuickBooks Sandbox environment',
      required: false,
    })
  },
  authUrl: 'https://appcenter.intuit.com/connect/oauth2',
  tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
  scope: ['com.intuit.quickbooks.accounting'],
});

export const quickbooks = createPiece({
  displayName: "Quickbooks Online",
  auth: quickbooksAuth,
  minimumSupportedRelease: '0.36.1',
  logoUrl: "https://cdn.activepieces.com/pieces/quickbooks.png",
  authors: [
    'onyedikachi-david'
  ],
  actions: [
    createCustomApiCallAction({
      auth: quickbooksAuth,
      baseUrl: (auth: any) => {
        const authValue = auth;
        const companyId = authValue.props?.['companyId'];
        if (!companyId || typeof companyId !== 'string' || companyId.trim() === '') {
          throw new Error('QuickBooks authentication missing or invalid companyId');
        }

        const useSandbox = authValue.props?.['useSandbox'] === true;
        const apiUrl = quickbooksCommon.getApiUrl(companyId, useSandbox);
        return apiUrl;
      },
      authMapping: async (auth) => {
        return {
          Authorization: `Bearer ${(auth).access_token}`
        }
      }
    })
  ],
  triggers: [
    quickbooksUniversalTrigger
  ],
});
