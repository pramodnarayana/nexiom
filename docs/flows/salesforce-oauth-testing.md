# Testing the Salesforce BYOA OAuth Flow

This document outlines the end-to-end testing procedure for the Bring Your Own App (BYOA) OAuth flow, specifically using Salesforce as an example provider.

## Prerequisites

1. **Start the Local Environment**: Run `pnpm dev` at the root of the monorepo to start both the `web` frontend (typically `localhost:5173`) and the `api` backend (typically `localhost:3000`).
2. **Ensure Infrastructure is Running**: Verify that Redis and PostgreSQL are active and accessible.
3. **Seed the Database**: If this is a fresh database, ensure Salesforce is registered as a viable connector provider. Run the bootstrap command (e.g., `pnpm admin:seed` or executing `admin-bootstrap.ts`) to populate the `provider` table.
4. **Create Salesforce Connected App**: You will need to create a Connected App in your Salesforce developer account.
    * Ensure **Enable OAuth Settings** is checked.
    * Set the **Callback URL** to your backend's external API callback endpoint. For local development, this is typically `http://localhost:3000/api/connect/callback` (assuming your backend runs on port 3000). If you are using a tunneling service like ngrok, use your ngrok HTTPS URL (e.g., `https://<your-ngrok-id>.ngrok-free.app/api/connect/callback`).
    * Add the required OAuth Scopes (typically `Manage user data via APIs (api)` and `Perform requests on your behalf at any time (refresh_token, offline_access)`).

## E2E Testing Steps

### 1. Initiate the Connection

1. Navigate to the frontend web application and sign in or sign up to a tenant workspace.
2. Go to the `/marketplace` route (or the designated `ConnectionsPage`).
3. Locate the **Salesforce** `ConnectAppCard`.
4. Click the **Connect** button on the card. This will open the BYOA credential modal.

### 2. Provide BYOA Credentials

1. In the modal form, enter your specific Salesforce Connected App credentials:
    * **Client ID**
    * **Client Secret**
    * *(Optional depending on provider configuration)* Application/App ID.
2. Click **Submit** within the modal.

### 3. Handle the External OAuth Popup

1. Upon submitting the BYOA form, the frontend will trigger a `window.open` popup navigating to the external Salesforce login authorize screen. The URL will dynamically inject the `client_id` you provided.
2. Log in with your Salesforce credentials within the popup and authorize the Nexiom application.
3. Once authorized, Salesforce will redirect the popup back to the backend `OAuthCallbackController` (`/api/connect/callback...`).
4. The backend controller validates the state parameter and returns a self-closing HTML page.
5. This HTML page executes `window.opener.postMessage(...)` to send the authorization `code` directly to your main frontend window, and then automatically calls `window.close()`.

### 4. Code Exchange and Persistence

1. The main frontend window's event listener intercepts the `postMessage` event.
2. The modal automatically closes.
3. The frontend issues a subsequent `POST` request to `/api/connectors/oauth-exchange`.
4. This POST payload carries the `clientId`, `clientSecret`, and the newly extracted `code`.
5. The backend `ConnectorsService`:
    * Exchanges the code securely for permanent access and refresh tokens at the vendor.
    * Encrypts the tokens, `clientId`, and `clientSecret` using the system encryption service.
    * Upserts the persistent records into the `app_credential` and `app_connection` database tables.

### 5. Verify Success State

1. **Frontend State**: You should observe a success toast notification indicating the connector is active. The Salesforce card should now visibly show as "Connected" or "Active" on the Marketplace.
2. **Database Verification**: Cross-verify the successful exchange by checking your database (e.g., via Drizzle Studio or `psql`). Look for a new row in the `app_connection` table associated with your `tenantId` and `appName = 'salesforce'` with `status = 'ACTIVE'`.
