import { redirect } from 'next/navigation';

// /settings → first sub-section (Shop details), matching the Admin Dropdown default.
export default async function SettingsIndex(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  redirect(`/${locale}/settings/shop`);
}
