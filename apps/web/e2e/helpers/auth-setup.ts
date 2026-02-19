import { type Page, expect } from '@playwright/test';
import { type MailpitFixture } from '../fixtures/mailpit';
import { type DbFixture } from '../fixtures/db';

export interface AuthSetupOptions {
    role?: 'user' | 'system';
    emailPrefix?: string;
}

export interface AuthUser {
    email: string;
    password: string;
}

/**
 * Creates a verified user (and optionally promotes to System Admin),
 * then logs them in.
 */
export async function createVerifiedUser(
    page: Page,
    mailpit: MailpitFixture,
    db: DbFixture,
    options: AuthSetupOptions = {}
): Promise<AuthUser> {
    const emailPrefix = options.emailPrefix || 'test-user';
    const email = `${emailPrefix}-${Date.now()}@example.com`;
    const password = 'password123';
    const role = options.role || 'user';

    console.log(`[AuthHelper] Creating verified user: ${email} (Role: ${role})`);

    // Safety cleanup
    await db.cleanupUser(email);

    // 1. Sign Up
    await page.goto('/signup');
    await page.fill('input#firstName', 'Test');
    await page.fill('input#lastName', 'User');
    await page.fill('input[type="email"]', email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.locator('input[type="password"]').nth(1).fill(password);
    await page.getByRole('button', { name: 'Sign Up', exact: true }).click();

    // Wait for redirection
    await expect(page).toHaveURL(/verify-email/);

    // 2. Promote if needed (BEFORE verification/login to ensure permissions are ready if needed)
    if (role === 'system') {
        await db.makeSystemAdmin(email);
    }

    // 3. Verify Email
    // Note: We do NOT delete all messages here. We filter by recipient.
    const emailMsg = await mailpit.waitForEmail(email, 'Verify your email');

    // Dynamically derive host from env or default to localhost
    // This supports CI/Docker where the URL might be different
    const authUrl = process.env.BETTER_AUTH_URL || 'http://localhost:3002/api/auth';
    // Create a regex that matches the full auth URL pattern.
    // We escape special characters for regex safety
    const cleanAuthUrl = authUrl.replace(/\/$/, '');
    const escapedAuthUrl = cleanAuthUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const verificationUrl = mailpit.extractLink(emailMsg, new RegExp(`(${escapedAuthUrl}\\/verify-email\\?token=[^"\\s]+)`));

    // Visit verification link
    await page.goto(verificationUrl);

    // 4. Force unique login session
    // Clear cookies to ensure we test the login flow cleanly and get the right role session
    await page.context().clearCookies();

    await page.goto('/login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.getByRole('button', { name: /login/i }).click();

    // Verify Dashboard access
    await expect(page.getByText('Dashboard').first()).toBeVisible({ timeout: 20000 });

    console.log(`[AuthHelper] User ${email} logged in successfully.`);

    return { email, password };
}
