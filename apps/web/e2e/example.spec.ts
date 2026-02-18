import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
    await page.goto('/');

    // Expect a title "to contain" a substring.
    await expect(page).toHaveTitle(/Nexiom/);
});

test('redirects to login', async ({ page }) => {
    await page.goto('/');

    // If unauthenticated, it should redirect to login
    await expect(page).toHaveURL(/.*login/);
});
