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
import { formatCurrencyCAD } from '@/lib/utils';

/**
 * Booking confirmation — sent to the end-customer right after a public
 * booking goes through. Rendered server-side by `@react-email/render` into
 * HTML + plaintext.
 *
 * Design tone: match the Küa dark-on-dark identity but lean lighter so the
 * email reads in light-mode clients too. Inline styles only — most email
 * clients strip <style> blocks.
 */

export type AppointmentConfirmationProps = {
  locale: 'fr' | 'en';
  shop: {
    name: string;
    /** Already-formatted single-line address — `"3857 Boul Décarie, Montréal"`. */
    addressLine?: string | null;
    phone?: string | null;
    timezone: string;
    /**
     * Phase 62b — per-shop branding. When set, the template renders the
     * shop's logo instead of the "Küa" wordmark and applies the shop's
     * accent color to the brand chip / total / outro signature so the
     * email reads like it came from THIS salon, not the platform.
     */
    emailLogoUrl?: string | null;
    emailAccentColor?: string | null;
  };
  client: {
    firstName: string;
  };
  appointment: {
    /** ISO timestamp from the DB (UTC). Formatting respects `shop.timezone`. */
    startAt: string;
    services: Array<{ name: string; durationMin: number }>;
    totalAmount: number;
    /** Optional staff name — when null we use the locale's "any pro" label. */
    professionalName: string | null;
  };
};

// Phase 62b — accent color now per-shop. The other palette tokens stay
// fixed (background + text contrast is universal); only the brand pop
// shifts to the shop's chosen hex.
const DEFAULT_ACCENT = '#8b5cf6';
function buildPalette(accentOverride?: string | null) {
  return {
    bgOuter: '#1b1b1b',
    bgCard: '#222222',
    border: '#383838',
    text: '#f5f5f5',
    textMuted: '#a0a0a0',
    accent: accentOverride ?? DEFAULT_ACCENT,
  };
}

const t = (locale: 'fr' | 'en') =>
  locale === 'fr'
    ? {
        preview: (shop: string) => `Ton rendez-vous chez ${shop} est confirmé`,
        title: 'Rendez-vous confirmé',
        hello: (n: string) => `Bonjour ${n},`,
        intro: (shop: string) => `Ton rendez-vous chez ${shop} est confirmé. Voici les détails :`,
        when: 'Quand',
        with: 'Avec',
        services: 'Services',
        total: 'Total estimé',
        anyPro: 'Premier·ère professionnel·le disponible',
        addressLabel: 'Adresse',
        phoneLabel: 'Téléphone',
        outro: 'Si tu dois reporter ou annuler, contacte directement le salon. À bientôt !',
        signature: "— L'équipe",
        minutes: 'min',
      }
    : {
        preview: (shop: string) => `Your appointment at ${shop} is confirmed`,
        title: 'Appointment confirmed',
        hello: (n: string) => `Hi ${n},`,
        intro: (shop: string) => `Your appointment at ${shop} is confirmed. Here are the details:`,
        when: 'When',
        with: 'With',
        services: 'Services',
        total: 'Estimated total',
        anyPro: 'First available professional',
        addressLabel: 'Address',
        phoneLabel: 'Phone',
        outro: 'If you need to reschedule or cancel, contact the shop directly. See you soon!',
        signature: '— The team',
        minutes: 'min',
      };

export function AppointmentConfirmation({
  locale,
  shop,
  client,
  appointment,
}: AppointmentConfirmationProps) {
  const L = t(locale);
  const palette = buildPalette(shop.emailAccentColor);
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
          {/* Brand mark — Phase 62b: shop logo if provided, else the Küa
              wordmark with the (possibly overridden) accent. Logo is
              capped at 40px height to keep the email compact across
              clients. */}
          <Section style={{ marginBottom: 24 }}>
            {shop.emailLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={shop.emailLogoUrl}
                alt={shop.name}
                height={40}
                style={{ display: 'block', height: 40, maxWidth: 200, objectFit: 'contain' }}
              />
            ) : (
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
            )}
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

          {/* When */}
          <Row label={L.when}>
            <Text style={{ color: palette.text, fontSize: 16, fontWeight: 600, margin: 0 }}>
              {formattedDate}
            </Text>
            <Text
              style={{
                color: palette.textMuted,
                fontSize: 14,
                margin: '4px 0 0',
              }}
            >
              {formattedTime}
            </Text>
          </Row>

          {/* With */}
          <Row label={L.with}>
            <Text style={{ color: palette.text, fontSize: 14, margin: 0 }}>
              {appointment.professionalName ?? L.anyPro}
            </Text>
          </Row>

          {/* Services */}
          <Row label={L.services}>
            {appointment.services.map((s, i) => (
              <Text
                key={`${s.name}-${i}`}
                style={{ color: palette.text, fontSize: 14, margin: i === 0 ? 0 : '4px 0 0' }}
              >
                {s.name}{' '}
                <span style={{ color: palette.textMuted, fontSize: 12 }}>
                  · {s.durationMin} {L.minutes}
                </span>
              </Text>
            ))}
          </Row>

          {/* Total */}
          <Row label={L.total}>
            <Text style={{ color: palette.text, fontSize: 18, fontWeight: 600, margin: 0 }}>
              {formatCurrencyCAD(appointment.totalAmount, locale)}
            </Text>
          </Row>

          <Hr
            style={{
              border: 'none',
              borderTop: `1px solid ${palette.border}`,
              margin: '24px 0',
            }}
          />

          {/* Shop contact (only when we have something useful to show) */}
          {shop.addressLine || shop.phone ? (
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

// `Row` uses the fixed muted color from the base palette — it never
// shifts per-shop (only the accent does). Inlining the hex keeps the
// Row helper independent of the per-shop palette build.
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Section style={{ marginBottom: 16 }}>
      <Text
        style={{
          color: '#a0a0a0',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.05em',
          margin: '0 0 4px',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
      {children}
    </Section>
  );
}

// Default export so React Email's preview tool can pick it up if we ever
// run `react-email dev` to iterate on the design.
export default AppointmentConfirmation;
