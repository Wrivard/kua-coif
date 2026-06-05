import { Heading, Hr, Section, Text } from '@react-email/components';
import { BrandedEmailLayout, EmailLabel, emailPalette } from './branded-layout';
import { formatHeaderDate, formatShopTime } from '@/lib/business/timezone';

/**
 * Cancellation notice — fires when an admin (or the customer via a future
 * self-service surface) cancels a booking. Sent through the standard
 * dispatcher, gated by `notification_automations.kind = 'cancellation'`.
 *
 * Keep it short: customer wants to confirm the cancel went through, not
 * read marketing copy. Shares the `BrandedEmailLayout` header/footer with
 * every other transactional template — the strike-through date carries the
 * "cancelled" signal in the body rather than recoloring the brand mark.
 */

export type AppointmentCancellationProps = {
  locale: 'fr' | 'en';
  shop: {
    name: string;
    phone?: string | null;
    timezone: string;
  };
  client: {
    firstName: string;
  };
  appointment: {
    startAt: string;
    services: Array<{ name: string }>;
  };
  /** Optional free-text reason supplied by the admin. Displayed as a quote. */
  reason?: string | null;
};

const copy = (locale: 'fr' | 'en') =>
  locale === 'fr'
    ? {
        preview: (shop: string) => `Ton rendez-vous chez ${shop} a été annulé`,
        title: 'Rendez-vous annulé',
        hello: (n: string) => `Bonjour ${n},`,
        intro: (shop: string) =>
          `Ton rendez-vous chez ${shop} a été annulé. Détails de la réservation annulée :`,
        when: 'Date prévue',
        services: 'Services',
        reasonLabel: 'Raison',
        outro: (phone: string | null) =>
          phone
            ? `Tu peux reprendre rendez-vous quand tu veux — contacte le salon au ${phone} ou réserve à nouveau en ligne.`
            : 'Tu peux reprendre rendez-vous quand tu veux — contacte directement le salon.',
        signature: "— L'équipe",
      }
    : {
        preview: (shop: string) => `Your appointment at ${shop} was cancelled`,
        title: 'Appointment cancelled',
        hello: (n: string) => `Hi ${n},`,
        intro: (shop: string) =>
          `Your appointment at ${shop} has been cancelled. Details of the cancelled booking:`,
        when: 'Scheduled date',
        services: 'Services',
        reasonLabel: 'Reason',
        outro: (phone: string | null) =>
          phone
            ? `Feel free to rebook anytime — call the shop at ${phone} or book again online.`
            : 'Feel free to rebook anytime — contact the shop directly.',
        signature: '— The team',
      };

export function AppointmentCancellation({
  locale,
  shop,
  client,
  appointment,
  reason,
}: AppointmentCancellationProps) {
  const L = copy(locale);
  const startDate = new Date(appointment.startAt);
  const formattedDate = formatHeaderDate(startDate, locale, shop.timezone);
  const formattedTime = formatShopTime(appointment.startAt, shop.timezone, 'HH:mm');

  return (
    <BrandedEmailLayout
      locale={locale}
      previewText={L.preview(shop.name)}
      brandName={shop.name}
      signature={L.signature}
      shopName={shop.name}
    >
      <Heading
        as="h1"
        style={{ color: emailPalette.text, fontSize: 22, fontWeight: 600, margin: '0 0 8px' }}
      >
        {L.title}
      </Heading>
      <Text style={{ color: emailPalette.textMuted, fontSize: 14, lineHeight: 1.5, margin: 0 }}>
        {L.hello(client.firstName)}
      </Text>
      <Text style={{ color: emailPalette.textMuted, fontSize: 14, lineHeight: 1.5, marginTop: 4 }}>
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
            textDecoration: 'line-through',
          }}
        >
          {formattedDate} · {formattedTime}
        </Text>
      </Section>

      {appointment.services.length > 0 ? (
        <Section style={{ marginBottom: 16 }}>
          <EmailLabel>{L.services}</EmailLabel>
          {appointment.services.map((s, i) => (
            <Text
              key={`${s.name}-${i}`}
              style={{
                color: emailPalette.textMuted,
                fontSize: 14,
                margin: i === 0 ? 0 : '4px 0 0',
              }}
            >
              {s.name}
            </Text>
          ))}
        </Section>
      ) : null}

      {reason ? (
        <Section style={{ marginBottom: 16 }}>
          <EmailLabel>{L.reasonLabel}</EmailLabel>
          <Text
            style={{
              borderLeft: `2px solid ${emailPalette.border}`,
              color: emailPalette.text,
              fontSize: 14,
              fontStyle: 'italic',
              margin: 0,
              paddingLeft: 12,
            }}
          >
            {reason}
          </Text>
        </Section>
      ) : null}

      <Hr
        style={{
          border: 'none',
          borderTop: `1px solid ${emailPalette.border}`,
          margin: '24px 0',
        }}
      />

      <Text style={{ color: emailPalette.textMuted, fontSize: 13, lineHeight: 1.5, margin: 0 }}>
        {L.outro(shop.phone ?? null)}
      </Text>
    </BrandedEmailLayout>
  );
}

export default AppointmentCancellation;
