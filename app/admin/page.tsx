import { redirect } from 'next/navigation';
import { defaultLocale } from '@/i18n';

// Phase H+4 — the super-admin shell now lives inside the locale-prefixed
// app shell at `/[locale]/super-admin/*` so it inherits the sidebar +
// locale switcher. Any link pointing at the legacy `/admin` URL
// (bookmarks, old email signatures, etc.) gets redirected here.
export default function AdminLegacyRedirect() {
  redirect(`/${defaultLocale}/super-admin`);
}
