# Enterprise-Grade Provider Environment Configuration

## Context

When integrating with enterprise SaaS applications (Salesforce, QuickBooks, NetSuite, etc.), providers frequently offer "Production" and "Sandbox" environments. These environments typically require distinct OAuth Authorization and Token exchange endpoints.

Our initial implementation hardcoded conditional checks within the core integration engine (`connectors.service.ts`) specifically looking for `provider === 'salesforce'` to override URLs. This violates the Open-Closed principle and creates technical debt as we scale to hundreds of providers.

## Target Architecture

We are shifting to an **Enterprise Schema-Driven Architecture** (similar to advanced iPaaS solutions like Activepieces or Tray.io).

### Principles

1. **Dumb Engine**: The core execution engine (`connectors.service.ts`) must know *nothing* about specific providers. It purely executes data structures.
2. **Smart Provider Definitions**: Provider configurations (the "pieces" or "adapters") define exactly what environments they support and supply the specific endpoints.
3. **Dynamic Frontend UI**: The React UI should never check `if (provider === 'salesforce')`. Instead, it reads the provider schema (`environments: []`) and renders a dropdown automatically if multiple environments are present.

## Data Model Changes

### 1. Provider Definition Schema (`packages/connections/src/connectivity/types.ts`)

We will expand the `OAuth2Provider` interface to support an optional array of environments.

```typescript
export interface ProviderEnvironment {
    /** Internal programmatic identifier (e.g., 'production', 'sandbox') */
    name: string;
    /** User-facing label (e.g., 'Production (login.salesforce.com)') */
    displayName: string;
    authorizeUrl: string;
    tokenUrl: string;
}

export interface OAuth2Provider extends BaseProviderDefinition {
    authType: 'OAUTH2';
    /** Optional explicit environments. If provided, authorizeUrl/tokenUrl at the root level become fallbacks. */
    environments?: ProviderEnvironment[];
    /** Default or Fallback OAuth2 Authorization endpoint */
    authorizeUrl: string;
    /** Default or Fallback OAuth2 Token exchange endpoint */
    tokenUrl: string;
    scopes: string[];
}
```

### 2. Salesforce Provider Payload (`packages/connections/src/connectivity/providers/salesforce.provider.ts`)

We will replace the hardcoded URLs with an `environments` array:

```typescript
export const salesforceProvider: ProviderDefinition = {
    name: 'salesforce',
    // ...
    authType: 'OAUTH2',
    environments: [
        {
            name: 'production',
            displayName: 'Production (login.salesforce.com)',
            authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
            tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
        },
        {
            name: 'sandbox',
            displayName: 'Sandbox (test.salesforce.com)',
            authorizeUrl: 'https://test.salesforce.com/services/oauth2/authorize',
            tokenUrl: 'https://test.salesforce.com/services/oauth2/token',
        }
    ],
    // Provide root fallbacks just in case
    authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
    tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
    scopes: ['refresh_token', 'full', 'api'],
};
```

## Execution Flow Refactoring

### 1. `ConnectorsService.getAuthorizationUrl` and `exchangeCodeForTokens`

Remove the hardcoded `if (providerName === 'salesforce')` checks. Instead, implement schema-driven lookup:

```typescript
// 1. Locate the requested environment in the provider schema
const environmentConfig = provider.environments?.find(e => e.name === requestedEnv);

// 2. Fallback to root URLs if the environment config doesn't exist
const authorizeUrl = environmentConfig?.authorizeUrl ?? provider.authorizeUrl;
const tokenUrl = environmentConfig?.tokenUrl ?? provider.tokenUrl;
```

### 2. Frontend Connection API Schema (`apps/web/src/modules/connections/api/connections.api.ts`)

The `ProviderResponse` interface needs to expose the new `environments` Array so the UI can draw it.

### 3. Frontend React Component (`ConnectAppCard.tsx`)

The React form must be updated to dynamically render the `<Select>` dropdown *only* if `provider.environments` exists and has a length greater than 0. The `<SelectItem>` elements will be dynamically mapped from `provider.environments.map(...)`.

## Estimated File Changes required to implement this architecture

1. **`packages/connections/src/connectivity/types.ts`** (~15 lines added) - Add the `ProviderEnvironment` type and update `OAuth2Provider`.
2. **`packages/connections/src/connectivity/providers/salesforce.provider.ts`** (~10 lines added) - Add the actual production vs sandbox URLs array.
3. **`apps/web/src/modules/connections/api/connections.api.ts`** (~2 lines modified) - Expose the `environments` array on `ProviderResponse`.
4. **`apps/api/src/modules/connections/connectors.service.ts`** (~10 lines modified) - Remove hardcoded salesforce logic and use the new schema lookup.
5. **`apps/web/src/modules/connections/components/ConnectAppCard.tsx`** (~20 lines modified) - Remove hardcoded salesforce logic and replace with highly dynamic array mapping for the dropdown.
6. **`apps/api/src/modules/connections/connectors.service.spec.ts`** (~30 lines modified) - Provide mocked `environments` array to the `ProviderRegistry` and test the lookup logic.

**Total scope:** Roughly 6 files modified, ~90 lines of code changed. Very low impact, highly contained, and drastically improves structural integrity.
