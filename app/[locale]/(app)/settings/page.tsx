import { redirect } from 'next/navigation';

// /settings → first sub-section (Shop details), matching the Admin Dropdown default.
export default function SettingsIndex({ params: { locale } }: { params: { locale: string } }) {
  redirect(`/${locale}/settings/shop`);
}
