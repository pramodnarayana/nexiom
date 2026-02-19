import { test, expect } from './test';

test.describe('Tenant Management', () => {
    let userEmail: string;

    // Helper to sign up and login before tests
    test.beforeEach(async ({ page, mailpit, db }) => {
        // Ensure unique email by adding random component and delay
        await new Promise(resolve => setTimeout(resolve, 100));
        userEmail = `tenant-admin-${Date.now()}@test.com`;
        const userPassword = 'password123';

        console.log(`[Setup] Creating verified user for tenant test: ${userEmail}`);

        // Cleanup (Safety)
        await db.cleanupUser(userEmail);
        await mailpit.deleteAllMessages();

        // 1. Sign Up
        await page.goto('/signup');
        await page.fill('input#firstName', 'Tenant');
        await page.fill('input#lastName', 'Admin');
        await page.fill('input[type="email"]', userEmail);
        await page.locator('input[type="password"]').first().fill(userPassword);
        await page.locator('input[type="password"]').nth(1).fill(userPassword);
        await page.getByRole('button', { name: 'Sign Up', exact: true }).click();

        // Wait for redirection to ensure user is created in DB
        await expect(page).toHaveURL(/verify-email/);

        // User is created now. Promote to System Admin to allow Tenant Creation.
        await db.makeSystemAdmin(userEmail);

        // 2. Verify Email via Mailpit
        const email = await mailpit.waitForEmail(userEmail, 'Verify your email');
        const verificationUrl = mailpit.extractLink(email, /(http:\/\/localhost:\d+\/api\/auth\/verify-email\?token=[^"\s]+)/);
        await page.goto(verificationUrl);

        // 3. Login
        // We must login manually to ensure we get a fresh session with the System Admin role
        // The verification link might verify us but the session could be stale or limited.
        await page.context().clearCookies();

        await page.goto('/login');
        await page.fill('input[type="email"]', userEmail);
        await page.fill('input[type="password"]', userPassword);
        await page.getByRole('button', { name: /login/i }).click();

        // Relaxed check: Look for Dashboard link or heading anywhere
        await expect(page.getByText('Dashboard').first()).toBeVisible({ timeout: 20000 });
    });

    test.afterEach(async ({ db }) => {
        if (userEmail) {
            console.log(`[Teardown] Cleaning up user: ${userEmail}`);
            await db.cleanupUser(userEmail);
        }
    });

    // Run tests serially to avoid conflicts
    test.describe.configure({ mode: 'serial' });

    test('Create Tenant', async ({ page }) => {
        // Navigate to Tenant List (Assuming it's in the sidebar or we go via URL)
        // For now, let's look for a "Create Tenant" button or link in dashboard/settings
        // Only if it exists. If not, we might need to go to a specific URL.
        // Assuming /admin/tenants or similar. 
        // Let's check if there is a "Create Organization" or "Create Tenant" button on dashboard

        // If the UI is "Organization" based:
        await page.goto('/onboarding'); // or wherever tenant creation happens

        // OR if it's an admin view:
        // await page.goto('/admin/tenants');

        // Let's assume standard "Create Organization" flow for a new user
        // Often new users are prompted to create one.

        // If we are on dashboard, look for "Create Organization"
        // Adjust selectors based on actual UI.
        const createBtn = page.getByRole('button', { name: /create organization/i });

        if (await createBtn.isVisible()) {
            await createBtn.click();
        } else {
            // Maybe in a dropdown?
            // For this specific test, let's assume we are testing the "Create Tenant" flow
            // which might be available via a specific route.
            // Updating based on previous file content:
            // It used '/admin/tenants'
            await page.goto('/admin/tenants');
            // If this 404s we will know.
        }

        // Wait for page load
        await page.waitForLoadState('networkidle');


        // Open Create Dialog
        const createTenantBtn = page.getByRole('button', { name: /create tenant/i });

        if (await createTenantBtn.isVisible()) {
            await createTenantBtn.click();
        } else {
            console.log('[Debug] Create Tenant button not visible. Dumping page text...');
        }

        // Fill create tenant form using confirmed placeholders
        const tenantName = `Test Tenant ${Date.now()}`;

        // Attempt generic selectors first
        try {
            await page.getByLabel('Name').fill(tenantName);
        } catch {
            await page.getByPlaceholder('Acme Corp').fill(tenantName);
        }

        // Assuming slug is auto-generated or optional

        await page.getByRole('button', { name: 'Create Tenant', exact: true }).click();

        // Verify success message
        await expect(page.getByText('Tenant created successfully')).toBeVisible();

        // Verify list update
        await expect(page.getByText(tenantName)).toBeVisible();
    });

    test('List Tenants', async ({ page }) => {
        await page.goto('/admin/tenants');
        // Check list matches simple table presence
        await expect(page.locator('table')).toBeVisible();
    });
});
