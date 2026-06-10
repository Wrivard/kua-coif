import { setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/auth/server';
import { PasswordClient } from './password-client';

export const dynamic = 'force-dynamic';

export default async function PasswordPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireUser({ locale });
  return <PasswordClient />;
}
