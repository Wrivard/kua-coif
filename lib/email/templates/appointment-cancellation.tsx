import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import { formatHeaderDate, formatShopTime } from '@/lib/business/timezone';

/**
 * Cancellation notice — fires when an admin (or the customer via a future
 * self-service surface) cancels a booking. Sent through the standard
 * dispatcher, gated by `notification_automations.kind = 'cancellation'`.
 *
 * Keep it short: customer wants to confirm the cancel went through, not
 * read marketing copy.
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

const palette = {
  bgOuter: '#1b1b1b',
  bgCard: '#222222',
  border: '#383838',
  text: '#f5f5f5',
  textMuted: '#a0a0a0',
  danger: '#ef4444',
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
    <Html lang={locale}>
      <Head />
      <Preview>{L.preview(shop.name)}</Preview>
      <Body style={{ backgroundColor: palette.bgOuter, margin: 0, padding: '24px 0' }}>
        <Container
          style={{
            backgroundColor: palette.bgCard,
            border: `1px solid ${palette.border}`,
            borderRadius: 8,
            color: palette.text,
            fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
            margin: '0 auto',
            maxWidth: 520,
            padding: 32,
          }}
        >
          <Section style={{ marginBottom: 24 }}>
            <span
              style={{
                backgroundColor: palette.danger,
                borderRadius: 6,
                color: '#ffffff',
                display: 'inline-block',
                fontWeight: 700,
                padding: '6px 10px',
              }}
            >
              Küa
            </span>
          </Section>

          <Heading
            as="h1"
            style={{ color: palette.text, fontSize: 22, fontWeight: 600, margin: '0 0 8px' }}
          >
            {L.title}
          </Heading>
          <Text style={{ color: palette.textMuted, fontSize: 14, lineHeight: 1.5, margin: 0 }}>
            {L.hello(client.firstName)}
          </Text>
          <Text style={{ color: palette.textMuted, fontSize: 14, lineHeight: 1.5, marginTop: 4 }}>
            {L.intro(shop.name)}
          </Text>

          <Hr
            style={{
              border: 'none',
              borderTop: `1px solid ${palette.border}`,
              margin: '24px 0',
            }}
          />

          <Section style={{ marginBottom: 16 }}>
            <Label>{L.when}</Label>
            <Text
              style={{
                color: palette.text,
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
              <Label>{L.services}</Label>
              {appointment.services.map((s, i) => (
                <Text
                  key={`${s.name}-${i}`}
                  style={{
                    color: palette.textMuted,
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
              <Label>{L.reasonLabel}</Label>
              <Text
                style={{
                  borderLeft: `2px solid ${palette.border}`,
                  color: palette.text,
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
              borderTop: `1px solid ${palette.border}`,
              margin: '24px 0',
            }}
          />

          <Text style={{ color: palette.textMuted, fontSize: 13, lineHeight: 1.5, margin: 0 }}>
            {L.outro(shop.phone ?? null)}
          </Text>
          <Text style={{ color: palette.textMuted, fontSize: 13, marginTop: 16 }}>
            {L.signature} {shop.name}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        color: palette.textMuted,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.05em',
        margin: '0 0 4px',
        textTransform: 'uppercase',
      }}
    >
      {children}
    </Text>
  );
}

export default AppointmentCancellation;
