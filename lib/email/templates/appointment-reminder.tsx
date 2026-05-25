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
 * Appointment reminder — 24h or 1h before. Both variants use the same
 * layout; the `kind` prop swaps the headline, preview, and "in X" copy.
 *
 * Phase 25c's cron picks which variant to send based on time-to-appointment:
 *   - between 23h45 and 24h15 from now → kind = 'reminder_24h'
 *   - between 0h45 and 1h15 from now   → kind = 'reminder_1h'
 *
 * The 1h reminder is intentionally short — at that point the customer just
 * needs the time + address, not the full receipt.
 */

export type AppointmentReminderProps = {
  locale: 'fr' | 'en';
  kind: 'reminder_24h' | 'reminder_1h';
  shop: {
    name: string;
    addressLine?: string | null;
    phone?: string | null;
    timezone: string;
  };
  client: {
    firstName: string;
  };
  appointment: {
    startAt: string;
    services: Array<{ name: string }>;
    professionalName: string | null;
  };
};

const palette = {
  bgOuter: '#1b1b1b',
  bgCard: '#222222',
  border: '#383838',
  text: '#f5f5f5',
  textMuted: '#a0a0a0',
  accent: '#8b5cf6',
};

const copy = (locale: 'fr' | 'en', kind: AppointmentReminderProps['kind']) => {
  const is24 = kind === 'reminder_24h';
  if (locale === 'fr') {
    return {
      preview: is24 ? 'Ton rendez-vous est demain' : 'Ton rendez-vous est dans 1 heure',
      title: is24 ? 'Rappel — demain' : 'Rappel — dans 1 heure',
      hello: (n: string) => `Bonjour ${n},`,
      intro: is24
        ? "C'est un petit rappel : tu as un rendez-vous demain. Voici les détails :"
        : 'Ton rendez-vous est dans une heure. À tout de suite !',
      when: 'Quand',
      with: 'Avec',
      services: 'Services',
      anyPro: 'Premier·ère professionnel·le disponible',
      addressLabel: 'Adresse',
      phoneLabel: 'Téléphone',
      outro: is24
        ? 'Si tu dois reporter ou annuler, contacte directement le salon dès maintenant.'
        : 'À très bientôt !',
      signature: "— L'équipe",
    };
  }
  return {
    preview: is24 ? 'Your appointment is tomorrow' : 'Your appointment is in 1 hour',
    title: is24 ? 'Reminder — tomorrow' : 'Reminder — in 1 hour',
    hello: (n: string) => `Hi ${n},`,
    intro: is24
      ? 'Quick reminder: you have an appointment tomorrow. Here are the details:'
      : 'Your appointment is in one hour. See you soon!',
    when: 'When',
    with: 'With',
    services: 'Services',
    anyPro: 'First available professional',
    addressLabel: 'Address',
    phoneLabel: 'Phone',
    outro: is24
      ? 'If you need to reschedule or cancel, contact the shop now.'
      : 'See you very soon!',
    signature: '— The team',
  };
};

export function AppointmentReminder({
  locale,
  kind,
  shop,
  client,
  appointment,
}: AppointmentReminderProps) {
  const L = copy(locale, kind);
  const startDate = new Date(appointment.startAt);
  const formattedDate = formatHeaderDate(startDate, locale, shop.timezone);
  const formattedTime = formatShopTime(appointment.startAt, shop.timezone, 'HH:mm');

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
            margin: '0 auto',
            maxWidth: 520,
            padding: 32,
          }}
        >
          <Section style={{ marginBottom: 24 }}>
            <span
              style={{
                backgroundColor: palette.accent,
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
            {L.intro}
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
            <Text style={{ color: palette.text, fontSize: 16, fontWeight: 600, margin: 0 }}>
              {formattedDate}
            </Text>
            <Text style={{ color: palette.textMuted, fontSize: 14, margin: '4px 0 0' }}>
              {formattedTime}
            </Text>
          </Section>

          <Section style={{ marginBottom: 16 }}>
            <Label>{L.with}</Label>
            <Text style={{ color: palette.text, fontSize: 14, margin: 0 }}>
              {appointment.professionalName ?? L.anyPro}{' '}
              <span style={{ color: palette.textMuted, fontSize: 13 }}>@ {shop.name}</span>
            </Text>
          </Section>

          {/* The 1h reminder skips the full service list — only show on 24h
              where the customer might double-check before heading out. */}
          {kind === 'reminder_24h' && appointment.services.length > 0 ? (
            <Section style={{ marginBottom: 16 }}>
              <Label>{L.services}</Label>
              {appointment.services.map((s, i) => (
                <Text
                  key={`${s.name}-${i}`}
                  style={{ color: palette.text, fontSize: 14, margin: i === 0 ? 0 : '4px 0 0' }}
                >
                  {s.name}
                </Text>
              ))}
            </Section>
          ) : null}

          {shop.addressLine || shop.phone ? (
            <>
              <Hr
                style={{
                  border: 'none',
                  borderTop: `1px solid ${palette.border}`,
                  margin: '24px 0',
                }}
              />
              <Section style={{ marginBottom: 16 }}>
                {shop.addressLine ? (
                  <Text
                    style={{ color: palette.textMuted, fontSize: 13, lineHeight: 1.5, margin: 0 }}
                  >
                    <strong style={{ color: palette.text }}>{L.addressLabel} ·</strong>{' '}
                    {shop.addressLine}
                  </Text>
                ) : null}
                {shop.phone ? (
                  <Text
                    style={{
                      color: palette.textMuted,
                      fontSize: 13,
                      lineHeight: 1.5,
                      margin: '4px 0 0',
                    }}
                  >
                    <strong style={{ color: palette.text }}>{L.phoneLabel} ·</strong> {shop.phone}
                  </Text>
                ) : null}
              </Section>
            </>
          ) : null}

          <Text style={{ color: palette.textMuted, fontSize: 13, lineHeight: 1.5, marginTop: 16 }}>
            {L.outro}
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

export default AppointmentReminder;
