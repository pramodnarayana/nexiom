# Frontend Popup-Based OAuth Strategy

## Objective

To provide a seamless, enterprise-grade user experience when connecting third-party apps, Nexiom will implement a popup-based OAuth authorization flow on the frontend. This strategy heavily borrows from the tried-and-true UX found in integration platforms like Activepieces.

## Why a Popup?

When a user decides to connect an application like Salesforce, redirecting the *entire* browser window away to the vendor's login screen destroys the user's current context.
If they were in the middle of configuring a complex flow or filling out form fields, a hard redirect and subsequent return would wipe their state.

By executing the OAuth flow inside a dedicated popup window (`window.open`):

1. **Context Preservation:** The user's main application window remains untouched and in its original state.
2. **Session Stitching is Unnecessary:** We no longer need to implement server-side logic (e.g., `redirectTo` cookies) to remember where the user was before they clicked "Connect". They never left.
3. **Cleaner UX:** The popup naturally focuses the user on the authentication task and instantly closes upon completion.

## The Authorized Handshake Flow (End-to-End)

1. **Initiation (Main Window):**
   * The user clicks the "Connect" button on an app card in the Nexiom Marketplace UI.
   * The React application uses a utility to construct the backend authentication URL (e.g., `https://api.nexiom.com/connect/salesforce?tenantId=abc`).
   * The React application calls `window.open(url, '_blank', 'resizable=no,width=600,height=800')`.
   * A popup window launches, and the main React window sets up a `window.addEventListener('message', ...)` listener to wait for the tokens to return.

2. **Backend Kickoff (Popup Window):**
   * The popup window hits the `ConnectorsController` (`/connect/:provider`).
   * The backend dynamically generates the vendor's required scopes and authorization URLs using the `ProviderRegistryService`.
   * The backend generates a secure stateless JWT containing the `tenantId` to use as the OAuth `state` parameter.
   * The backend redirects the popup window directly to the vendor's login page (e.g., Salesforce Login).

3. **Vendor Authentication (Popup Window):**
   * The user logs in and grants permissions to Nexiom within the vendor's UI in the popup window.
   * The vendor redirects the popup window back to the Nexiom callback URL (`https://api.nexiom.com/connect/:provider/callback`).

4. **Token Exchange & Storage (Popup Window):**
   * The Nexiom `OAuthCallbackController` intercepts the callback in the popup.
   * It extracts the authorization `code` and verifies the stateless JWT `state` to ensure the session hasn't been tampered with and the correct `tenantId` is applied.
   * The backend exchanges the `code` for an `access_token` and `refresh_token`.
   * The credentials are encrypted and stored in the `app_connection` database table.

5. **Completion & Hand-off (Popup Window to Main Window):**
   * The `OAuthCallbackController` responds with a success status. Instead of a standard JSON response or a hard redirect to a dashboard URL, it returns a small, self-executing HTML page.
   * This HTML page does exactly two things:
     1. Uses `window.opener.postMessage({ status: 'success', provider: 'salesforce' }, '*')` to broadcast the success state back to the main React application window that is waiting.
     2. Calls `window.close()` to destroy the popup.
   * The main React window receives the `message` event, toasts a success notification, and refreshes the connection UI to show "Active" without ever having to reload the page.
