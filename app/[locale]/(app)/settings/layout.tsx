import type { ReactNode } from 'react';
import { SettingsSidebar } from '@/components/features/settings/settings-sidebar';

/**
 * Loop 57 — Settings shell.
 *
 * Wraps every /settings/* page with the section sub-sidebar so the 16
 * settings pages are discoverable from a single entry point. Previously
 * each page was reachable by direct URL only — `/settings/widget`,
 * `/settings/payments` etc. were orphaned from the main sidebar.
 *
 * On `md+` viewports the sub-sidebar is a persistent left rail; on
 * narrower screens it collapses into a native `<select>` rendered at
 * the top of the content area. The (app) layout's main sidebar still
 * sits to the left of this one — sub-sidebars-of-sidebars is fine here
 * because /settings is the only section with this much depth.
 */
export default async function SettingsLayout(props: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const params = await props.params;

  const { locale } = params;

  const { children } = props;

  return (
    // flex-col on mobile so the <select> stacks above the page content;
    // flex-row on md+ so the desktop sidebar sits to the left of the
    // content as a real second column. The two surfaces of the sub-
    // sidebar (mobile <select> + desktop rail) are both rendered inside
    // SettingsSidebar with hidden/md:block / md:hidden classes; CSS
    // picks the right one for the breakpoint.
    <div className="flex min-h-[calc(100vh-var(--header-h))] flex-col md:flex-row">
      <SettingsSidebar locale={locale} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
