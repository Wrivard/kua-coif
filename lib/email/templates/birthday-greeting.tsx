import { Heading, Section, Text } from '@react-email/components';
import { BrandedEmailLayout, emailPalette } from './branded-layout';

/**
 * Birthday greeting — Loop 62.
 *
 * Fired once per year per client by the daily birthday-greetings cron.
 * Intentionally short and warm — long emails feel commercial; a brief
 * note feels personal. No discount code in V1 (would tempt promo-code
 * harvesting), but the layout has room for a follow-up CTA if/when we
 * add it.
 *
 * Shares the `BrandedEmailLayout` header/footer so it carries the same
 * visual identity as every other transactional template.
 */

export type BirthdayGreetingProps = {
  locale: 'fr' | 'en';
  shop: { name: string };
  client: { firstName: string };
  /** Absolute URL to /unsubscribe/[token] — CASL opt-out (birthday is a CEM). */
  unsubscribeUrl?: string | null;
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

export function BirthdayGreeting({
  locale,
  shop,
  client,
  unsubscribeUrl,
}: BirthdayGreetingProps) {
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
    </BrandedEmailLayout>
  );
}
