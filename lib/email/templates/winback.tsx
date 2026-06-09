import { Button, Heading, Section, Text } from '@react-email/components';
import { BrandedEmailLayout, DEFAULT_EMAIL_ACCENT, emailPalette } from './branded-layout';

/**
 * Lapsed-client win-back — Loop 64.
 *
 * Sent from /marketing/winback to clients who completed an appointment
 * at some point but haven't been back in 90+ days. Headline is warm,
 * not pushy ("we miss you"); single CTA to the public booking page.
 * No discount in V1 — see /marketing/promo-codes if the operator
 * wants to attach one.
 *
 * Shares the `BrandedEmailLayout` header/footer with every other
 * transactional template.
 */

export type WinbackProps = {
  locale: 'fr' | 'en';
  shop: { name: string };
  client: { firstName: string };
  /** Absolute URL to /book/[shopSlug]. */
  bookingUrl: string;
  /** Absolute URL to /unsubscribe/[token] — CASL opt-out (winback is a CEM). */
  unsubscribeUrl?: string | null;
};

const copy = (locale: 'fr' | 'en', shopName: string, firstName: string) => {
  if (locale === 'fr') {
    return {
      preview: `Tu nous manques, ${firstName} !`,
      heading: `Tu nous manques, ${firstName}.`,
      body: `Ça fait un moment qu'on ne t'a pas vu·e chez ${shopName}. Si l'envie te prend, on serait ravi·es de te recevoir.`,
      cta: 'Réserver un rendez-vous',
      footer: 'Au plaisir de te revoir bientôt.',
      signature: '— L’équipe',
    };
  }
  return {
    preview: `We miss you, ${firstName}!`,
    heading: `We miss you, ${firstName}.`,
    body: `It's been a while since we've seen you at ${shopName}. Whenever you're ready, we'd love to have you back.`,
    cta: 'Book an appointment',
    footer: 'Hope to see you again soon.',
    signature: '— The team',
  };
};

export function Winback({ locale, shop, client, bookingUrl, unsubscribeUrl }: WinbackProps) {
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
      <Section style={{ margin: '24px 0' }}>
        <Button
          href={bookingUrl}
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
