import { test, expect } from './test';
import { createVerifiedUser } from './helpers/auth-setup';


test.describe('Authentication Flows', () => {
    test.describe.configure({ mode: 'serial' });

    test('Sign Up with Email/Password', async ({ page, mailpit, db }) => {
        // Ensure fresh email for this run
        const userEmail = `auth-test-${Date.now()}@example.com`;
        const userPassword = 'password123';
        const userFirstName = 'Playwright';
        const userLastName = 'TestUser';

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

            // Extract link - dynamically derive host to support CI/Docker
            const authUrl = process.env.BETTER_AUTH_URL || 'http://localhost:3002/api/auth';
            const cleanAuthUrl = authUrl.replace(/\/$/, '');
            const escapedAuthUrl = cleanAuthUrl.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const verificationUrl = mailpit.extractLink(email, new RegExp(`(${escapedAuthUrl}\\/verify-email\\?token=[^"\\s]+)`));

            console.log(`[Mailpit] Found URL: ${verificationUrl}`);

            // Verify user state in DB BEFORE verification (should be unverified)
            const exists = await db.userExists(userEmail);
            expect(exists).toBe(true);
            const verifiedBefore = await db.isEmailVerified(userEmail);
            expect(verifiedBefore).toBe(false);

            // Navigate to verification link
            await page.goto(verificationUrl);

            // Assert we were redirected away from the verification URL
            await expect(page).not.toHaveURL(/\/verify-email\?/, { timeout: 10000 });

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
        let authUser: { email: string; password: string } | undefined;

        try {
            // --- SETUP: Create a verified user ---
            console.log('[Setup] Creating verified user...');

            // Use helper to create and verify user
            // This helper also handles logging them in initially
            authUser = await createVerifiedUser(page, mailpit, db, {
                emailPrefix: 'auth-signin'
            });

            console.log(`Starting Sign In test for: ${authUser.email}`);

            // The helper leaves the user logged in. We need to log out to test explicit Sign In.
            await page.context().clearCookies();
            await page.goto('/login');

            // --- TEST: Sign In ---
            await page.fill('input[type="email"]', authUser.email);
            // Re-type the password (helper returns it)
            await page.fill('input[type="password"]', authUser.password);
            await page.getByRole('button', { name: /login/i }).click();

            // Should now see Dashboard
            await expect(page.getByRole('main').getByText('Dashboard')).toBeVisible({ timeout: 15000 });

        } finally {
            if (authUser?.email) {
                await db.cleanupUser(authUser.email);
            }
        }
    });
});
