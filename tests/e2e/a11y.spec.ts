import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Loop 38 (Phase 117 from AUDIT_PHASE70) — automated WCAG 2.1 AA
 * check on the public surfaces Küa promises to keep accessible.
 *
 * Scope intentionally narrow: only PUBLIC routes that don't need
 * auth or a seeded shop. Authenticated surfaces (calendar, finances,
 * settings) are tested manually until we wire a CI auth fixture in
 * a follow-up loop.
 *
 * Failure mode: the test asserts an empty `violations` array. Any
 * WCAG 2.1 AA violation breaks the test and (once CI runs e2e) the
 * deployment.
 *
 * To run locally:
 *   pnpm dev        # in one terminal
 *   pnpm test:e2e   # in another
 *
 * CI integration deferred — the existing `.github/workflows/ci.yml`
 * runs typecheck/lint/format/build only. A future loop adds an
 * `e2e` job that spins up the dev server + a stub Supabase, then
 * runs Playwright.
 */

const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.describe('accessibility (WCAG 2.1 AA)', () => {
  test('/fr/login has no axe violations', async ({ page }) => {
    await page.goto('/fr/login');
    const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });

  test('/fr/accessibility has no axe violations', async ({ page }) => {
    await page.goto('/fr/accessibility');
    const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });

  test('/fr/privacy has no axe violations', async ({ page }) => {
    await page.goto('/fr/privacy');
    const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });

  test('/fr/terms has no axe violations', async ({ page }) => {
    await page.goto('/fr/terms');
    const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
