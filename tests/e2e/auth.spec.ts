import { expect, test } from '@playwright/test';

/**
 * Signup → login redirect chain.
 *
 * We use a randomized email per run so the test can be re-run on the same
 * Supabase project without colliding with previous runs. The created account
 * lingers in `auth.users` — for V1 this is acceptable noise; a Phase 15+
 * cleanup hook can delete e2e users by email prefix.
 *
 * Note: this test relies on Supabase Auth being configured with email
 * confirmation *disabled* OR the test is tagged `@requires-real-email` for
 * skip. By default Supabase's free tier confirms via email, which would
 * block this flow. We assert the post-signup state by matching the success
 * hint on `/login?signedUp=1` rather than logging in.
 */
test.describe('auth', () => {
  test('signup creates an account and bounces to /login?signedUp=1', async ({ page }) => {
    const email = `e2e+${Date.now()}@kua.quebec`;
    const password = 'this-is-a-strong-test-password-123';

    await page.goto('/fr/signup');

    await page.getByLabel(/Nom complet/i).fill('E2E Tester');
    await page.getByLabel(/^Courriel$/i).fill(email);
    await page.getByLabel(/Mot de passe/i).fill(password);

    await page.getByRole('button', { name: /Créer mon compte/i }).click();

    // After a successful signup the action redirects to `/login?signedUp=1`,
    // and the login page shows the green confirmation hint.
    await page.waitForURL(/\/login\?signedUp=1$/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/fr\/login\?signedUp=1$/);
  });

  test('login page renders and links to signup', async ({ page }) => {
    await page.goto('/fr/login');
    await expect(page.getByRole('heading', { name: /Connexion|Sign in/i })).toBeVisible();
    // The "Create account" link points to /fr/signup.
    const signupLink = page.getByRole('link', { name: /Créer un compte|Create one/i });
    await expect(signupLink).toHaveAttribute('href', /\/fr\/signup/);
  });
});
