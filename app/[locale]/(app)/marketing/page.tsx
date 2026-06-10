import Link from 'next/link';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Megaphone, QrCode, Star, Tag, MessageSquare, Send, Heart } from 'lucide-react';
import { requireShopMember } from '@/lib/auth/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

/**
 * Loop 58 — Marketing landing.
 *
 * Replaces the Phase 8 placeholder. Surfaces the marketing-flavored
 * tools that already live in /settings (promo codes, notification
 * automations, reviews moderation) alongside the new /marketing-
 * specific surface (review QR code generator). Treating those settings
 * pages as marketing tools is the SPEC's original intent — the
 * "Marketing" sidebar entry has been waiting for content since
 * Phase 8.
 *
 * The cross-links are intentional: the settings sub-sidebar (Loop 57)
 * is where the owner manages them in the context of settings; this
 * page surfaces them in the context of marketing. Same underlying
 * pages, two entry points — like a control panel that highlights
 * different angles.
 */
export default async function MarketingPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });

  const t = await getTranslations('pages.marketing');

  const cards = [
    {
      icon: Send,
      title: t('cards.reviewCampaign.title'),
      description: t('cards.reviewCampaign.description'),
      href: `/${locale}/marketing/review-campaign`,
      cta: t('cards.reviewCampaign.cta'),
      featured: true,
    },
    {
      icon: Heart,
      title: t('cards.winback.title'),
      description: t('cards.winback.description'),
      href: `/${locale}/marketing/winback`,
      cta: t('cards.winback.cta'),
      featured: true,
    },
    {
      icon: QrCode,
      title: t('cards.reviewQr.title'),
      description: t('cards.reviewQr.description'),
      href: `/${locale}/marketing/reviews-qr`,
      cta: t('cards.reviewQr.cta'),
    },
    {
      icon: Tag,
      title: t('cards.promoCodes.title'),
      description: t('cards.promoCodes.description'),
      href: `/${locale}/settings/promo-codes`,
      cta: t('cards.promoCodes.cta'),
    },
    {
      icon: MessageSquare,
      title: t('cards.automations.title'),
      description: t('cards.automations.description'),
      href: `/${locale}/settings/notifications`,
      cta: t('cards.automations.cta'),
    },
    {
      icon: Star,
      title: t('cards.reviewsModeration.title'),
      description: t('cards.reviewsModeration.description'),
      href: `/${locale}/settings/reviews`,
      cta: t('cards.reviewsModeration.cta'),
    },
  ];

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <div className="space-y-6 p-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.href}
                href={card.href}
                className="hover:border-accent/40 group block rounded-lg border border-border bg-bg-surface p-5 transition-colors hover:bg-bg-surface-2"
              >
                <div className="flex items-start gap-4">
                  <div
                    className={
                      card.featured
                        ? 'flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent-subtle text-accent-text'
                        : 'flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-bg-surface-2 text-text-secondary'
                    }
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold text-text-primary">{card.title}</h2>
                    <p className="mt-1 text-sm text-text-secondary">{card.description}</p>
                    <p className="mt-3 text-xs font-medium text-accent group-hover:underline">
                      {card.cta} →
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Coming-soon block — placeholder for Loop 59+ (bulk
         *  review campaign + client segments + birthday emails). */}
        <Card>
          <CardBody className="flex items-start gap-3 text-sm text-text-secondary">
            <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden />
            <div>
              <p className="font-medium text-text-primary">{t('comingSoon.title')}</p>
              <p className="mt-1">{t('comingSoon.description')}</p>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
