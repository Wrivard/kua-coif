'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  CalendarCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Moon,
  Plus,
  Sun,
  Sunset,
  UserCircle2,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldHint, Input, Label, Textarea } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/phone-input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { cn, formatCurrencyCAD } from '@/lib/utils';
import { addDays, formatHeaderDate, shopIsoDate } from '@/lib/business/timezone';
import type { WidgetConfig } from '@/lib/business/widget-config';
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
  /**
   * Per-shop widget overrides — passed by the embed route. When omitted, the
   * wizard uses the public-booking defaults (service-first, no add-on banner,
   * etc.). See `lib/business/widget-config.ts`.
   */
  widgetConfig?: WidgetConfig;
};

// Five progress chips, regardless of which of {service, barber} comes first.
const PROGRESS_CHIP_COUNT = 5;

/**
 * Group a flat array of "HH:MM" time strings into morning / afternoon /
 * evening buckets so the slot picker can show ☀ / ☼ / 🌙 sections (spec §3.4).
 * Times are interpreted in the shop's local clock, so the cut-offs are
 * fixed: <11:00 morning, 11:00–17:00 afternoon, ≥17:00 evening.
 */
function groupSlotsByTimeOfDay(slots: string[]): {
  morning: string[];
  afternoon: string[];
  evening: string[];
} {
  const morning: string[] = [];
  const afternoon: string[] = [];
  const evening: string[] = [];
  for (const time of slots) {
    const hour = Number(time.split(':')[0] ?? '0');
    if (hour < 11) morning.push(time);
    else if (hour < 17) afternoon.push(time);
    else evening.push(time);
  }
  return { morning, afternoon, evening };
}

export function BookingWizard({
  locale,
  shopSlug,
  shop,
  hours,
  daysOff,
  barbers,
  services,
  categories,
  widgetConfig,
}: Props) {
  const t = useTranslations('pages.booking');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  // ── Step ordering ──────────────────────────────────────────────────────
  // The widget config can flip the first two steps: when `show_professional_first`
  // is on, step 1 = barber picker and step 2 = service picker (Squire-style).
  // Otherwise (default), step 1 = service picker, step 2 = barber picker.
  const isProFirst = widgetConfig?.show_professional_first ?? false;
  const step1Kind: 'service' | 'barber' = isProFirst ? 'barber' : 'service';
  const step2Kind: 'service' | 'barber' = isProFirst ? 'service' : 'barber';
  function kindForStep(
    step: WizardState['step'],
  ): 'service' | 'barber' | 'slot' | 'contact' | 'done' {
    if (step === 1) return step1Kind;
    if (step === 2) return step2Kind;
    if (step === 3) return 'slot';
    if (step === 4) return 'contact';
    return 'done';
  }

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
  const selectedBarber =
    state.barberId && state.barberId !== 'any'
      ? barbers.find((b) => b.id === state.barberId)
      : null;
  const allowMultiService = widgetConfig?.allow_multi_service ?? true;

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
    const kind = kindForStep(state.step);
    if (kind === 'service') return state.serviceIds.length > 0;
    if (kind === 'barber') return state.barberId !== null;
    if (kind === 'slot') return state.startTime !== null;
    if (kind === 'contact') {
      return state.firstName.trim().length > 0 && state.phone.trim().length >= 7;
    }
    return false;
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

      {/* Progress chips — five segments, one per step. The mapping of "step
          number" → semantic kind is computed by `kindForStep` so the chip
          count stays constant regardless of step ordering. */}
      <ol className="flex items-center justify-center gap-1.5">
        {Array.from({ length: PROGRESS_CHIP_COUNT }, (_, i) => i + 1).map((id) => (
          <li
            key={id}
            className={cn(
              'h-1.5 w-10 rounded-full transition-colors',
              state.step >= id ? 'bg-accent' : 'bg-bg-surface-2',
            )}
            aria-hidden
          />
        ))}
      </ol>

      <div className="rounded border border-border bg-bg-surface p-5 sm:p-6">
        {/* ─── Step 1 & 2 — order depends on `show_professional_first` ── */}
        {state.step <= 2 && kindForStep(state.step) === 'service' && (
          <ServiceStep
            t={t}
            locale={locale}
            services={services}
            servicesByCategory={servicesByCategory}
            categories={categories}
            selectedServices={selectedServices}
            allowMultiService={allowMultiService}
            onToggle={(id) => {
              setState((st) => ({
                ...st,
                serviceIds: st.serviceIds.includes(id)
                  ? st.serviceIds.filter((x) => x !== id)
                  : allowMultiService
                    ? [...st.serviceIds, id]
                    : [id],
              }));
            }}
            onRemove={(id) =>
              setState((st) => ({
                ...st,
                serviceIds: st.serviceIds.filter((x) => x !== id),
              }))
            }
          />
        )}

        {state.step <= 2 && kindForStep(state.step) === 'barber' && (
          <BarberStep
            t={t}
            shop={shop}
            barbers={barbers}
            selectedBarberId={state.barberId}
            onSelect={(id) => setState((s) => ({ ...s, barberId: id }))}
          />
        )}

        {/* ─── Step 3: date + slot ───────────────────────────────────── */}
        {state.step === 3 && (
          <section className="space-y-4">
            {/* §3.3 — "Your order" recap card. Renders once a service is
                picked; gives the customer something concrete to anchor on
                while they pick a date. */}
            {selectedServices.length > 0 ? (
              <OrderRecap
                t={t}
                locale={locale}
                barber={selectedBarber}
                isAnyBarber={state.barberId === 'any'}
                services={selectedServices}
                totalPrice={totalPrice}
                totalDuration={totalDuration}
              />
            ) : null}

            <h2 className="text-lg font-semibold">{t('steps.slot.title')}</h2>
            <DateStrip
              value={state.date}
              onChange={(d) => setState((s) => ({ ...s, date: d, startTime: null }))}
              timezone={shop.timezone}
              locale={locale === 'fr' ? 'fr' : 'en'}
              hours={hours}
              daysOff={daysOff}
            />
            <SlotPicker
              t={t}
              loading={slotLoading}
              slots={slots}
              selected={state.startTime}
              onSelect={(time) => setState((s) => ({ ...s, startTime: time }))}
            />
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

// ---------------------------------------------------------------------------
// Step body sub-components
// ---------------------------------------------------------------------------

type TranslatorFn = ReturnType<typeof useTranslations<'pages.booking'>>;

/**
 * §3.2 — Service picker with a "selected" banner at the top + an "Anything to
 * add?" section below for the remaining services. When the widget config has
 * `allow_multi_service: false`, picking a new service replaces the previous
 * one (the `onToggle` caller handles that semantic).
 */
function ServiceStep({
  t,
  locale,
  services,
  servicesByCategory,
  categories,
  selectedServices,
  allowMultiService,
  onToggle,
  onRemove,
}: {
  t: TranslatorFn;
  locale: string;
  services: ServiceRow[];
  servicesByCategory: Map<string, ServiceRow[]>;
  categories: ServiceCategoryRow[];
  selectedServices: ServiceRow[];
  allowMultiService: boolean;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const hasSelection = selectedServices.length > 0;
  // Filter out already-selected services from the "add-on" list to declutter.
  const remainingByCategory = useMemo(() => {
    const selectedIds = new Set(selectedServices.map((s) => s.id));
    const m = new Map<string, ServiceRow[]>();
    for (const [catId, list] of servicesByCategory) {
      const filtered = list.filter((s) => !selectedIds.has(s.id));
      if (filtered.length > 0) m.set(catId, filtered);
    }
    return m;
  }, [servicesByCategory, selectedServices]);
  void services; // unused but kept in the signature for future extension

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">{t('steps.service.title')}</h2>
      <p className="text-sm text-text-secondary">{t('steps.service.help')}</p>

      {/* "Primary" banner — shows the user's current picks. Each pill has an X
          to remove. We don't single out a "primary" item visually (the data
          model treats services equally); the banner conveys what's locked in. */}
      {hasSelection ? (
        <div className="border-accent/40 rounded border bg-accent-subtle p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-accent">
            {allowMultiService ? t('steps.service.selectedPlural') : t('steps.service.selected')}
          </p>
          <ul className="mt-2 space-y-1">
            {selectedServices.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded bg-bg-base px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{s.name}</p>
                  <p className="text-[11px] text-text-muted">
                    {s.duration_min} min ·{' '}
                    {formatCurrencyCAD(s.price, locale === 'fr' ? 'fr' : 'en')}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={t('steps.service.removeAria', { name: s.name })}
                  onClick={() => onRemove(s.id)}
                  className="shrink-0 rounded p-1 text-text-muted hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Add-ons / picker. Header text shifts from "pick a service" to
          "anything to add?" once the first one is locked in. */}
      {remainingByCategory.size > 0 && (allowMultiService || !hasSelection) ? (
        <div className="space-y-4">
          {hasSelection ? (
            <p className="text-sm font-medium text-text-primary">
              {t('steps.service.anythingToAdd')}
            </p>
          ) : null}
          {[...remainingByCategory.entries()].map(([catId, list]) => {
            const cat = categories.find((c) => c.id === catId);
            return (
              <div key={catId || 'none'}>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  {cat?.name ?? t('steps.service.uncategorized')}
                </p>
                <div className="space-y-1">
                  {list.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onToggle(s.id)}
                      className="flex w-full items-center justify-between gap-3 rounded border border-border bg-bg-base px-3 py-2 text-left transition-colors hover:border-accent hover:bg-accent-subtle"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          aria-hidden
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-text-muted"
                        >
                          <Plus className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{s.name}</p>
                          <p className="text-[11px] text-text-muted">{s.duration_min} min</p>
                        </div>
                      </div>
                      <span className="shrink-0 text-sm font-semibold">
                        {formatCurrencyCAD(s.price, locale === 'fr' ? 'fr' : 'en')}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

/**
 * §3.1 — Barber picker, with avatar (or initials fallback) and an availability
 * hint. The "Any" option appears first when `allow_booking_any_barber` is on,
 * matching the Squire layout.
 */
function BarberStep({
  t,
  shop,
  barbers,
  selectedBarberId,
  onSelect,
}: {
  t: TranslatorFn;
  shop: BookingShop;
  barbers: BarberRow[];
  selectedBarberId: string | 'any' | null;
  onSelect: (id: string | 'any') => void;
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">{t('steps.barber.title')}</h2>
      <div className="space-y-2">
        {shop.allow_booking_any_barber ? (
          <BarberCard
            selected={selectedBarberId === 'any'}
            onSelect={() => onSelect('any')}
            title={t('steps.barber.any')}
            subtitle={t('steps.barber.anyHint')}
            avatarUrl={null}
            initials="?"
          />
        ) : null}
        {barbers.map((b) => (
          <BarberCard
            key={b.id}
            selected={selectedBarberId === b.id}
            onSelect={() => onSelect(b.id)}
            title={b.display_name}
            subtitle={t('steps.barber.availableToday')}
            avatarUrl={b.avatar_url}
            initials={initialsOf(b.display_name)}
          />
        ))}
      </div>
    </section>
  );
}

function BarberCard({
  selected,
  onSelect,
  title,
  subtitle,
  avatarUrl,
  initials,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  subtitle: string;
  avatarUrl: string | null;
  initials: string;
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
      <div className="flex min-w-0 items-center gap-3">
        {/* Avatar — img tag if URL provided, otherwise initials in a circle.
            Falls back to a generic icon for the "Any" option (initials = "?"). */}
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
        ) : (
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bg-surface-2 text-sm font-semibold text-text-secondary"
          >
            {initials === '?' ? <UserCircle2 className="h-6 w-6" /> : initials}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate font-medium">{title}</p>
          {subtitle ? <p className="text-xs text-text-muted">{subtitle}</p> : null}
        </div>
      </div>
      {selected ? <Badge variant="accent">●</Badge> : null}
    </button>
  );
}

function initialsOf(name: string): string {
  // Match the first letter of up to two words. Strips diacritics first so that
  // "Élodie Côté" → "EC" not "ÉC" (visually clearer in a small circle).
  const stripped = name.normalize('NFD').replace(/[̀-ͯ]/gu, '');
  const parts = stripped.split(/\s+/u).filter(Boolean).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('') || '?';
}

/**
 * §3.3 — "Your order" recap card. Shown above the slot picker so the customer
 * sees who they'll be with and what they're paying for before locking a time.
 */
function OrderRecap({
  t,
  locale,
  barber,
  isAnyBarber,
  services,
  totalPrice,
  totalDuration,
}: {
  t: TranslatorFn;
  locale: string;
  barber: BarberRow | null | undefined;
  isAnyBarber: boolean;
  services: ServiceRow[];
  totalPrice: number;
  totalDuration: number;
}) {
  const proLabel = isAnyBarber
    ? t('steps.barber.any')
    : (barber?.display_name ?? t('order.unassigned'));
  const avatarUrl = !isAnyBarber ? barber?.avatar_url : null;
  const initials = !isAnyBarber && barber ? initialsOf(barber.display_name) : '?';

  return (
    <div className="rounded border border-border bg-bg-base p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
        {t('order.title')}
      </p>
      <div className="mt-2 flex items-center gap-3">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
        ) : (
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bg-surface-2 text-sm font-semibold text-text-secondary"
          >
            {initials === '?' ? <UserCircle2 className="h-6 w-6" /> : initials}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{proLabel}</p>
          <p className="text-xs text-text-secondary">{services.map((s) => s.name).join(' + ')}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-sm">
        <span className="text-text-secondary">{t('order.subtotal')}</span>
        <span className="font-semibold">
          {formatCurrencyCAD(totalPrice, locale === 'fr' ? 'fr' : 'en')}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-text-muted">
        {totalDuration} {t('summary.minutes')}
      </p>
    </div>
  );
}

/**
 * §3.4 — Slot picker, grouped by morning / afternoon / evening so the
 * customer can scan quickly. Each group has a contextual icon (sun, sunset,
 * moon) matching the Squire pattern.
 */
function SlotPicker({
  t,
  loading,
  slots,
  selected,
  onSelect,
}: {
  t: TranslatorFn;
  loading: boolean;
  slots: string[] | null;
  selected: string | null;
  onSelect: (time: string) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          {t('steps.slot.times')}
        </p>
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      </div>
    );
  }
  if (!slots || slots.length === 0) {
    return (
      <p className="rounded border border-border bg-bg-base p-4 text-center text-sm text-text-muted">
        {t('steps.slot.empty')}
      </p>
    );
  }
  const grouped = groupSlotsByTimeOfDay(slots);
  return (
    <div className="space-y-4">
      <SlotGroup
        icon={<Sun className="h-4 w-4" />}
        label={t('steps.slot.morning')}
        times={grouped.morning}
        selected={selected}
        onSelect={onSelect}
      />
      <SlotGroup
        icon={<Sunset className="h-4 w-4" />}
        label={t('steps.slot.afternoon')}
        times={grouped.afternoon}
        selected={selected}
        onSelect={onSelect}
      />
      <SlotGroup
        icon={<Moon className="h-4 w-4" />}
        label={t('steps.slot.evening')}
        times={grouped.evening}
        selected={selected}
        onSelect={onSelect}
      />
    </div>
  );
}

function SlotGroup({
  icon,
  label,
  times,
  selected,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  times: string[];
  selected: string | null;
  onSelect: (time: string) => void;
}) {
  if (times.length === 0) return null;
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
        <span aria-hidden>{icon}</span>
        {label}
      </p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {times.map((time) => {
          const active = selected === time;
          return (
            <button
              key={time}
              type="button"
              onClick={() => onSelect(time)}
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
    </div>
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
