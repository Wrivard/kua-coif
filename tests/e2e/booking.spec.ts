import { expect, test } from '@playwright/test';

/**
 * Public booking flow (Phase 8 surface) — no auth, anyone can hit it.
 *
 * Goes through the five wizard steps end-to-end and asserts that the
 * confirmation screen shows up. Doesn't actually commit a real DB row in
 * the assertion (we don't want every CI run to pollute the live data) — the
 * test stops before clicking "Confirm" on the contact step.
 *
 * Prereq: the Axum seed is applied so `/fr/book/axum` resolves.
 */
test.describe('public booking', () => {
  test('user can step through the wizard to the contact form', async ({ page }) => {
    await page.goto('/fr/book/axum');

    // Header shows the shop name.
    await expect(page.getByRole('heading', { name: /Axum barbershop/i })).toBeVisible();

    // ── Step 1: pick a service. The "Haircut" service from the seed is
    //    rendered as a button in the service picker.
    await page
      .getByRole('button', { name: /^Haircut$/ })
      .first()
      .click();

    // Selected banner shows the chosen service.
    await expect(page.getByText('Sélectionné', { exact: false })).toBeVisible();

    // Continue → step 2 (barber).
    await page.getByRole('button', { name: /Continuer/ }).click();

    // ── Step 2: pick a barber. "Olivier" is in the Axum seed.
    await page.getByRole('button', { name: /Olivier/ }).click();
    await page.getByRole('button', { name: /Continuer/ }).click();

    // ── Step 3: date + slot. The strip shows today by default. We pick any
    //    available slot. If none, the test xfails gracefully (the shop may
    //    be closed today depending on weekday).
    const slotButtons = page.locator('section button:has-text(":")').filter({
      hasText: /^\d{1,2}:\d{2}$/,
    });
    const slotCount = await slotButtons.count();
    test.skip(slotCount === 0, 'No slot available on today — shop closed?');
    await slotButtons.first().click();
    await page.getByRole('button', { name: /Continuer/ }).click();

    // ── Step 4: contact info. We fill the form but do not submit so the test
    //    is fully non-destructive against the live DB.
    await page.getByLabel(/Prénom/).fill('E2E Test');
    await page.getByLabel(/Téléphone/).fill('+15145550199');
    // Note: the Confirm button is enabled when first_name + phone are filled.
    await expect(page.getByRole('button', { name: /Confirmer/ })).toBeEnabled();
  });

  test('shop alias 404 renders the not-found page', async ({ page }) => {
    const response = await page.goto('/fr/book/this-alias-does-not-exist');
    // Next.js returns 404 for `notFound()` calls. Playwright catches the
    // status code from the navigation response.
    expect(response?.status()).toBe(404);
  });
});
