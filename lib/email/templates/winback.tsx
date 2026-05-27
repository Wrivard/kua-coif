import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';

/**
 * Lapsed-client win-back — Loop 64.
 *
 * Sent from /marketing/winback to clients who completed an appointment
 * at some point but haven't been back in 90+ days. Headline is warm,
 * not pushy ("we miss you"); single CTA to the public booking page.
 * No discount in V1 — see /marketing/promo-codes if the operator
 * wants to attach one.
 */

export type WinbackProps = {
  locale: 'fr' | 'en';
  shop: { name: string };
  client: { firstName: string };
  /** Absolute URL to /book/[shopSlug]. */
  bookingUrl: string;
};

const palette = {
  bgOuter: '#1b1b1b',
  bgCard: '#222222',
  border: '#383838',
  text: '#f5f5f5',
  textMuted: '#a0a0a0',
  accent: '#8b5cf6',
  buttonText: '#ffffff',
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

export function Winback({ locale, shop, client, bookingUrl }: WinbackProps) {
  const L = copy(locale, shop.name, client.firstName);
  return (
    <Html lang={locale}>
      <Head />
      <Preview>{L.preview}</Preview>
      <Body style={{ backgroundColor: palette.bgOuter, margin: 0, padding: '24px 0' }}>
        <Container
          style={{
            backgroundColor: palette.bgCard,
            border: `1px solid ${palette.border}`,
            borderRadius: 8,
            color: palette.text,
            fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
            maxWidth: 520,
            padding: '32px 28px',
          }}
        >
          <Heading
            as="h1"
            style={{
              color: palette.text,
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              margin: '0 0 16px',
            }}
          >
            {L.heading}
          </Heading>
          <Section>
            <Text style={{ color: palette.text, fontSize: 15, lineHeight: 1.55, margin: 0 }}>
              {L.body}
            </Text>
          </Section>
          <Section style={{ margin: '24px 0' }}>
            <Button
              href={bookingUrl}
              style={{
                backgroundColor: palette.accent,
                color: palette.buttonText,
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
          <Text style={{ color: palette.textMuted, fontSize: 13, margin: '0 0 16px' }}>
            {L.footer}
          </Text>
          <Section>
            <Text style={{ color: palette.textMuted, fontSize: 13, margin: 0 }}>{L.signature}</Text>
            <Text
              style={{
                color: palette.accent,
                fontSize: 13,
                fontWeight: 600,
                margin: '4px 0 0',
              }}
            >
              {shop.name}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
