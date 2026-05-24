'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarCheck, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldHint, Input, Label, Textarea } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/phone-input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { cn, formatCurrencyCAD } from '@/lib/utils';
import { addDays, formatHeaderDate, shopIsoDate } from '@/lib/business/timezone';
import type { BarberRow, ServiceCategoryRow, ServiceRow } from '@/db/rows';
import { bookPublicAppointment } from './actions';

export type BookingShop = {
  id: string;
  name: string;
  alias: string | null;
  description: string | null;
  timezone: string;
  date_format: 'USA' | 'EU';
  allow_booking_any_barber: boolean;
  country: string | null;
  street: string | null;
  municipality: string | null;
  province: string | null;
  postal_code: string | null;
};

export type BookingHours = {
  weekday: number;
  enabled: boolean;
  open_time: string | null;
  close_time: string | null;
};

type WizardState = {
  step: 1 | 2 | 3 | 4 | 5;
  serviceIds: string[];
  barberId: string | 'any' | null;
  date: string;
  startTime: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  notes: string;
  hp: string; // honeypot
};

type Props = {
  locale: string;
  shopSlug: string;
  shop: BookingShop;
  hours: BookingHours[];
  daysOff: string[];
  barbers: BarberRow[];
  services: ServiceRow[];
  categories: ServiceCategoryRow[];
};

const STEPS: Array<{
  id: WizardState['step'];
  key: 'service' | 'barber' | 'slot' | 'contact' | 'done';
}> = [
  { id: 1, key: 'service' },
  { id: 2, key: 'barber' },
  { id: 3, key: 'slot' },
  { id: 4, key: 'contact' },
  { id: 5, key: 'done' },
];

export function BookingWizard({
  locale,
  shopSlug,
  shop,
  hours,
  daysOff,
  barbers,
  services,
  categories,
}: Props) {
  const t = useTranslations('pages.booking');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  const today = useMemo(() => shopIsoDate(new Date(), shop.timezone), [shop.timezone]);
  const [state, setState] = useState<WizardState>({
    step: 1,
    serviceIds: [],
    barberId: shop.allow_booking_any_barber ? 'any' : null,
    date: today,
    startTime: null,
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    notes: '',
    hp: '',
  });

  const selectedServices = services.filter((s) => state.serviceIds.includes(s.id));
  const totalDuration = selectedServices.reduce((sum, s) => sum + s.duration_min, 0);
  const totalPrice = selectedServices.reduce((sum, s) => sum + s.price, 0);

  // Group services by category for the multi-select.
  const servicesByCategory = useMemo(() => {
    const m = new Map<string, ServiceRow[]>();
    for (const s of services) {
      const k = s.category_id ?? '';
      const list = m.get(k) ?? [];
      list.push(s);
      m.set(k, list);
    }
    return m;
  }, [services]);

  // Slot state — fetched from /api/book/[shopSlug]/slots when entering step 3.
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slotLoading, setSlotLoading] = useState(false);

  useEffect(() => {
    if (state.step !== 3) return;
    setSlots(null);
    setSlotLoading(true);
    const ctl = new AbortController();
    fetch(
      `/api/book/${shopSlug}/slots?date=${state.date}&barber=${state.barberId ?? 'any'}&duration=${totalDuration}`,
      { signal: ctl.signal },
    )
      .then((r) => r.json())
      .then((data: { slots?: string[] }) => setSlots(data.slots ?? []))
      .catch(() => setSlots([]))
      .finally(() => setSlotLoading(false));
    return () => ctl.abort();
  }, [state.step, state.date, state.barberId, shopSlug, totalDuration]);

  function next() {
    setState((s) => ({ ...s, step: Math.min(5, s.step + 1) as WizardState['step'] }));
  }
  function back() {
    setState((s) => ({ ...s, step: Math.max(1, s.step - 1) as WizardState['step'] }));
  }

  const canAdvance = (() => {
    switch (state.step) {
      case 1:
        return state.serviceIds.length > 0;
      case 2:
        return state.barberId !== null;
      case 3:
        return state.startTime !== null;
      case 4:
        return state.firstName.trim().length > 0 && state.phone.trim().length >= 7;
      default:
        return false;
    }
  })();

  function submit() {
    if (!state.startTime) return;
    startTransition(async () => {
      const result = await bookPublicAppointment({
        shop_slug: shopSlug,
        barber_id: state.barberId === 'any' ? null : state.barberId,
        service_ids: state.serviceIds,
        date: state.date,
        start_time: state.startTime,
        first_name: state.firstName,
        last_name: state.lastName,
        email: state.email,
        phone: state.phone,
        notes: state.notes,
        hp: state.hp,
      });
      if (result.ok) {
        setState((s) => ({ ...s, step: 5 }));
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold text-text-primary">{shop.name}</h1>
        {shop.street && shop.municipality ? (
          <p className="text-xs text-text-muted">
            {shop.street} · {shop.municipality}
            {shop.province ? `, ${shop.province}` : ''}
          </p>
        ) : null}
      </header>

      {/* Progress chips */}
      <ol className="flex items-center justify-center gap-1.5">
        {STEPS.map((step) => (
          <li
            key={step.id}
            className={cn(
              'h-1.5 w-10 rounded-full transition-colors',
              state.step > step.id || state.step === step.id ? 'bg-accent' : 'bg-bg-surface-2',
            )}
            aria-hidden
          />
        ))}
      </ol>

      <div className="rounded border border-border bg-bg-surface p-5 sm:p-6">
        {/* ─── Step 1: services ──────────────────────────────────────── */}
        {state.step === 1 && (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold">{t('steps.service.title')}</h2>
            <p className="text-sm text-text-secondary">{t('steps.service.help')}</p>
            <div className="space-y-4">
              {[...servicesByCategory.entries()].map(([catId, list]) => {
                const cat = categories.find((c) => c.id === catId);
                return (
                  <div key={catId || 'none'}>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                      {cat?.name ?? t('steps.service.uncategorized')}
                    </p>
                    <div className="space-y-1">
                      {list.map((s) => {
                        const checked = state.serviceIds.includes(s.id);
                        return (
                          <label
                            key={s.id}
                            className={cn(
                              'flex cursor-pointer items-center justify-between gap-3 rounded border border-border bg-bg-base px-3 py-2 transition-colors',
                              checked && 'border-accent bg-accent-subtle',
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <Checkbox
                                checked={checked}
                                onChange={(e) => {
                                  setState((st) => ({
                                    ...st,
                                    serviceIds: e.target.checked
                                      ? [...st.serviceIds, s.id]
                                      : st.serviceIds.filter((id) => id !== s.id),
                                  }));
                                }}
                              />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{s.name}</p>
                                <p className="text-[11px] text-text-muted">{s.duration_min} min</p>
                              </div>
                            </div>
                            <span className="shrink-0 text-sm font-semibold">
                              {formatCurrencyCAD(s.price, locale === 'fr' ? 'fr' : 'en')}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ─── Step 2: barber ────────────────────────────────────────── */}
        {state.step === 2 && (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold">{t('steps.barber.title')}</h2>
            <div className="space-y-2">
              {shop.allow_booking_any_barber ? (
                <BarberOption
                  selected={state.barberId === 'any'}
                  onSelect={() => setState((s) => ({ ...s, barberId: 'any' }))}
                  title={t('steps.barber.any')}
                  subtitle={t('steps.barber.anyHint')}
                />
              ) : null}
              {barbers.map((b) => (
                <BarberOption
                  key={b.id}
                  selected={state.barberId === b.id}
                  onSelect={() => setState((s) => ({ ...s, barberId: b.id }))}
                  title={b.display_name}
                  subtitle=""
                />
              ))}
            </div>
          </section>
        )}

        {/* ─── Step 3: date + slot ───────────────────────────────────── */}
        {state.step === 3 && (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold">{t('steps.slot.title')}</h2>
            <DateStrip
              value={state.date}
              onChange={(d) => setState((s) => ({ ...s, date: d, startTime: null }))}
              timezone={shop.timezone}
              locale={locale === 'fr' ? 'fr' : 'en'}
              hours={hours}
              daysOff={daysOff}
            />
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                {t('steps.slot.times')}
              </p>
              {slotLoading ? (
                <div className="grid grid-cols-3 gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-9" />
                  ))}
                </div>
              ) : !slots || slots.length === 0 ? (
                <p className="rounded border border-border bg-bg-base p-4 text-center text-sm text-text-muted">
                  {t('steps.slot.empty')}
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {slots.map((time) => {
                    const active = state.startTime === time;
                    return (
                      <button
                        key={time}
                        type="button"
                        onClick={() => setState((s) => ({ ...s, startTime: time }))}
                        className={cn(
                          'h-9 rounded border text-sm font-medium transition-colors',
                          active
                            ? 'border-accent bg-accent text-accent-fg'
                            : 'border-border bg-bg-base hover:bg-bg-surface-2',
                        )}
                      >
                        {time}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ─── Step 4: contact info ─────────────────────────────────── */}
        {state.step === 4 && (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold">{t('steps.contact.title')}</h2>
            <p className="text-sm text-text-secondary">{t('steps.contact.help')}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="first_name" required>
                  {t('steps.contact.firstName')}
                </Label>
                <Input
                  id="first_name"
                  autoComplete="given-name"
                  value={state.firstName}
                  onChange={(e) => setState((s) => ({ ...s, firstName: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="last_name">{t('steps.contact.lastName')}</Label>
                <Input
                  id="last_name"
                  autoComplete="family-name"
                  value={state.lastName}
                  onChange={(e) => setState((s) => ({ ...s, lastName: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="phone" required>
                  {t('steps.contact.phone')}
                </Label>
                <PhoneInput
                  id="phone"
                  value={state.phone}
                  onChange={(e) => setState((s) => ({ ...s, phone: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="email">{t('steps.contact.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={state.email}
                  onChange={(e) => setState((s) => ({ ...s, email: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="notes">{t('steps.contact.notes')}</Label>
                <Textarea
                  id="notes"
                  rows={2}
                  value={state.notes}
                  onChange={(e) => setState((s) => ({ ...s, notes: e.target.value }))}
                />
                <FieldHint>{t('steps.contact.notesHint')}</FieldHint>
              </div>
            </div>
            {/* Honeypot — visually hidden but present in the DOM. */}
            <input
              type="text"
              name="hp"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              value={state.hp}
              onChange={(e) => setState((s) => ({ ...s, hp: e.target.value }))}
              className="hidden"
            />

            {/* Summary card */}
            <div className="rounded border border-border bg-bg-base p-3 text-sm">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                {t('summary.title')}
              </p>
              <p className="font-medium">{selectedServices.map((s) => s.name).join(' + ')}</p>
              <p className="text-xs text-text-secondary">
                {totalDuration} min · {formatCurrencyCAD(totalPrice, locale === 'fr' ? 'fr' : 'en')}
              </p>
              <p className="text-xs text-text-secondary">
                {formatHeaderDate(
                  new Date(`${state.date}T12:00:00Z`),
                  locale === 'fr' ? 'fr' : 'en',
                  shop.timezone,
                )}{' '}
                · {state.startTime}
              </p>
            </div>
          </section>
        )}

        {/* ─── Step 5: confirmation ─────────────────────────────────── */}
        {state.step === 5 && (
          <section className="space-y-4 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
            <h2 className="text-xl font-semibold">{t('done.title')}</h2>
            <p className="text-sm text-text-secondary">{t('done.description')}</p>
            <div className="rounded border border-border bg-bg-base p-3 text-left text-sm">
              <p className="font-medium">{selectedServices.map((s) => s.name).join(' + ')}</p>
              <p className="text-xs text-text-secondary">
                {formatHeaderDate(
                  new Date(`${state.date}T12:00:00Z`),
                  locale === 'fr' ? 'fr' : 'en',
                  shop.timezone,
                )}{' '}
                · {state.startTime}
              </p>
              <p className="text-xs text-text-secondary">
                {formatCurrencyCAD(totalPrice, locale === 'fr' ? 'fr' : 'en')}
              </p>
            </div>
          </section>
        )}

        {/* ─── Step nav ─────────────────────────────────────────────── */}
        {state.step < 5 && (
          <div className="mt-6 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={back}
              disabled={state.step === 1 || isPending}
            >
              <ChevronLeft className="h-4 w-4" /> {t('back')}
            </Button>
            {state.step < 4 ? (
              <Button type="button" onClick={next} disabled={!canAdvance || isPending}>
                {t('continue')} <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button type="button" onClick={submit} disabled={!canAdvance} loading={isPending}>
                <CalendarCheck className="h-4 w-4" /> {t('confirm')}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Running subtotal at the bottom for small screens */}
      {state.step < 4 && selectedServices.length > 0 ? (
        <div className="rounded border border-border bg-bg-surface px-4 py-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">
              {selectedServices.length} {t('summary.servicesLabel')}
            </span>
            <span className="font-semibold">
              {formatCurrencyCAD(totalPrice, locale === 'fr' ? 'fr' : 'en')}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-text-muted">
            {totalDuration} {t('summary.minutes')}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function BarberOption({
  selected,
  onSelect,
  title,
  subtitle,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center justify-between rounded border px-4 py-3 text-left transition-colors',
        selected
          ? 'border-accent bg-accent-subtle'
          : 'border-border bg-bg-base hover:bg-bg-surface-2',
      )}
    >
      <div>
        <p className="font-medium">{title}</p>
        {subtitle ? <p className="text-xs text-text-muted">{subtitle}</p> : null}
      </div>
      {selected ? <Badge variant="accent">●</Badge> : null}
    </button>
  );
}

function DateStrip({
  value,
  onChange,
  timezone,
  locale,
  hours,
  daysOff,
}: {
  value: string;
  onChange: (date: string) => void;
  timezone: string;
  locale: 'fr' | 'en';
  hours: BookingHours[];
  daysOff: string[];
}) {
  const today = shopIsoDate(new Date(), timezone);
  const days = useMemo(() => {
    const refDay = new Date(`${today}T12:00:00Z`);
    return Array.from({ length: 14 }, (_, i) => {
      const d = addDays(refDay, i);
      const iso = shopIsoDate(d, timezone);
      const weekday = new Date(`${iso}T00:00:00`).getDay();
      const h = hours.find((hh) => hh.weekday === weekday);
      const closed = !h?.enabled || daysOff.includes(iso);
      return { iso, weekday, closed };
    });
  }, [today, timezone, hours, daysOff]);

  return (
    <div className="-mx-2 flex gap-2 overflow-x-auto px-2 pb-1">
      {days.map((d) => {
        const active = d.iso === value;
        return (
          <button
            key={d.iso}
            type="button"
            disabled={d.closed}
            onClick={() => onChange(d.iso)}
            className={cn(
              'flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded border transition-colors',
              active
                ? 'border-accent bg-accent text-accent-fg'
                : 'border-border bg-bg-base hover:bg-bg-surface-2',
              d.closed && 'cursor-not-allowed opacity-40',
            )}
          >
            <span className="text-[10px] uppercase">
              {new Date(`${d.iso}T12:00:00Z`).toLocaleDateString(
                locale === 'fr' ? 'fr-CA' : 'en-CA',
                {
                  weekday: 'short',
                  timeZone: timezone,
                },
              )}
            </span>
            <span className="text-base font-semibold">
              {new Date(`${d.iso}T12:00:00Z`).toLocaleDateString(
                locale === 'fr' ? 'fr-CA' : 'en-CA',
                {
                  day: 'numeric',
                  timeZone: timezone,
                },
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
