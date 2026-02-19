import { test, expect } from './test';

test.describe('User Management', () => {
    let adminEmail: string;

    // Helper to sign up and login before tests
    test.beforeEach(async ({ page, mailpit, db }) => {
        // Ensure unique email
        await new Promise(resolve => setTimeout(resolve, 100)); // Delay for unique timestamp
        adminEmail = `user-admin-${Date.now()}@test.com`;
        const adminPassword = 'password123';

        console.log(`[Setup] Creating verified admin for users test: ${adminEmail}`);

        // Cleanup (Safety)
        await db.cleanupUser(adminEmail);
        await mailpit.deleteAllMessages();

        // 1. Sign Up
        await page.goto('/signup');
        await page.fill('input#firstName', 'User');
        await page.fill('input#lastName', 'Admin');
        await page.fill('input[type="email"]', adminEmail);
        await page.locator('input[type="password"]').first().fill(adminPassword);
        await page.locator('input[type="password"]').nth(1).fill(adminPassword);
        await page.getByRole('button', { name: 'Sign Up', exact: true }).click();

        // Wait for redirection
        await expect(page).toHaveURL(/verify-email/);

        // 2. Promote to System Admin (to access User Management)
        await db.makeSystemAdmin(adminEmail);

        // 3. Verify Email
        const email = await mailpit.waitForEmail(adminEmail, 'Verify your email');
        const verificationUrl = mailpit.extractLink(email, /(http:\/\/localhost:\d+\/api\/auth\/verify-email\?token=[^"\s]+)/);
        await page.goto(verificationUrl);

        // 4. Force Re-login for Permissions
        console.log('[Setup] clearing cookies to force fresh login...');
        await page.context().clearCookies();

        await page.goto('/login');
        await page.fill('input[type="email"]', adminEmail);
        await page.fill('input[type="password"]', adminPassword);
        await page.getByRole('button', { name: /login/i }).click();

        // Wait for dashboard
        await expect(page.getByText('Dashboard').first()).toBeVisible({ timeout: 20000 });
    });

    test.afterEach(async ({ db }) => {
        if (adminEmail) {
            console.log(`[Teardown] Cleaning up user: ${adminEmail}`);
            await db.cleanupUser(adminEmail);
        }
    });

    test.describe.configure({ mode: 'serial' });

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
        } finally {
            await db.cleanupUser(inviteeEmail);
        }
    });
});
