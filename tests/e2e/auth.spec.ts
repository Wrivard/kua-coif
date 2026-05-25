import { expect, test } from '@playwright/test';

/**
 * Phase 22 changed the auth model from self-signup to whitelist invitation.
 * The `/signup` route is gone — new accounts come from
 * `auth.admin.inviteUserByEmail` triggered by `/admin/shops/new` (Küa
 * super-admin) or `/settings/users` (existing owner/manager). The previous
 * randomized-email signup test no longer applies; we replace it with two
 * smoke tests covering what users CAN do on the public auth surface.
 */
test.describe('auth', () => {
  test('login page renders the by-invitation-only notice', async ({ page }) => {
    await page.goto('/fr/login');
    await expect(page.getByRole('heading', { name: /Connexion|Sign in/i })).toBeVisible();
    // The deleted "Create an account" link must NOT be present anymore.
    await expect(page.getByRole('link', { name: /Créer un compte|Create one/i })).toHaveCount(0);
    // The invitation-only hint must show.
    await expect(page.getByText(/invitation/i)).toBeVisible();
  });

  test('forgot-password page is reachable from /login', async ({ page }) => {
    await page.goto('/fr/login');
    await page.getByRole('link', { name: /Mot de passe oublié|Forgot/i }).click();
    await expect(page).toHaveURL(/\/fr\/forgot-password$/);
    await expect(
      page.getByRole('heading', { name: /Mot de passe oublié|Forgot your password/i }),
    ).toBeVisible();
  });

  test('/signup is gone (404)', async ({ page }) => {
    const response = await page.goto('/fr/signup');
    // Next.js returns 404 for missing routes; Phase 22 deleted the
    // `/signup` page tree.
    expect(response?.status()).toBe(404);
  });
});
