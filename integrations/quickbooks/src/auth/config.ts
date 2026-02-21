import { GenericCredentialType } from "@nexiom/connections";

export const quickbooksAuth: GenericCredentialType = {
  name: "quickbooks",
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
    ],
  },
};
