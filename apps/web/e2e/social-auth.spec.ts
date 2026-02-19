import { test, expect } from '@playwright/test';

test.describe('Social Authentication', () => {


    test('Sign In with Google (Mocked)', async ({ page }) => {
        // Mock Google Auth endpoint setup dynamically
        await page.route('**/api/auth/sign-in/social*', async (route) => {
            // Dynamically derive origin from the page's current URL context
            // Or use the request URL to determine where to redirect back
            const url = new URL(page.url());
            const origin = url.origin;

            const json = {
                url: `${origin}/auth/callback?code=mock_google_code`,
            };
            await route.fulfill({ json });
        });

        await page.goto('/login');

        // Find and click Google Sign In button
        const googleBtn = page.getByRole('button', { name: /google/i });
        await expect(googleBtn).toBeVisible({ timeout: 5000 });

        // Wait for the mock response to ensure the button click triggered the API call
        const responsePromise = page.waitForResponse(resp =>
            resp.url().includes('/api/auth/sign-in/social') && resp.status() === 200
        );

        await googleBtn.click();

        await responsePromise;

        // Optionally verify navigation to callback (though mock might be too fast or client handling varies)
        // At minimum we verified the API call was made.
    });

    test('Sign Up with Google (Mocked)', async ({ page }) => {
        // Mock Google Auth endpoint setup dynamically
        await page.route('**/api/auth/sign-in/social*', async (route) => {
            const url = new URL(page.url());
            const origin = url.origin;
            const json = {
                url: `${origin}/auth/callback?code=mock_google_code`,
            };
            await route.fulfill({ json });
        });

        await page.goto('/signup');

        const googleBtn = page.getByRole('button', { name: /google/i });
        await expect(googleBtn).toBeVisible();

        // Wait for the mock response
        const responsePromise = page.waitForResponse(resp =>
            resp.url().includes('/api/auth/sign-in/social') && resp.status() === 200
        );

        await googleBtn.click();

        await responsePromise;
    });
});
