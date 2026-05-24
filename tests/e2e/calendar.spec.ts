import { expect, test } from '@playwright/test';

/**
 * Admin calendar — requires a signed-in member of a shop. We skip the test
 * entirely if no credentials are provided via env vars so CI can opt in to
 * this surface without breaking when the test user isn't provisioned.
 *
 * To enable locally, add to `.env.local` (or pass inline):
 *   PLAYWRIGHT_USER_EMAIL=wrivard@kua.quebec
 *   PLAYWRIGHT_USER_PASSWORD=<your test password>
 *
 * The account must be a `shop_members` row with `status='confirmed'` for the
 * Axum seed shop (cf. the SQL one-liner in DEPLOY.md).
 */
const email = process.env.PLAYWRIGHT_USER_EMAIL;
const password = process.env.PLAYWRIGHT_USER_PASSWORD;

test.describe('admin calendar', () => {
  test.skip(
    !email || !password,
    'Set PLAYWRIGHT_USER_EMAIL / PLAYWRIGHT_USER_PASSWORD to run the admin tests',
  );

  test('signed-in user lands on the calendar and can navigate dates', async ({ page }) => {
    // ── Sign in
    await page.goto('/fr/login');
    await page.getByLabel(/Courriel/i).fill(email!);
    await page.getByLabel(/Mot de passe/i).fill(password!);
    await page.getByRole('button', { name: /Se connecter|Sign in/i }).click();

    // After login we land on the appointments calendar at `/fr` or `/fr/`.
    await page.waitForURL(/\/fr\/?(\?|$)/, { timeout: 10_000 });

    // The page header shows "Appointments" (en) or "Rendez-vous" (fr).
    await expect(
      page.getByRole('heading', { name: /Rendez-vous|Appointments/i }).first(),
    ).toBeVisible();

    // The barber filter row shows confirmed barbers from the Axum seed.
    await expect(page.getByRole('button', { name: /Olivier/ }).first()).toBeVisible();

    // ── Navigate to the seed date (2026-05-22) where the 7 appointments
    //    live. We use the ?date= query string for determinism.
    await page.goto('/fr/?date=2026-05-22');

    // The 22 May seed appointments include "Jules Lethor" at 08:15. Without
    // forcing a particular DOM hierarchy, just assert the client name is
    // somewhere on the page.
    await expect(page.getByText(/Jules Lethor/i)).toBeVisible({ timeout: 10_000 });
  });
});
