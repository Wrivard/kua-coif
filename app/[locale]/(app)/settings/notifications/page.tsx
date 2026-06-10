import { setRequestLocale } from 'next-intl/server';
import { requireRoleInCurrentShop, requireShopMember } from '@/lib/auth/server';
import { getCurrentShopId } from '@/lib/auth/server';
import { loadNotificationsState } from './actions';
import { NotificationsClient } from './notifications-client';

export const dynamic = 'force-dynamic';

/**
 * Settings → Notifications (Phase 25). Manager+ only — defense-in-depth on
 * top of the RLS policies on `notification_automations` + the column-level
 * REVOKE on `notification_smtp_password_enc`.
 */
export default async function NotificationsPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });
  await requireRoleInCurrentShop('manager');

  const shopId = await getCurrentShopId();
  if (!shopId) {
    // requireShopMember would have redirected, but TS doesn't know that.
    return null;
  }

  const state = await loadNotificationsState(shopId);

  return <NotificationsClient locale={locale} state={state} />;
}
