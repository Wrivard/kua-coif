import { Button, Heading, Hr, Section, Text } from '@react-email/components';
import { BrandedEmailLayout, DEFAULT_EMAIL_ACCENT, EmailLabel, emailPalette } from './branded-layout';
import { formatHeaderDate, formatShopTime } from '@/lib/business/timezone';

/**
 * Loop 42 (Phase 122 from AUDIT_PHASE70) — waitlist auto-notify email.
 *
 * Fires when an appointment is cancelled and a waiting_list_entries
 * row matches the freed slot (same shop, date window covers the
 * slot date, preferred barber matches or is null). One email per
 * matching entry, then status flips to `notified` so we don't ping
 * the same person every time another slot opens that day.
 *
 * CTA: a deep-link back to the public booking page. We can't pre-
 * select the freed slot programmatically yet (no `?date=` /
 * `?barber=` query params on the wizard), but landing the customer
 * on the right shop's booking page is a 90% win — they pick a slot
 * in seconds. A future loop can add prefill once the wizard
 * supports URL params.
 *
 * Shares the `BrandedEmailLayout` with every other transactional
 * template; per-shop white-label threads through `emailLogoUrl` /
 * `emailAccentColor`.
 */

export type WaitlistSlotOpenProps = {
  locale: 'fr' | 'en';
  shop: {
    name: string;
    phone?: string | null;
    timezone: string;
    emailLogoUrl?: string | null;
    emailAccentColor?: string | null;
  };
  entry: {
    firstName: string;
  };
  slot: {
    startAtIso: string;
    barberDisplayName: string;
  };
  /** Public booking deep-link. `null` when the shop has no alias. */
  bookingUrl: string | null;
};

const copy = (locale: 'fr' | 'en') =>
  locale === 'fr'
    ? {
        preview: (shop: string) => `Une place vient d'ouvrir chez ${shop}`,
        title: 'Une place vient de se libérer',
        hello: (n: string) => `Bonjour ${n},`,
        intro: (shop: string) =>
          `Tu étais sur la liste d'attente chez ${shop}. Une place vient d'ouvrir — voici les détails :`,
        when: 'Date',
        barber: 'Avec',
        cta: 'Réserver maintenant',
        outroWithPhone: (phone: string) =>
          `Les places se prennent vite — clique le bouton ci-dessus ou appelle le salon au ${phone}.`,
        outroNoPhone:
          'Les places se prennent vite — clique le bouton ci-dessus pour réserver avant que quelqu’un d’autre la prenne.',
        signature: "— L'équipe",
        whyYouGotThis:
          'Tu reçois ce courriel parce que tu t’es inscrit·e sur la liste d’attente. Tu peux te désinscrire en répondant simplement à ce message.',
      }
    : {
        preview: (shop: string) => `A slot just opened up at ${shop}`,
        title: 'A slot just opened up',
        hello: (n: string) => `Hi ${n},`,
        intro: (shop: string) =>
          `You were on the waitlist at ${shop}. A slot just opened — here are the details:`,
        when: 'When',
        barber: 'With',
        cta: 'Book now',
        outroWithPhone: (phone: string) =>
          `Slots get taken fast — tap the button above or call the shop at ${phone}.`,
        outroNoPhone:
          'Slots get taken fast — tap the button above to book before someone else takes it.',
        signature: '— The team',
        whyYouGotThis:
          'You received this email because you joined the waitlist. Reply to this message to unsubscribe.',
      };

export function WaitlistSlotOpen({ locale, shop, entry, slot, bookingUrl }: WaitlistSlotOpenProps) {
  const L = copy(locale);
  const accent = shop.emailAccentColor ?? DEFAULT_EMAIL_ACCENT;
  const formattedDate = formatHeaderDate(new Date(slot.startAtIso), locale, shop.timezone);
  const formattedTime = formatShopTime(slot.startAtIso, shop.timezone, 'HH:mm');

  return (
    <BrandedEmailLayout
      locale={locale}
      previewText={L.preview(shop.name)}
      logoUrl={shop.emailLogoUrl}
      accentColor={shop.emailAccentColor}
      brandName={shop.name}
      signature={L.signature}
      shopName={shop.name}
      footnote={L.whyYouGotThis}
    >
      <Heading
        as="h1"
        style={{
          color: emailPalette.text,
          fontSize: 22,
          fontWeight: 600,
          margin: '0 0 8px',
        }}
      >
        {L.title}
      </Heading>
      <Text
        style={{
          color: emailPalette.textMuted,
          fontSize: 14,
          lineHeight: 1.5,
          margin: 0,
        }}
      >
        {L.hello(entry.firstName)}
      </Text>
      <Text
        style={{
          color: emailPalette.textMuted,
          fontSize: 14,
          lineHeight: 1.5,
          marginTop: 4,
        }}
      >
        {L.intro(shop.name)}
      </Text>

      <Hr
        style={{
          border: 'none',
          borderTop: `1px solid ${emailPalette.border}`,
          margin: '24px 0',
        }}
      />

      <Section style={{ marginBottom: 16 }}>
        <EmailLabel>{L.when}</EmailLabel>
        <Text
          style={{
            color: emailPalette.text,
            fontSize: 15,
            fontWeight: 500,
            margin: 0,
          }}
        >
          {formattedDate} · {formattedTime}
        </Text>
      </Section>

      <Section style={{ marginBottom: 24 }}>
        <EmailLabel>{L.barber}</EmailLabel>
        <Text
          style={{
            color: emailPalette.text,
            fontSize: 15,
            fontWeight: 500,
            margin: 0,
          }}
        >
          {slot.barberDisplayName}
        </Text>
      </Section>

      {bookingUrl ? (
        <Section style={{ margin: '0 0 24px' }}>
          <Button
            href={bookingUrl}
            style={{
              backgroundColor: accent,
              borderRadius: 6,
              color: '#ffffff',
              display: 'inline-block',
              fontSize: 15,
              fontWeight: 600,
              padding: '12px 20px',
              textDecoration: 'none',
            }}
          >
            {L.cta}
          </Button>
        </Section>
      ) : null}

      <Text
        style={{
          color: emailPalette.textMuted,
          fontSize: 13,
          lineHeight: 1.5,
          margin: 0,
        }}
      >
        {shop.phone ? L.outroWithPhone(shop.phone) : L.outroNoPhone}
      </Text>
    </BrandedEmailLayout>
  );
}
