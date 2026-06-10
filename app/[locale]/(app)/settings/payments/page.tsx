import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireRoleInCurrentShop, requireShopMember } from '@/lib/auth/server';
import { stripeConfigured } from '@/lib/stripe/server';
import { quickbooksConfigured } from '@/lib/quickbooks/server';
import { getPlatformAppFeeBps } from '@/lib/stripe/platform-config';
import { PaymentsClient } from './payments-client';
import type { PaymentMode } from './schema';

export const dynamic = 'force-dynamic';

export type StripeConnectState = {
  /** Whether STRIPE_SECRET_KEY is set server-side. Drives whether the
   *  Connect card renders at all. */
  configured: boolean;
  /** Cached status from `shops.stripe_connect_status`. */
  status: 'not_started' | 'pending' | 'restricted' | 'active';
  /** Whether the shop has ever started onboarding (i.e. acct_* exists). */
  hasAccount: boolean;
};

export type QuickbooksConnectState = {
  configured: boolean;
  status: 'not_started' | 'active' | 'expired' | 'disconnected';
  hasRealm: boolean;
  /**
   * Loop 46 (P98) — surfaced for the settings panel countdown.
   * `refreshExpiresAt` is the ISO instant the current refresh token
   * dies (≈100 days after last refresh); `lastRefreshedAt` is the
   * UI's "Last synced N ago" stamp. Both null on legacy
   * connections from before the migration ran — the cron will
   * backfill on the next refresh.
   */
  refreshExpiresAt: string | null;
  lastRefreshedAt: string | null;
};

export default async function PaymentsPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });
  // Security audit #3 — owner-only gate. The mutations on this page
  // (Stripe Connect, payment_mode, payment_profile, QuickBooks) are
  // all `minRole: 'owner'` server-side. Without this page-level guard
  // a barber could load the page and see the shop's Stripe Connect
  // status, payment_mode, BPS, last-4 bank, etc. — read-side
  // disclosure even though no mutations succeed.
  await requireRoleInCurrentShop('owner');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServerClient() as any;
  const { data: shopData } = await supabase
    .from('shops')
    .select(
      'stripe_account_id, stripe_connect_status, quickbooks_realm_id, quickbooks_connect_status, quickbooks_refresh_token_expires_at, quickbooks_last_refreshed_at, payment_mode',
    )
    .limit(1);
  const shopRow = ((shopData as Array<{
    stripe_account_id: string | null;
    stripe_connect_status: StripeConnectState['status'];
    quickbooks_realm_id: string | null;
    quickbooks_connect_status: QuickbooksConnectState['status'];
    quickbooks_refresh_token_expires_at: string | null;
    quickbooks_last_refreshed_at: string | null;
    payment_mode: PaymentMode;
  }> | null) ?? [])[0];

  const stripe: StripeConnectState = {
    configured: stripeConfigured(),
    status: shopRow?.stripe_connect_status ?? 'not_started',
    hasAccount: Boolean(shopRow?.stripe_account_id),
  };

  const quickbooks: QuickbooksConnectState = {
    configured: quickbooksConfigured(),
    status: shopRow?.quickbooks_connect_status ?? 'not_started',
    hasRealm: Boolean(shopRow?.quickbooks_realm_id),
    refreshExpiresAt: shopRow?.quickbooks_refresh_token_expires_at ?? null,
    lastRefreshedAt: shopRow?.quickbooks_last_refreshed_at ?? null,
  };

  // Phase D — `payment_mode` defaults to 'deposit' on shops created before
  // this column existed (the migration's `default 'deposit'` covers the
  // backfill). The null-coalesce is just defensive.
  const paymentMode: PaymentMode = shopRow?.payment_mode ?? 'deposit';

  // Phase F — fetch the platform-wide app fee BPS so the owner can see
  // exactly what Küa takes off the top. Cached in-process for 30s so
  // this is cheap. Display-only here; the actual fee is enforced at PI
  // mint time in lib/stripe/payments.ts.
  const platformAppFeeBps = await getPlatformAppFeeBps();

  return (
    <PaymentsClient
      stripe={stripe}
      quickbooks={quickbooks}
      paymentMode={paymentMode}
      platformAppFeeBps={platformAppFeeBps}
    />
  );
}
