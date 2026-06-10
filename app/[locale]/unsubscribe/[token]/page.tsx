import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { verifyToken } from '@/lib/security/signed-tokens';
import { UnsubscribeClient } from './unsubscribe-client';

export const dynamic = 'force-dynamic';

/**
 * Clients audit W6b — public marketing unsubscribe (CASL).
 *
 * Reached via the "Unsubscribe" link in every commercial email
 * (win-back, birthday, review request). The signed `unsub` token names
 * a specific client; we verify the signature, resolve the client +
 * shop for context, and render a one-button confirm page. The opt-out
 * itself runs through `unsubscribeFromMarketing`, which re-verifies the
 * token server-side (defense in depth).
 *
 * This page is a GET and MUST NOT mutate — email scanners and link
 * prefetchers fetch it. The flag flips only on the explicit POST
 * (server action) behind the confirm button.
 */
export default async function UnsubscribePage(props: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const params = await props.params;

  const { locale, token } = params;

  setRequestLocale(locale);

  const payload = verifyToken(decodeURIComponent(token), 'unsub');
  if (!payload) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServiceRoleClient() as any;
  const clientRes = await supabase
    .from('clients')
    .select('id, shop_id, first_name, anonymized_at, marketing_opted_out')
    .eq('id', payload.resourceId)
    .limit(1);
  const client = ((clientRes.data as Array<{
    id: string;
    shop_id: string;
    first_name: string;
    anonymized_at: string | null;
    marketing_opted_out: boolean | null;
  }> | null) ?? [])[0];
  // Don't distinguish "no such client" from "bad token" — both 404, so a
  // forged token can't enumerate client IDs. An anonymized client (Loi 25
  // erasure) also 404s: there's nothing left to manage.
  if (!client || client.anonymized_at) notFound();

  const shopRes = await supabase.from('shops').select('name').eq('id', client.shop_id).limit(1);
  const shopName = ((shopRes.data as Array<{ name: string }> | null) ?? [])[0]?.name ?? '?';

  return (
    <UnsubscribeClient
      locale={locale}
      token={token}
      shopName={shopName}
      firstName={client.first_name}
      alreadyUnsubscribed={Boolean(client.marketing_opted_out)}
    />
  );
}
