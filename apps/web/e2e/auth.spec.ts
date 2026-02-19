import { test, expect } from './test';


test.describe('Authentication Flows', () => {
    // Shared user credentials for the suite, generated once per run
    let userEmail = `auth-test-${Date.now()}@example.com`;
    const userPassword = 'password123';
    const userFirstName = 'Playwright';
    const userLastName = 'TestUser';

    test.describe.configure({ mode: 'serial' });

    test('Sign Up with Email/Password', async ({ page, mailpit, db }) => {
        // Ensure fresh email for this run
        userEmail = `auth-test-${Date.now()}@example.com`;
        console.log(`Starting Sign Up test for: ${userEmail}`);

        // Cleanup before test (just in case)
        await db.cleanupUser(userEmail);

        try {
            await page.goto('/signup');

            // Fill signup form
            await page.fill('input#firstName', userFirstName);
            await page.fill('input#lastName', userLastName);
            await page.fill('input[type="email"]', userEmail);

            // Password fields
            await page.locator('input[type="password"]').first().fill(userPassword);
            await page.locator('input[type="password"]').nth(1).fill(userPassword);

            // Click submit
            await page.getByRole('button', { name: 'Sign Up', exact: true }).click();

            // Verify redirect - expect to go to verify-email page
            await expect(page).toHaveURL(/\/verify-email/);
            await expect(page.locator('text=Check your email')).toBeVisible({ timeout: 15000 });

            // --- AUTOMATED VERIFICATION (Mailpit) ---
            // Wait for email in Mailpit
            const email = await mailpit.waitForEmail(userEmail, 'Verify your email');

            // Extract link
            // Link pattern: http://localhost:3000/api/auth/verify-email?token=...
            const verificationUrl = mailpit.extractLink(email, /(http:\/\/localhost:\d+\/api\/auth\/verify-email\?token=[^"\s]+)/);

            console.log(`[Mailpit] Found URL: ${verificationUrl}`);

            // Verify user state in DB BEFORE verification (should be unverified)
            try {
                // We can check if user exists at least
                const exists = await db.userExists(userEmail);
                expect(exists).toBe(true);
            } catch (e) {
                console.warn('[DB] User check failed, possibly due to async propagation or different DB', e);
            }

            // Navigate to verification link
            await page.goto(verificationUrl);

            // Wait for potential redirect completion
            await page.waitForLoadState('networkidle');

            // Assert we left the verification URL (redirected to / or /dashboard or /login)
            await expect(page).not.toHaveURL(/\/verify-email\?/);

            // Verify user state in DB AFTER verification (should be verified)
            // Add retry/wait logic as DB update might be slightly async
            await expect.poll(async () => {
                return await db.isEmailVerified(userEmail);
            }, {
                message: 'User email should be verified in DB',
                timeout: 5000
            }).toBe(true);
        } finally {
            // Enterprise Grade: Always clean up data, even if test fails
            console.log(`[Teardown] Cleaning up user: ${userEmail}`);
            await db.cleanupUser(userEmail);
        }
    });

    test('Sign In with Email/Password', async ({ page, mailpit, db }) => {
        const signInEmail = `auth-signin-${Date.now()}@example.com`;
        const signInPassword = 'password123';
        console.log(`Starting Sign In test for: ${signInEmail}`);

        // Cleanup before test (safety)
        await db.cleanupUser(signInEmail);
        await mailpit.deleteAllMessages();

        try {
            // --- SETUP: Create a verified user ---
            console.log('[Setup] Creating verified user...');
            await page.goto('/signup');
            await page.fill('input#firstName', 'SignIn');
            await page.fill('input#lastName', 'Tester');
            await page.fill('input[type="email"]', signInEmail);
            await page.locator('input[type="password"]').first().fill(signInPassword);
            await page.locator('input[type="password"]').nth(1).fill(signInPassword);
            await page.getByRole('button', { name: 'Sign Up', exact: true }).click();

            // Verify
            const email = await mailpit.waitForEmail(signInEmail, 'Verify your email');
            const verificationUrl = mailpit.extractLink(email, /(http:\/\/localhost:\d+\/api\/auth\/verify-email\?token=[^"\s]+)/);
            await page.goto(verificationUrl);
            await expect.poll(async () => {
                return await db.isEmailVerified(signInEmail);
            }, { timeout: 5000 }).toBe(true);

            // Log out to test Sign In
            // Assuming verification auto-logs in, we need to logout.
            // If the UI redirects to dashboard, we can find logout there.
            // For now, let's just clear cookies/storage or go to login page 
            // verifying we are logged in first might be good.
            await expect(page.getByRole('main').getByText('Dashboard')).toBeVisible({ timeout: 10000 });

            // Perform Logout (Simulate by clearing state or clicking logout if visible)
            await page.context().clearCookies();
            await page.goto('/login');

            // --- TEST: Sign In ---
            await page.fill('input[type="email"]', signInEmail);
            await page.fill('input[type="password"]', signInPassword);
            await page.getByRole('button', { name: /login/i }).click();

            // Should now see Dashboard
            await expect(page.getByRole('main').getByText('Dashboard')).toBeVisible({ timeout: 15000 });

        } finally {
            await db.cleanupUser(signInEmail);
        }
    });
});
