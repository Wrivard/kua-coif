import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentUser, requireShopMember } from '@/lib/auth/server';
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

export default async function PaymentsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  await requireShopMember({ locale });
  const user = await getCurrentUser();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServerClient() as any;
  const { data } = await supabase.from('payment_profiles').select('*').limit(1);
  const profile = ((data as PaymentProfileRow[] | null) ?? [])[0] ?? null;

  return (
    <PaymentsClient
      profile={profile}
      currentUser={{
        email: user?.email ?? '',
        fullName:
          typeof user?.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : null,
      }}
    />
  );
}
