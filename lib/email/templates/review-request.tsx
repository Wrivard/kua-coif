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
  /** Absolute URL to /unsubscribe/[token] — CASL opt-out (review ask is a CEM). */
  unsubscribeUrl?: string | null;
};

const copy = (locale: 'fr' | 'en', shopName: string, firstName: string) => {
  if (locale === 'fr') {
    return {
      preview: `Comment s’est passée ta visite chez ${shopName} ?`,
      heading: `Bonjour ${firstName},`,
      body: `Merci d'avoir choisi ${shopName} récemment. Si tu as une minute, ça nous aiderait beaucoup que tu laisses un avis sur ta visite.`,
      rateHint: 'Ta note, en un tap :',
      starLabel: (n: number) => `${n} étoile${n > 1 ? 's' : ''} sur 5`,
      cta: 'Laisser un avis',
      footer: 'Ça prend moins de 60 secondes. Merci !',
      signature: '— L’équipe',
    };
  }
  return {
    preview: `How was your visit at ${shopName}?`,
    heading: `Hi ${firstName},`,
    body: `Thanks for choosing ${shopName} recently. If you have a minute, it would help us a lot if you left a quick review of your visit.`,
    rateHint: 'Rate us in one tap:',
    starLabel: (n: number) => `${n} star${n > 1 ? 's' : ''} out of 5`,
    cta: 'Leave a review',
    footer: 'Takes less than 60 seconds. Thank you!',
    signature: '— The team',
  };
};

export function ReviewRequest({
  locale,
  shop,
  client,
  reviewUrl,
  unsubscribeUrl,
}: ReviewRequestProps) {
  const L = copy(locale, shop.name, client.firstName);
  return (
    <BrandedEmailLayout
      locale={locale}
      previewText={L.preview}
      brandName={shop.name}
      signature={L.signature}
      shopName={shop.name}
      unsubscribeUrl={unsubscribeUrl}
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
      {/* Plan 043 (step 1) — one-tap star deep-links. Each star lands on the
          review form with `?rating=N` PRE-SELECTED (the page still requires an
          explicit Submit — a mis-tap must never post a review). Plain <a>
          tags with a unicode star: bulletproof across email clients, no
          images to block. The single CTA below stays as the fallback. */}
      <Section style={{ margin: '24px 0 8px' }}>
        <Text
          style={{
            color: emailPalette.textMuted,
            fontSize: 13,
            fontWeight: 600,
            margin: '0 0 6px',
          }}
        >
          {L.rateHint}
        </Text>
        <table role="presentation" cellPadding={0} cellSpacing={0} style={{ margin: 0 }}>
          <tbody>
            <tr>
              {[1, 2, 3, 4, 5].map((n) => (
                <td key={n} style={{ padding: '0 2px' }}>
                  <a
                    href={`${reviewUrl}?rating=${n}`}
                    title={L.starLabel(n)}
                    aria-label={L.starLabel(n)}
                    style={{
                      display: 'inline-block',
                      fontSize: 30,
                      lineHeight: '44px',
                      width: 44,
                      textAlign: 'center',
                      textDecoration: 'none',
                      color: '#eab308',
                    }}
                  >
                    ★
                  </a>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </Section>
      <Section style={{ margin: '8px 0 24px' }}>
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
