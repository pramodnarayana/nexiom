# App Connection Manager Design (n8n Compatible)

## 1. Philosophy
FluxNex adopts the **n8n Credential Schema** to leverage the community standard for defining 300+ integrations.
- **Definition**: A TypeScript class defining *fields* (Client ID, Secret, Domain).
- **Storage**: Encrypted rows in the Database.
- **Runtime**: A generic `CredentialManager` that hydrates these definitions.

## 2. Credential Definition (The n8n Pattern)
We will replicate the `ICredentialType` interface.

```typescript
// packages/core/src/credentials/types.ts
export interface INodeProperties {
    displayName: string;
    name: string;
    type: 'string' | 'password' | 'hidden';
    default?: any;
}

export interface ICredentialType {
    name: string;
    displayName: string;
    documentationUrl?: string;
    properties: INodeProperties[];
}
```

### Example: Revenova Credentials
```typescript
// apps/worker/src/credentials/revenova.credentials.ts
import { ICredentialType, INodeProperties } from '@fluxnex/core';

export class RevenovaApi implements ICredentialType {
    name = 'revenovaApi';
    displayName = 'Revenova TMS API';
    properties: INodeProperties[] = [
        {
            displayName: 'Salesforce Instance URL',
            name: 'instanceUrl',
            type: 'string',
            default: 'https://login.salesforce.com',
        },
        {
            displayName: 'Access Token',
            name: 'accessToken',
            type: 'password',
        },
    ];
}
```

## 3. Database Schema
We store the *values* for these definitions securely.

### Table: `Connection`
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID | Primary Key |
| `tenant_id` | UUID | Owner |
| `type` | Varchar | e.g. `revenovaApi` (Matches Class Name) |
| `name` | Varchar | User Label e.g. "Revenova Production" |
| `data` | JSONB (Encrypted) | KV Pair: `{ instanceUrl: "...", accessToken: "..." }` |
| `status` | Enum | `ACTIVE`, `ERROR`, `EXPIRED` |

## 4. Token Lifecycle Management (OAuth2)
For OAuth2 providers (QuickBooks, HubSpot), we need a centralized **Token Refresher**.

### Architecture
1.  **Storage**: OAuth tokens (Access + Refresh) are stored in the `data` column (Encrypted).
2.  **Refresh Worker**:
    - Periodically checks for tokens expiring in < 10 mins.
    - Uses the `ICredentialType` logic (some defines refresh logic) to renew.
    - Updates the DB record.

### Runtime Injection
When a Worker requests a connection:
```typescript
// packages/core/src/credentials/manager.ts
async function getConnection(tenantId: string, connectionName: string) {
    // 1. Fetch from DB
    const conn = await db.connection.findFirst({ ... });
    
    // 2. Decrypt
    const plainData = decrypt(conn.data);

    // 3. Auto-Refresh Check (if OAuth)
    if (isExpired(plainData)) {
        plainData = await RefreshService.refreshToken(plainData);
    }

    return plainData;
}
```
