import { test, expect } from './test';
import { createVerifiedUser } from './helpers/auth-setup';

test.describe('Tenant Management', () => {
    // Run tests serially to avoid conflicts
    test.describe.configure({ mode: 'serial' });

    let userEmail: string;

    // Helper to sign up and login before tests
    test.beforeEach(async ({ page, mailpit, db }) => {
        // Targeted cleanup handled by helper

        // Create verified System Admin who can create tenants
        const user = await createVerifiedUser(page, mailpit, db, {
            role: 'system',
            emailPrefix: 'tenant-admin'
        });
        userEmail = user.email;
    });

    test.afterEach(async ({ db }) => {
        if (userEmail) {
            console.log(`[Teardown] Cleaning up user: ${userEmail}`);
            await db.cleanupUser(userEmail);
        }
    });



    test('Create Tenant', async ({ page, db }) => {
        // Navigate directly to Tenant Creation via Admin List
        await page.goto('/admin/tenants');

        // Wait for page load
        await page.waitForLoadState('domcontentloaded');

        // Open Create Dialog
        const createTenantBtn = page.getByRole('button', { name: /create tenant/i });
        await expect(createTenantBtn).toBeVisible();
        await createTenantBtn.click();

        // Fill create tenant form using confirmed placeholders/labels
        const tenantName = `Test Tenant ${Date.now()}`;
        let tenantSlug: string | undefined;

        try {
            // Setup response interception to get the slug
            const responsePromise = page.waitForResponse(resp =>
                resp.url().includes('admin/tenants') && (resp.status() === 201 || resp.status() === 200)
            );

            // Use exact label if possible, or fallback to known placeholder
            // Assuming "Name" label exists as per typical form
            await page.getByLabel('Name').fill(tenantName);

            // Submit
            await page.getByRole('button', { name: 'Create Tenant', exact: true }).click();

            // Wait for response and extract slug
            const response = await responsePromise;
            const body = await response.json();
            tenantSlug = body.slug; // Assuming API returns { id, name, slug, ... }

            // Verify success message (handle strict mode matching multiple elements)
            await expect(page.getByText('Tenant created successfully').first()).toBeVisible();

            // Verify list update
            await expect(page.getByText(tenantName)).toBeVisible();
        } finally {
            // Clean up the created tenant
            if (tenantSlug) {
                await db.cleanupOrganization(tenantSlug);
            }
        }
    });

    test('List Tenants', async ({ page }) => {
        await page.goto('/admin/tenants');
        // Check list matches simple table presence
        await expect(page.locator('table')).toBeVisible();
    });
});
