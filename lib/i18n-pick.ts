import type { AbstractIntlMessages } from 'next-intl';

/**
 * Plan 041 (PERF-09) — pick a namespace subset out of the full message
 * catalog for a public layout's `NextIntlClientProvider`.
 *
 * The full catalog (~80KB/locale) used to embed in the HTML of EVERY
 * document load — including the mobile-first booking page and SMS-opened
 * token pages that need a handful of namespaces. Server components are
 * unaffected (getTranslations/useTranslations resolve server-side against
 * the full catalog); only 'use client' components read the provider, so a
 * layout's pick list = the namespaces its CLIENT subtree consumes.
 *
 * Paths are dot-separated ('pages.booking'); picking a path keeps its whole
 * subtree. A missing path is skipped silently (the i18n-parity test is the
 * gate for key existence, not this helper).
 */
export function pickMessages(
  messages: AbstractIntlMessages,
  namespaces: string[],
): AbstractIntlMessages {
  const out: Record<string, unknown> = {};
  for (const ns of namespaces) {
    const parts = ns.split('.');
    let src: unknown = messages;
    let valid = true;
    for (const part of parts) {
      if (src === null || typeof src !== 'object' || !(part in (src as object))) {
        valid = false;
        break;
      }
      src = (src as Record<string, unknown>)[part];
    }
    if (!valid) continue;
    // Re-create the nested shape down to the picked subtree.
    let dst = out;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const key = parts[i]!;
      dst[key] = dst[key] ?? {};
      dst = dst[key] as Record<string, unknown>;
    }
    dst[parts[parts.length - 1]!] = src;
  }
  return out as AbstractIntlMessages;
}
