'use client';

import Link from 'next/link';
import { Check, ChevronRight, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

type Step = {
  key: 'shop' | 'hours' | 'services' | 'barbers';
  done: boolean;
  href: string;
};

/**
 * OnboardingCard — Phase 45.
 *
 * Shown above the calendar on the home page when the shop's setup is
 * incomplete. Each row is a step: "Add your services", "Invite barbers",
 * etc. Done steps get a checkmark; pending steps render as a link to the
 * settings page where the action lives.
 *
 * Disappears entirely once every step is checked. Calendar-only — we
 * deliberately don't surface it on /clients or other CRUD pages so the
 * shop owner can hide it just by doing the setup work.
 *
 * The "completion" booleans are computed server-side by the calendar
 * page and passed in as props — keeps this component pure + cheap to
 * re-render.
 */
type Props = {
  locale: string;
  shopAddressFilled: boolean;
  hoursConfigured: boolean;
  servicesCount: number;
  barbersCount: number;
};

export function OnboardingCard({
  locale,
  shopAddressFilled,
  hoursConfigured,
  servicesCount,
  barbersCount,
}: Props) {
  const t = useTranslations('onboarding');

  const steps: Step[] = [
    {
      key: 'shop',
      done: shopAddressFilled,
      href: `/${locale}/settings/shop`,
    },
    {
      key: 'hours',
      done: hoursConfigured,
      href: `/${locale}/settings/shop`,
    },
    {
      key: 'services',
      done: servicesCount > 0,
      href: `/${locale}/services`,
    },
    {
      key: 'barbers',
      done: barbersCount > 0,
      href: `/${locale}/barbers`,
    },
  ];

  // Hide entirely when complete — by the time a shop has barbers +
  // services + hours + address, they don't need this card anymore.
  const allDone = steps.every((s) => s.done);
  if (allDone) return null;

  const doneCount = steps.filter((s) => s.done).length;
  const progress = Math.round((doneCount / steps.length) * 100);

  return (
    <div className="border-accent/20 rounded-lg border bg-accent-subtle p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-sm font-semibold text-text-primary">{t('title')}</p>
            <p className="mt-0.5 text-xs text-text-secondary">{t('subtitle', { progress })}</p>
          </div>
          <ul className="space-y-1.5">
            {steps.map((step) => (
              <li key={step.key}>
                <Link
                  href={step.href}
                  aria-disabled={step.done}
                  onClick={(e) => {
                    if (step.done) e.preventDefault();
                  }}
                  className={cn(
                    'group flex items-center gap-3 rounded px-2 py-1.5 text-sm transition-colors',
                    step.done
                      ? 'text-text-muted'
                      : 'hover:bg-bg-surface-2/60 text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                      step.done
                        ? 'bg-success/15 border-success text-success'
                        : 'border-border bg-bg-surface',
                    )}
                  >
                    {step.done ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span className="flex-1 truncate">{t(`steps.${step.key}`)}</span>
                  {!step.done ? (
                    <ChevronRight className="h-4 w-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5" />
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
