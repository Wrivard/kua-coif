import { Button, Heading, Section, Text } from '@react-email/components';
import { BrandedEmailLayout, DEFAULT_EMAIL_ACCENT, emailPalette } from './branded-layout';

/**
 * Review request — Loop 63.
 *
 * Sent in bulk from /marketing/review-campaign to clients who completed
 * an appointment recently but haven't left a review yet. Each email
 * carries a signed-token link to /review/[token] (Phase 63b's public
 * submission flow). Token TTL is set by the dispatcher; long-enough
 * that a client can click through a week later.
 *
 * Intentionally short — long emails with multiple CTAs reduce click-
 * through. One button, one ask. Shares the `BrandedEmailLayout`
 * header/footer with every other transactional template.
 */

export type ReviewRequestProps = {
  locale: 'fr' | 'en';
  shop: { name: string };
  client: { firstName: string };
  /** Absolute URL to /review/[token]. */
  reviewUrl: string;
};

const copy = (locale: 'fr' | 'en', shopName: string, firstName: string) => {
  if (locale === 'fr') {
    return {
      preview: `Comment s’est passée ta visite chez ${shopName} ?`,
      heading: `Bonjour ${firstName},`,
      body: `Merci d'avoir choisi ${shopName} récemment. Si tu as une minute, ça nous aiderait beaucoup que tu laisses un avis sur ta visite.`,
      cta: 'Laisser un avis',
      footer: 'Ça prend moins de 60 secondes. Merci !',
      signature: '— L’équipe',
    };
  }
  return {
    preview: `How was your visit at ${shopName}?`,
    heading: `Hi ${firstName},`,
    body: `Thanks for choosing ${shopName} recently. If you have a minute, it would help us a lot if you left a quick review of your visit.`,
    cta: 'Leave a review',
    footer: 'Takes less than 60 seconds. Thank you!',
    signature: '— The team',
  };
};

export function ReviewRequest({ locale, shop, client, reviewUrl }: ReviewRequestProps) {
  const L = copy(locale, shop.name, client.firstName);
  return (
    <BrandedEmailLayout
      locale={locale}
      previewText={L.preview}
      brandName={shop.name}
      signature={L.signature}
      shopName={shop.name}
    >
      <Heading
        as="h1"
        style={{
          color: emailPalette.text,
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          margin: '0 0 16px',
        }}
      >
        {L.heading}
      </Heading>
      <Section>
        <Text style={{ color: emailPalette.text, fontSize: 15, lineHeight: 1.55, margin: 0 }}>
          {L.body}
        </Text>
      </Section>
      <Section style={{ margin: '24px 0' }}>
        <Button
          href={reviewUrl}
          style={{
            backgroundColor: DEFAULT_EMAIL_ACCENT,
            color: '#ffffff',
            borderRadius: 6,
            padding: '10px 20px',
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: 14,
            display: 'inline-block',
          }}
        >
          {L.cta}
        </Button>
      </Section>
      <Text style={{ color: emailPalette.textMuted, fontSize: 13, margin: 0 }}>{L.footer}</Text>
    </BrandedEmailLayout>
  );
}
