import QRCode from 'qrcode';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRoleInCurrentShop, requireShopMember, getCurrentShopId } from '@/lib/auth/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { ReviewsQrClient } from './reviews-qr-client';

export const dynamic = 'force-dynamic';

/**
 * Loop 58 — Review QR code generator.
 *
 * Manager+ surface. The owner pastes their review-collection URL
 * (Google Business Profile, Yelp page, in-app /review/[token], etc.),
 * we persist it on `shops.public_review_url`, and render a QR code
 * pointing to it. The QR is generated server-side (so it's available
 * for instant download/print without spinning up the client lib) AND
 * the client component re-generates on edit for a live preview.
 *
 * If the column is null we render a setup form with no QR; the page
 * is still useful to the operator (they need somewhere to plug in
 * the URL the first time).
 */
export default async function ReviewsQrPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });
  await requireRoleInCurrentShop('manager');

  const shopId = await getCurrentShopId();
  if (!shopId) return null;

  const admin = createSupabaseServiceRoleClient();
  const shopRes = await admin
    .from('shops')
    .select('name, public_review_url')
    .eq('id', shopId)
    .single();
  const shop = shopRes.data ?? {
    name: '',
    public_review_url: null,
  };

  // Pre-render the QR as a data URL when the URL is already set so the
  // initial paint shows the code without waiting on client-side qrcode
  // bootstrapping. The client component re-generates on input change.
  // High error-correction so the QR can survive a coffee stain or two
  // when printed at counter size.
  const initialQrDataUrl = shop.public_review_url
    ? await QRCode.toDataURL(shop.public_review_url, {
        errorCorrectionLevel: 'H',
        margin: 1,
        width: 512,
      })
    : null;

  const t = await getTranslations('pages.marketing.reviewQr');

  return (
    <ReviewsQrClient
      locale={locale}
      shopName={shop.name}
      initialUrl={shop.public_review_url ?? ''}
      initialQrDataUrl={initialQrDataUrl}
      labels={{
        title: t('title'),
        subtitle: t('subtitle'),
        formLabel: t('formLabel'),
        formPlaceholder: t('formPlaceholder'),
        formHint: t('formHint'),
        save: t('save'),
        download: t('download'),
        print: t('print'),
        emptyTitle: t('emptyTitle'),
        emptyDescription: t('emptyDescription'),
        savedToast: t('savedToast'),
        invalidUrl: t('invalidUrl'),
        unexpected: t('unexpected'),
        printHeading: t('printHeading'),
        printSubheading: t('printSubheading'),
      }}
    />
  );
}
