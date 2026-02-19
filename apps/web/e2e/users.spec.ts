import { test, expect } from './test';
import { createVerifiedUser } from './helpers/auth-setup';

test.describe('User Management', () => {
    test.describe.configure({ mode: 'serial' });

    let adminEmail: string;

    // Helper to sign up and login before tests
    test.beforeEach(async ({ page, mailpit, db }) => {
        // Targeted cleanup for previous runs if any (best effort)
        // We rely on unique emails mostly.

        const user = await createVerifiedUser(page, mailpit, db, {
            role: 'system',
            emailPrefix: 'user-admin'
        });
        adminEmail = user.email;
    });

    test.afterEach(async ({ db }) => {
        if (adminEmail) {
            console.log(`[Teardown] Cleaning up user: ${adminEmail}`);
            await db.cleanupUser(adminEmail);
        }
    });

    test('Invite User Flow', async ({ page, mailpit, db }) => {
        const inviteeEmail = `invitee-${Date.now()}@example.com`;

        // Cleanup invitee if exists (Safety)
        await db.cleanupUser(inviteeEmail);

        try {
            // Navigate to Users list (System Admin view)
            await page.goto('/admin/users');

            // Look for Invite button
            const inviteBtn = page.getByRole('button', { name: /invite user/i });
            await expect(inviteBtn).toBeVisible();
            await inviteBtn.click();

            // Fill invite form
            await page.getByLabel('Email').fill(inviteeEmail);

            // Send
            await page.getByRole('button', { name: /send invitation/i }).click();

            // Check for success toast - Use exact match to avoid duplicates
            await expect(page.getByText('Invitation sent', { exact: false }).first()).toBeVisible();

            // --- Verify Invitation Email ---
            const inviteEmailObj = await mailpit.waitForEmail(inviteeEmail, 'You have been invited to join an organization');
            expect(inviteEmailObj).toBeDefined();

            // Extract join link
            const inviteLink = mailpit.extractLink(inviteEmailObj, /(http:\/\/localhost:\d+\/invite\/[^"\s]+)/);
            expect(inviteLink).toBeTruthy();

            // Visit the invite link and verify UI
            // Ensure we are logged out to see the public invite page (Signup flow)
            await page.context().clearCookies();
            await page.evaluate(() => localStorage.clear());
            await page.goto(inviteLink);

            // Assert we are on the invite acceptance page (which redirects to Signup with 'Join Organization')
            await expect(page.getByText('Join Organization')).toBeVisible();
        } finally {
            await db.cleanupUser(inviteeEmail);
        }
    });
});
