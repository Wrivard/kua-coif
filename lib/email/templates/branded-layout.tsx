import { Body, Container, Head, Hr, Html, Preview, Section, Text } from '@react-email/components';
import type { ReactNode } from 'react';

/**
 * Shared branded shell for ALL transactional emails. One header + one
 * footer treatment so every message — confirmation, reminder,
 * cancellation, birthday, review, win-back, waitlist — reads as ONE
 * identity in the inbox.
 *
 * White-label (Phase 62b): pass the shop's `logoUrl` to render its logo
 * instead of the "Küa" wordmark, and `accentColor` to recolor the brand
 * chip. Both fall back to the platform defaults when null/undefined, so
 * templates that don't carry per-shop branding still look identical to
 * the ones that do — they just show the Küa wordmark + #8b5cf6.
 *
 * Inline styles only — most email clients strip <style> blocks. The
 * surface/text palette is fixed (universal contrast); only the accent
 * shifts per shop.
 *
 * Copy convention: emails do NOT use next-intl. Each template keeps its
 * own inline bilingual `copy(locale)` helper and feeds the resolved
 * strings (preview, footer signature) into this layout as props.
 */

export const DEFAULT_EMAIL_ACCENT = '#8b5cf6';

export const emailPalette = {
  bgOuter: '#1b1b1b',
  bgCard: '#222222',
  border: '#383838',
  text: '#f5f5f5',
  textMuted: '#a0a0a0',
} as const;

export type BrandedEmailLayoutProps = {
  locale: 'fr' | 'en';
  /** Inbox preview line (already localized by the template). */
  previewText: string;
  /** Per-shop logo URL. When set, replaces the "Küa" wordmark. */
  logoUrl?: string | null;
  /** Per-shop accent hex. Falls back to the Küa purple. */
  accentColor?: string | null;
  /**
   * Alt text for the logo image (typically the shop name). Falls back to
   * "Küa" so the brand mark is never unlabeled.
   */
  brandName?: string | null;
  /** Localized footer signature line, e.g. "— The team". */
  signature: string;
  /** Shop name shown under the signature, in the accent color. */
  shopName: string;
  /**
   * Optional localized fine-print shown above the signature (e.g. the
   * waitlist "why you got this" note). Consistent placement across
   * templates that need it; omitted otherwise.
   */
  footnote?: string | null;
  children: ReactNode;
};

/**
 * Brand mark — shop logo if provided, else the "Küa" wordmark on the
 * (possibly overridden) accent chip. Logo is capped at 40px height to
 * keep the email compact across clients.
 */
function BrandMark({
  logoUrl,
  accent,
  brandName,
}: {
  logoUrl?: string | null;
  accent: string;
  brandName?: string | null;
}) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={brandName ?? 'Küa'}
        height={40}
        style={{ display: 'block', height: 40, maxWidth: 200, objectFit: 'contain' }}
      />
    );
  }
  return (
    <span
      style={{
        backgroundColor: accent,
        borderRadius: 6,
        color: '#ffffff',
        display: 'inline-block',
        fontWeight: 700,
        padding: '6px 10px',
      }}
    >
      Küa
    </span>
  );
}

export function BrandedEmailLayout({
  locale,
  previewText,
  logoUrl,
  accentColor,
  brandName,
  signature,
  shopName,
  footnote,
  children,
}: BrandedEmailLayoutProps) {
  const accent = accentColor ?? DEFAULT_EMAIL_ACCENT;

  return (
    <Html lang={locale}>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={{ backgroundColor: emailPalette.bgOuter, margin: 0, padding: '24px 0' }}>
        <Container
          style={{
            backgroundColor: emailPalette.bgCard,
            border: `1px solid ${emailPalette.border}`,
            borderRadius: 8,
            color: emailPalette.text,
            fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
            margin: '0 auto',
            maxWidth: 520,
            padding: 32,
          }}
        >
          {/* Header — same brand mark everywhere */}
          <Section style={{ marginBottom: 24 }}>
            <BrandMark logoUrl={logoUrl} accent={accent} brandName={brandName} />
          </Section>

          {children}

          {/* Footer — same treatment everywhere */}
          <Hr
            style={{
              border: 'none',
              borderTop: `1px solid ${emailPalette.border}`,
              margin: '24px 0',
            }}
          />
          {footnote ? (
            <Text
              style={{
                color: emailPalette.textMuted,
                fontSize: 11,
                lineHeight: 1.5,
                margin: '0 0 12px',
              }}
            >
              {footnote}
            </Text>
          ) : null}
          <Text style={{ color: emailPalette.textMuted, fontSize: 13, margin: 0 }}>
            {signature}
          </Text>
          <Text
            style={{
              color: accent,
              fontSize: 13,
              fontWeight: 600,
              margin: '4px 0 0',
            }}
          >
            {shopName}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

/**
 * Shared section label — the uppercase muted caption used above each
 * detail row. Inlined fixed muted color (never shifts per shop).
 */
export function EmailLabel({ children }: { children: ReactNode }) {
  return (
    <Text
      style={{
        color: emailPalette.textMuted,
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
