# Task 03a: Password Recovery (Architecture Layout)

**Goal:** Implement a secure "Forgot Password" flow for Email Authentication users.

## 1. High-Level Design (Buy/Extend Strategy)

We will utilize the built-in `emailAndPassword` module of `better-auth`.

* **Token Storage:** The existing `verification` table will be used by Better-Auth to store short-lived reset tokens.
* **Email Delivery:** The `BetterAuthAdapter` hook (`sendResetPassword`) will interface with our existing `NodemailerService`.

## 2. API Contract (Frontend <-> Better-Auth)

The Coder should verify these endpoints are exposed by the Better-Auth client:

### 2.1 Request Reset

* **Endpoint:** `POST /api/auth/forget-password`
* **Body:** `{ email: string }`
* **Response:** `200 OK` (Always 200 to prevent user enumeration).

### 2.2 Reset Password

* **Endpoint:** `POST /api/auth/reset-password`
* **Body:** `{ password: string, token: string }`
* **Response:** `200 OK` + `Set-Cookie` (Auto-login user).

## 3. Implementation Spec (For Coder)

### 3.1 Backend (`packages/identity`)

* **Adapter Config:**  In `src/adapters/better-auth.adapter.ts`, configure the `emailAndPassword` object.
* **Callback:** Implement `sendResetPassword`. It **MUST** call `this.emailService.sendEmail()`.
* **URL Generation:** Construct the link as `${frontendUrl}/reset-password?token=${token}`.

### 3.2 Frontend (`apps/web`)

* **Pages:** Create two new public pages.
    1. `ForgotPasswordPage`: Simple form -> calls `authClient.forgetPassword`.
    2. `ResetPasswordPage`: Simple form -> calls `authClient.resetPassword`.
* **Routing:** Add these to `App.tsx` (ensure they are accessible *without* login).
