import { Heading, Hr, Section, Text } from '@react-email/components';
import { BrandedEmailLayout, DEFAULT_EMAIL_ACCENT, EmailLabel, emailPalette } from './branded-layout';
import { formatHeaderDate, formatShopTime } from '@/lib/business/timezone';
import { formatCurrencyCAD } from '@/lib/utils';

/**
 * Booking confirmation — sent to the end-customer right after a public
 * booking goes through. Rendered server-side by `@react-email/render` into
 * HTML + plaintext.
 *
 * Shares the `BrandedEmailLayout` header/footer with every other
 * transactional template. Per-shop white-label (Phase 62b): the shop's
 * `emailLogoUrl` / `emailAccentColor` thread through to the layout so the
 * email reads like it came from THIS salon, not the platform.
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
    /**
     * Phase G SR — full URL to the /me self-service page (signed token
     * baked in). When provided, the outro tells the customer they can
     * cancel from there instead of having to contact the salon, which
     * gives the Phase G self-cancel feature its reach. Null for walk-ins
     * or when the action couldn't mint a token.
     */
    meUrl?: string | null;
  };
};

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
        // Phase G SR — alt outro shown when a /me self-service URL is
        // included. Customer can cancel from there (with the refund
        // policy applied automatically) instead of calling the salon.
        outroWithMeUrl:
          'Tu peux annuler ou consulter tes rendez-vous depuis ton espace personnel. À bientôt !',
        manageLabel: 'Gérer mon rendez-vous',
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
        outroWithMeUrl:
          'You can cancel or view your appointments from your personal space. See you soon!',
        manageLabel: 'Manage my appointment',
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
  const accent = shop.emailAccentColor ?? DEFAULT_EMAIL_ACCENT;
  const startDate = new Date(appointment.startAt);
  const formattedDate = formatHeaderDate(startDate, locale, shop.timezone);
  const formattedTime = formatShopTime(appointment.startAt, shop.timezone, 'HH:mm');

  return (
    <BrandedEmailLayout
      locale={locale}
      previewText={L.preview(shop.name)}
      logoUrl={shop.emailLogoUrl}
      accentColor={shop.emailAccentColor}
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

      {/* When */}
      <Row label={L.when}>
        <Text style={{ color: emailPalette.text, fontSize: 16, fontWeight: 600, margin: 0 }}>
          {formattedDate}
        </Text>
        <Text
          style={{
            color: emailPalette.textMuted,
            fontSize: 14,
            margin: '4px 0 0',
          }}
        >
          {formattedTime}
        </Text>
      </Row>

      {/* With */}
      <Row label={L.with}>
        <Text style={{ color: emailPalette.text, fontSize: 14, margin: 0 }}>
          {appointment.professionalName ?? L.anyPro}
        </Text>
      </Row>

      {/* Services */}
      <Row label={L.services}>
        {appointment.services.map((s, i) => (
          <Text
            key={`${s.name}-${i}`}
            style={{ color: emailPalette.text, fontSize: 14, margin: i === 0 ? 0 : '4px 0 0' }}
          >
            {s.name}{' '}
            <span style={{ color: emailPalette.textMuted, fontSize: 12 }}>
              · {s.durationMin} {L.minutes}
            </span>
          </Text>
        ))}
      </Row>

      {/* Total */}
      <Row label={L.total}>
        <Text style={{ color: emailPalette.text, fontSize: 18, fontWeight: 600, margin: 0 }}>
          {formatCurrencyCAD(appointment.totalAmount, locale)}
        </Text>
      </Row>

      {/* Shop contact (only when we have something useful to show) */}
      {shop.addressLine || shop.phone ? (
        <>
          <Hr
            style={{
              border: 'none',
              borderTop: `1px solid ${emailPalette.border}`,
              margin: '24px 0',
            }}
          />
          <Section style={{ marginBottom: 16 }}>
            {shop.addressLine ? (
              <Text
                style={{ color: emailPalette.textMuted, fontSize: 13, lineHeight: 1.5, margin: 0 }}
              >
                <strong style={{ color: emailPalette.text }}>{L.addressLabel} ·</strong>{' '}
                {shop.addressLine}
              </Text>
            ) : null}
            {shop.phone ? (
              <Text
                style={{
                  color: emailPalette.textMuted,
                  fontSize: 13,
                  lineHeight: 1.5,
                  margin: '4px 0 0',
                }}
              >
                <strong style={{ color: emailPalette.text }}>{L.phoneLabel} ·</strong> {shop.phone}
              </Text>
            ) : null}
          </Section>
        </>
      ) : null}

      {/* Phase G SR — when the action minted a /me self-service link,
          swap the "contact the shop" outro for a self-service CTA so
          the customer can cancel/reschedule directly. The link is a
          signed URL valid 365 days; minted in bookPublicAppointment
          right after the appointment insert succeeds. */}
      {appointment.meUrl ? (
        <>
          <Text
            style={{ color: emailPalette.textMuted, fontSize: 13, lineHeight: 1.5, marginTop: 16 }}
          >
            {L.outroWithMeUrl}
          </Text>
          <Section style={{ marginTop: 12 }}>
            <a
              href={appointment.meUrl}
              style={{
                backgroundColor: accent,
                borderRadius: 6,
                color: '#ffffff',
                display: 'inline-block',
                fontSize: 14,
                fontWeight: 600,
                padding: '10px 16px',
                textDecoration: 'none',
              }}
            >
              {L.manageLabel}
            </a>
          </Section>
        </>
      ) : (
        <Text style={{ color: emailPalette.textMuted, fontSize: 13, lineHeight: 1.5, marginTop: 16 }}>
          {L.outro}
        </Text>
      )}
    </BrandedEmailLayout>
  );
}

// `Row` uses the shared muted label + a body slot. The label color never
// shifts per shop (only the accent does).
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Section style={{ marginBottom: 16 }}>
      <EmailLabel>{label}</EmailLabel>
      {children}
    </Section>
  );
}

// Default export so React Email's preview tool can pick it up if we ever
// run `react-email dev` to iterate on the design.
export default AppointmentConfirmation;
