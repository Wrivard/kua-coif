import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';

/**
 * Birthday greeting — Loop 62.
 *
 * Fired once per year per client by the daily birthday-greetings cron.
 * Intentionally short and warm — long emails feel commercial; a brief
 * note feels personal. No discount code in V1 (would tempt promo-code
 * harvesting), but the layout has room for a follow-up CTA if/when we
 * add it.
 *
 * Palette + structure mirrors the other transactional templates so all
 * five share one visual identity in the inbox.
 */

export type BirthdayGreetingProps = {
  locale: 'fr' | 'en';
  shop: { name: string };
  client: { firstName: string };
};

const palette = {
  bgOuter: '#1b1b1b',
  bgCard: '#222222',
  border: '#383838',
  text: '#f5f5f5',
  textMuted: '#a0a0a0',
  accent: '#8b5cf6',
};

const copy = (locale: 'fr' | 'en', shopName: string, firstName: string) => {
  if (locale === 'fr') {
    return {
      preview: `Joyeux anniversaire ${firstName} !`,
      heading: `Joyeux anniversaire, ${firstName} ! 🎂`,
      body: `Toute l'équipe de ${shopName} te souhaite une excellente journée. Merci de faire partie de la famille du salon.`,
      signature: '— L’équipe',
    };
  }
  return {
    preview: `Happy birthday ${firstName}!`,
    heading: `Happy birthday, ${firstName}! 🎂`,
    body: `Everyone at ${shopName} wishes you a wonderful day. Thank you for being part of the shop family.`,
    signature: '— The team',
  };
};

export function BirthdayGreeting({ locale, shop, client }: BirthdayGreetingProps) {
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
          <Section style={{ marginTop: 24 }}>
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
