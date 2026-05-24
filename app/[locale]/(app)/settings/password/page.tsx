import { setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/auth/server';
import { PasswordClient } from './password-client';

export const dynamic = 'force-dynamic';

export default async function PasswordPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  await requireUser({ locale });
  return <PasswordClient />;
}
