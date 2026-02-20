import { GenericCredentialType } from "@nexiom/engine";

/**
 * Salesforce provider definition — used as seed data for the `providers` table.
 * OAuth URLs (authorizeUrl, tokenUrl) are stored in the DB and can be
 * overridden per-tenant for sandbox / custom domains.
 */
export const salesforceAuth: GenericCredentialType = {
  name: "salesforce",
  authType: "OAUTH2",
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
      {
        name: "loginUrl",
        label: "Login URL",
        type: "shortText",
        required: false,
        description:
          "Override for sandbox (https://test.salesforce.com) or custom domains. Defaults to https://login.salesforce.com.",
      },
    ],
  },
};
