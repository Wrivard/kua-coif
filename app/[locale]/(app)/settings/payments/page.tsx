import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentUser, requireShopMember } from '@/lib/auth/server';
import { stripeConfigured } from '@/lib/stripe/server';
import { quickbooksConfigured } from '@/lib/quickbooks/server';
import { PaymentsClient } from './payments-client';
import type { BusinessType } from '@/db/enums';

export const dynamic = 'force-dynamic';

export type PaymentProfileRow = {
  legal_name: string | null;
  business_type: BusinessType | null;
  tax_id_provided: boolean;
  sin_provided: boolean;
  dob: string | null;
  verified: boolean;
  destination_bank_name: string | null;
  destination_last4: string | null;
  created_at: string;
};

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

export default async function PaymentsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  await requireShopMember({ locale });
  const user = await getCurrentUser();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServerClient() as any;
  const [{ data: profileData }, { data: shopData }] = await Promise.all([
    supabase.from('payment_profiles').select('*').limit(1),
    supabase
      .from('shops')
      .select(
        'stripe_account_id, stripe_connect_status, quickbooks_realm_id, quickbooks_connect_status, quickbooks_refresh_token_expires_at, quickbooks_last_refreshed_at',
      )
      .limit(1),
  ]);
  const profile = ((profileData as PaymentProfileRow[] | null) ?? [])[0] ?? null;
  const shopRow = ((shopData as Array<{
    stripe_account_id: string | null;
    stripe_connect_status: StripeConnectState['status'];
    quickbooks_realm_id: string | null;
    quickbooks_connect_status: QuickbooksConnectState['status'];
    quickbooks_refresh_token_expires_at: string | null;
    quickbooks_last_refreshed_at: string | null;
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

  return (
    <PaymentsClient
      profile={profile}
      currentUser={{
        email: user?.email ?? '',
        fullName:
          typeof user?.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : null,
      }}
      stripe={stripe}
      quickbooks={quickbooks}
    />
  );
}
