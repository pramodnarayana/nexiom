# Site Usage & User Flows (Standard B2B SaaS)

This document outlines the standard user flows and test cases for **Identity, Tenant Management, and User Management**. It serves as a baseline for acceptance testing.

---

## 1. Authentication Flows

### 1.1 Login Page (`/login`)

**Goal:** Authenticate the user and redirect to the application.

| Test Case ID | User Action | Inputs | Expected Outcome |
| :--- | :--- | :--- | :--- |
| **AUTH-01** | **Sign In (Google)** | Click "Continue with Google" | Redirect to Google OAuth -> Success -> Redirect to Dashboard. |
| **AUTH-02** | **Sign In (Email)** | Valid Email & Password | Auth successful -> Redirect to Dashboard. |
| **AUTH-03** | **Show/Hide Password** | Click Eye Icon | Password field toggles between masked (`******`) and visible text. |
| **AUTH-04** | **Sign In (Invalid)** | Invalid Credentials | Show error: "Invalid email or password". |
| **AUTH-05** | **Forgot Password** | Click "Forgot Password?" | Redirect to `/forgot-password`. |
| **AUTH-06** | **Navigation** | Click "Sign Up" | Redirect to `/signup`. |

### 1.2 Signup Page (`/signup`)

**Goal:** Register a new user account.

| Test Case ID | User Action | Inputs | Expected Outcome |
| :--- | :--- | :--- | :--- |
| **REG-01** | **Sign Up (Google)** | Click "Continue with Google" | Account created (if new) -> Redirect to Onboarding/Dashboard. |
| **REG-02** | **Sign Up (Email)** | Name, Email, Password, **Confirm Password** | Account created -> **Trigger Email Verification** -> Redirect to Dashboard. |
| **REG-03** | **Password Mismatch** | Password != Confirm Password | Show error: "Passwords do not match". |
| **REG-04** | **Existing Account** | Email already registered | Show error: "User already exists". |
| **REG-05** | **Weak Password** | Short/Simple password | Show validation error (min 8 chars, mixed case, etc). |

### 1.3 Password Recovery (`/forgot-password`)

**Goal:** Allow users to regain access if credentials are lost.

| Test Case ID | User Action | Inputs | Expected Outcome |
| :--- | :--- | :--- | :--- |
| **REC-01** | **Request Reset** | Enter Registered Email | System sends email with link. UI shows: "If an account exists, email sent." |
| **REC-02** | **Reset Password** | Click Email Link -> Enter New Password | Password updated -> User logged in automatically (or asked to login). |
| **REC-03** | **Invalid Token** | Click Expired/Used Link | Show error: "Invalid or expired link". |

---

## 2. Tenant Management Flows (Organization)

### 2.1 Onboarding / Create Tenant

**Goal:** A user establishes a new workspace (Organization).

| Test Case ID | User Action | Inputs | Expected Outcome |
| :--- | :--- | :--- | :--- |
| **ORG-01** | **Create Tenant** | Tenant Name (Slug is auto-generated/hidden) | Tenant created -> User assigned as **Owner** -> Redirect to Tenant Dashboard. |
| **ORG-02** | **Duplicate Name** | Existing Name/Slug collision | Show error: "Organization name already taken". |

### 2.2 Tenant Settings

**Goal:** Admin manages organization details.

| Test Case ID | User Action | Inputs | Expected Outcome |
| :--- | :--- | :--- | :--- |
| **ORG-03** | **Update Profile** | New Name / Logo | Organization details updated globally. |
| **ORG-04** | **Delete Tenant** | Click "Delete" + Confirmation | Tenant soft-deleted -> User redirected to another tenant or home. |

---

## 3. Team Management Flows

### 3.1 Invite Members

**Goal:** Add colleagues to the organization.

| Test Case ID | User Action | Inputs | Expected Outcome |
| :--- | :--- | :--- | :--- |
| **TEAM-01** | **Invite User** | Email, Role (Admin/Member) | Invitation created -> Email sent to target. Status: "Pending". |
| **TEAM-02** | **Resend Invite** | Click "Resend" on Pending | New email sent. |
| **TEAM-03** | **Revoke Invite** | Click "Revoke/Delete" | Invitation deleted -> Link becomes invalid. |

### 3.2 Accept Invitation

**Goal:** Join an organization via invite.

| Test Case ID | User Action | Inputs | Expected Outcome |
| :--- | :--- | :--- | :--- |
| **TEAM-04** | **Accept (New User)** | Click Email Link -> Sign Up | Account created -> Automatically added to Tenant -> Redirect to Tenant Dashboard. |
| **TEAM-05** | **Accept (Existing)** | Click Email Link -> Login | Added to Tenant -> Redirect to Tenant Dashboard. |

### 3.3 Manage Members

**Goal:** Control access within the organization.

| Test Case ID | User Action | Inputs | Expected Outcome |
| :--- | :--- | :--- | :--- |
| **TEAM-06** | **Change Role** | Select User -> New Role | Permission updated immediately. |
| **TEAM-07** | **Remove User** | Click "Remove Member" | User access revoked for *this* tenant only. |

---

## 4. User Profile Flows

### 4.1 Profile Settings

**Goal:** Manage personal account details.

| Test Case ID | User Action | Inputs | Expected Outcome |
| :--- | :--- | :--- | :--- |
| **USR-01** | **Update Info** | Name, Avatar | User details updated across all tenants. |
| **USR-02** | **Change Password** | Old Pass, New Pass | Password updated. |
| **USR-03** | **Enable MFA** | Scan QR Code -> Enter Code | MFA Enabled. Next login requires code. |

---

## 5. Security & Access Control

| Test Case ID | User Action | Inputs | Expected Outcome |
| :--- | :--- | :--- | :--- |
| **SEC-01** | **Protected Route** | Access URL without Login | Redirect to `/login`. |
| **SEC-02** | **Role Guard** | Member tries Admin Route | Show "403 Unauthorized" or hide navigation item. |
| **SEC-03** | **Session Expiry** | Wait for token expiry | Action fails -> Redirect to `/login`. |
