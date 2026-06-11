import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { getStripe, stripeConfigured } from '@/lib/stripe/server';
import { reconcileStripePayments } from '@/lib/stripe/reconcile';
import { isCronAuthorized } from '@/lib/security/cron-auth';
import { captureException, withCronMonitor } from '@/lib/observability';

/**
 * Stripe reconcile cron.
 *
 * Scheduled by GitHub Actions (.github/workflows/cron-stripe-reconcile.yml),
 * NOT vercel.json: Vercel Hobby caps at 2 daily crons (already used by
 * quickbooks-refresh + google-channel-renew), and app-level jobs (reminders,
 * birthday greetings) already run from Actions for the same reason. This
 * route re-derives payment_status for rows stuck at 'pending' whose
 * success/failure webhook was missed â€” see lib/stripe/reconcile.ts.
 *
 * Security: the workflow passes `Authorization: Bearer <CRON_SECRET>`; in
 * production a missing CRON_SECRET is fail-CLOSED (lib/security/cron-auth).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Hobby caps maxDuration at 10s. Reconcile retrieves at most
// RECONCILE_BATCH_LIMIT (40) PaymentIntents sequentially (~200ms each); the
// 'pending' set is normally near-empty, so a run finishes in well under the
// budget. A pathological backlog caps and continues on the next tick.
export const maxDuration = 10;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  // Check-in inside the auth gate. Slug + crontab mirror .github/workflows/cron-stripe-reconcile.yml (runs at :17).
  return withCronMonitor('cron-stripe-reconcile', { type: 'crontab', value: '17 * * * *' }, () =>
    runStripeReconcileCron(),
  );
}

async function runStripeReconcileCron(): Promise<NextResponse> {
  // No Stripe configured (local/dev/preview without keys) â€” nothing to do.
  if (!stripeConfigured()) {
    return NextResponse.json({ ok: true, skipped: 'stripe_not_configured' });
  }

  const startedAt = Date.now();
  const sb = createSupabaseServiceRoleClient();

  try {
    const summary = await reconcileStripePayments({ sb, stripe: getStripe() });
    // Surface per-row failures as one aggregate alert â€” individual rows are
    // best-effort and only bump the counter, so a wholesale Stripe/API
    // outage would otherwise return a green 200 and go unnoticed.
    if (summary.failed > 0) {
      captureException(
        new Error(
          `[stripe-reconcile] ${summary.failed} row(s) failed (updated=${summary.updated}, checked=${summary.checked})`,
        ),
        { tags: { layer: 'stripe-reconcile', stage: 'run-summary' } },
      );
    }
    return NextResponse.json(
      { ok: true, ...summary, durationMs: Date.now() - startedAt },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    captureException(e, { tags: { layer: 'stripe-reconcile', stage: 'run' } });
    return NextResponse.json({ ok: false, error: 'reconcile_failed' }, { status: 500 });
  }
}
