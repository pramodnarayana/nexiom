# User Invitation Flow & Usability Design

This document outlines the standard usability flow for processing user invitations in a multi-tenant SaaS application. It is designed to minimize friction and ensure users land in the correct context.

## Core Principle: "Context Persistence"
When a user clicks an invitation link, the *intent* (joining an organization) must be preserved throughout the authentication process (Sign Up or Log In).

## Scenario 1: The New User (No Account)
*User B does not exist in Nexiom yet.*

1.  **Email Receipt**: User B receives an email: *"Alice has invited you to join **Acme Corp** on Nexiom."*
2.  **Click Action**: User B clicks the "Join Acme Corp" button.
3.  **Landing Page**:
    *   System detects User B has no session / is not logged in.
    *   System displays a **Welcome / Accept Invite** screen.
    *   *Copy*: "You have been invited to join Acme Corp. Create an account to accept."
4.  **Sign Up (The "Set Password" Step)**:
    *   User B clicks "Create Account".
    *   **The Form**:
        *   **Email**: Pre-filled as `b@example.com` (Read-only/Locked for security).
        *   **Name**: Input required.
        *   **Password**: Input required (User sets their password here).
        *   **Company Name**: **HIDDEN/SKIPPED**. (They are joining *Acme Corp*, not creating a new one).
5.  **Completion (Auto-Accept)**:
    *   User B submits the form.
    *   System creates the User Account.
    *   **System AUTOMATICALLY accepts the invitation.** (No extra click required).
    *   User B is redirected immediately to the **Acme Corp Dashboard**.

## Scenario 2: The Existing User
*User B already has a Nexiom account.*

1.  **Email Receipt**: User B receives an email.
2.  **Click Action**: User B clicks the link.
3.  **Authentication Check**:
    *   **If Logged In**: System **Automatically Accepts** -> Redirects to Dashboard.
    *   **If Logged Out**:
        *   System redirects to **Login Page**.
        *   User enters Email/Password.
        *   System redirects user back.
        *   System **Automatically Accepts** -> Redirects to Dashboard.

## Technical Requirements (To support this usability)
1.  **Smart Redirection**: The Login/Signup pages must support a `?to=` or `?redirect=` parameter to remember the user came from an invite.
2.  **"Join" Mode for Signup**: The Signup form must be smart enough to hide "Company Name" when a user is just joining an existing one.
