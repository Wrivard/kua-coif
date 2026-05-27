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
 * Review request — Loop 63.
 *
 * Sent in bulk from /marketing/review-campaign to clients who completed
 * an appointment recently but haven't left a review yet. Each email
 * carries a signed-token link to /review/[token] (Phase 63b's public
 * submission flow). Token TTL is set by the dispatcher; long-enough
 * that a client can click through a week later.
 *
 * Intentionally short — long emails with multiple CTAs reduce click-
 * through. One button, one ask.
 */

export type ReviewRequestProps = {
  locale: 'fr' | 'en';
  shop: { name: string };
  client: { firstName: string };
  /** Absolute URL to /review/[token]. */
  reviewUrl: string;
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
              href={reviewUrl}
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
