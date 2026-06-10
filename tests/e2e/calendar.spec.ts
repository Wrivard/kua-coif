import { expect, test, type Page } from '@playwright/test';

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

async function signIn(page: Page) {
  await page.goto('/fr/login');
  await page.getByLabel(/Courriel/i).fill(email!);
  await page.getByLabel(/Mot de passe/i).fill(password!);
  await page.getByRole('button', { name: /Se connecter|Sign in/i }).click();
  // After login we land on the appointments calendar at `/fr` or `/fr/`.
  await page.waitForURL(/\/fr\/?(\?|$)/, { timeout: 10_000 });
}

test.describe('admin calendar', () => {
  test.skip(
    !email || !password,
    'Set PLAYWRIGHT_USER_EMAIL / PLAYWRIGHT_USER_PASSWORD to run the admin tests',
  );

  test('signed-in user lands on the calendar and can navigate dates', async ({ page }) => {
    await signIn(page);

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

  /**
   * Drag-to-reschedule (Phase 27). Regression guard for the @dnd-kit
   * code-split: the Side-by-Side grid is lazy-loaded (next/dynamic, ssr:false)
   * behind a skeleton, so a *draggable* block only exists once that chunk has
   * loaded — `block.toBeVisible()` below implicitly proves the split works.
   *
   * The drag itself exercises the full path: PointerSensor (6px activation) →
   * useDraggable → DndContext.onDragEnd → handleDragEnd → rescheduleAppointment.
   */
  test('drag moves an appointment to a new time (lazy grid + reschedule)', async ({ page }) => {
    // This test MUTATES the seed (drags Jules Lethor off 08:15 and never
    // restores), so a second run against the same DB fails. Only run it where
    // the DB is disposable: CI resets the database per run (E2E_FRESH_DB=1).
    // Against a persistent local DB it would corrupt the seed, so we skip it.
    test.skip(
      !process.env.E2E_FRESH_DB,
      'drag test mutates the seed — run only against a fresh db (CI resets per run)',
    );
    await signIn(page);
    await page.goto('/fr/?date=2026-05-22');

    // Jules Lethor sits in Olivier's column at 08:15–08:45 on the seed date.
    // The block is a <button>; waiting for it also waits past the grid skeleton.
    const block = page.getByRole('button', { name: /Jules Lethor/i });
    await expect(block).toBeVisible({ timeout: 15_000 });
    await expect(block).toContainText('08:15');

    const box = await block.boundingBox();
    if (!box) throw new Error('Could not resolve the appointment block bounding box');

    // The reschedule is a Next.js server action (POST + `Next-Action` header).
    // Arm the wait BEFORE releasing the pointer so we catch the request.
    const reschedulePost = page.waitForRequest(
      (req) => req.method() === 'POST' && req.headers()['next-action'] !== undefined,
      { timeout: 15_000 },
    );

    // Drive @dnd-kit's PointerSensor with a real, stepped pointer drag — it
    // needs incremental moves past the 6px activation distance to start a
    // drag (a single jump reads as a click). ~30px down ⇒ +15 min after the
    // 5-min snap ⇒ 08:30, which still ends (09:00) before Drew Paris (09:10),
    // so the move stays within Olivier's column and can't conflict.
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy + 12, { steps: 4 });
    await page.mouse.move(cx, cy + 30, { steps: 12 });
    await page.mouse.up();

    // 1) The drag reached the server (the full drag→reschedule path ran).
    await reschedulePost;

    // 2) The optimistic move applied and was NOT reverted (a conflict would
    //    snap it back to 08:15): the same block now shows its new start time.
    await expect(block).not.toContainText('08:15', { timeout: 5_000 });
  });
});
