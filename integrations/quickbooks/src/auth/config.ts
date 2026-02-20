import { GenericCredentialType } from "@nexiom/engine";

export const quickbooksAuth: GenericCredentialType = {
  name: "quickbooks",
  authType: "OAUTH2",
  oauth: {
    authorizeUrl: "https://appcenter.intuit.com/connect/oauth2",
    tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    scope: ["com.intuit.quickbooks.accounting"],
  },
  uiSchema: {
    type: "object",
    properties: [
      {
        name: "clientId",
        label: "Client ID",
        type: "shortText",
        required: true,
      },
      {
        name: "clientSecret",
        label: "Client Secret",
        type: "secretText",
        required: true,
      },
    ],
  },
};
