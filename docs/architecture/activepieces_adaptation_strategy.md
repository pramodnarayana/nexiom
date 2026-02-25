# Activepieces Integration Reuse Strategy

## Objective

To massively accelerate the development of Goal 2 (Integration Execution Engine) and support 500+ apps, Nexiom will aggressively reuse the open-source integration scripts ("Pieces") developed by the Activepieces community.

## Activepieces Model Deep-Dive

After cloning and examining the `activepieces/packages/pieces` repository, the integrations are heavily modularized.

1. **Folder Structure**: Every app is isolated into a directory (e.g., `salesforce`).
2. **`index.ts` Entrypoint**: The main export is constructed using a `createPiece({ ... })` wrapper. This file defines the `PieceAuth.OAuth2` or `PieceAuth.Basic` block (defining scopes, token URLs, and properties) and an array of `actions` and `triggers`.
3. **Actions Structure**: Actions like `create-contact.ts` use a `createAction({ ... })` wrapper.
    * Inputs are declaratively defined in the `props:` object using `Property.ShortText`, `Property.Json`, etc.
    * Execution logic is housed in an async `run(context)` function.
    * HTTP calls use a generic `httpClient.sendRequest()` utility provided by `@activepieces/pieces-common`.

## The Nexiom Compatibility Layer

To leverage these thousands of open-source actions without having to rewrite or maintain custom fetch logic for each vendor, we will implement a "Compatibility Layer" inside `@nexiom/connections`.

We do **not** need to run the entire Activepieces Node.js engine. We only need their TypeScript structures.

### The Shim Architecture

If Nexiom exposes a library that exports `createPiece`, `createAction`, `PieceAuth`, and `Property` with the **exact same TypeScript type signatures** as `@activepieces/pieces-framework`, we can safely copy-paste open-source integration files into `nexiom/integrations/`.

### The Nexiom Http Client

The single most powerful override will be replacing their `httpClient`.
When a copied Activepieces action calls `await httpClient.sendRequest()`, our patched import will intercept it.
Instead of trusting the action to handle tokens itself, our `NexiomHttpClient` will:

1. Pause execution.
2. Call `TokenManagerService.getValidCredentials(connectionId)` to obtain a guaranteed unexpired, un-revoked OAuth token.
3. Automatically append the `Authorization: Bearer <token>` header to the request.
4. Execute the fetch against the vendor API safely.

### Benefits

* **Sandboxed Credentials:** The open-source `run(context)` function never sees the raw, decrypted OAuth tokens.
* **Instant Scalability:** We instantly gain access to hundreds of CRM, Marketing, and Accounting workflows.
* **Zero Boilerplate:** We avoid writing bespoke validation schemas or HTTP wrappers for every single API endpoint in 500+ APIs.
