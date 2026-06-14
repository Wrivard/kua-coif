'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldHint, Input, Label, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { combineShopDateTime } from '@/lib/business/timezone';
import type { BarberRow, ClientRow, ServiceCategoryRow, ServiceRow } from '@/db/rows';
import type { z } from 'zod';
import { createAppointment, searchClients } from './actions';
import type { CalendarAppointment } from './appointments-calendar';
import { appointmentSchema } from './schema';

// React Hook Form needs the schema's INPUT shape (walk_in / client_name are
// still optional, before the Zod defaults run), not the post-parse OUTPUT
// shape — using z.infer/output gives TS errors at the resolver call.
type AppointmentFormValues = z.input<typeof appointmentSchema>;

type Mode = { kind: 'create'; barberId: string; minutes: number };

type ClientOption = Pick<ClientRow, 'id' | 'first_name' | 'last_name' | 'email' | 'phone'>;

type Props = {
  mode: Mode;
  isoDate: string;
  /** Shop timezone — needed to compose the provisional block's UTC instants. */
  timezone: string;
  barbers: BarberRow[];
  services: ServiceRow[];
  categories: ServiceCategoryRow[];
  clients: ClientRow[];
  /**
   * Plan 033 — fired on a SUCCESSFUL create, before the modal closes, with a
   * provisional CalendarAppointment carrying the REAL id the action returned.
   * The calendar appends it so the block appears instantly instead of waiting
   * for the realtime refresh. Composed from the same inputs the server
   * mirrors (end = start + Σ duration, total = Σ price), so the phantom is
   * replaced in place by the identical truth row — no flicker, no duplicate.
   */
  onCreated?: (appt: CalendarAppointment) => void;
  onClose: () => void;
};

function minutesToHHmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function AppointmentFormModal({
  mode,
  isoDate,
  timezone,
  barbers,
  services,
  categories,
  clients,
  onCreated,
  onClose,
}: Props) {
  const t = useTranslations('pages.appointments');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState('');

  const defaults: AppointmentFormValues = {
    barber_id: mode.barberId,
    client_id: clients[0]?.id ?? null,
    walk_in: false,
    client_name: null,
    date: isoDate,
    start_time: minutesToHHmm(mode.minutes),
    service_ids: [],
    notes: null,
    status: 'confirmed',
  };

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<AppointmentFormValues>({
    resolver: zodResolver(appointmentSchema),
    defaultValues: defaults,
  });

  const selectedServiceIds = watch('service_ids');
  const walkIn = watch('walk_in');
  const totalMinutes = useMemo(() => {
    return services
      .filter((s) => selectedServiceIds.includes(s.id))
      .reduce((sum, s) => sum + s.duration_min, 0);
  }, [services, selectedServiceIds]);

  // Server-side client search. The pre-loaded `clients` list is capped at 500,
  // so typing now queries the FULL client set (substring on name / phone /
  // email) instead of filtering only the first 500 in memory. Empty / short
  // query falls back to the first 50 of the pre-loaded list.
  const [serverResults, setServerResults] = useState<ClientOption[]>([]);
  const [searching, setSearching] = useState(false);
  // Tracks the query the user is currently on, so a slower EARLIER response
  // can't clobber newer results (out-of-order response race — the debounce
  // only cancels the pending timer, not an in-flight request).
  const latestQuery = useRef('');
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      latestQuery.current = '';
      setServerResults([]);
      setSearching(false);
      return;
    }
    latestQuery.current = q;
    setSearching(true);
    const id = setTimeout(async () => {
      const result = await searchClients({ query: q });
      // Drop a response the user has already moved off of.
      if (latestQuery.current !== q) return;
      if (result.ok) setServerResults(result.data);
      setSearching(false);
    }, 250);
    return () => clearTimeout(id);
  }, [search]);

  // The chosen client is tracked as an OBJECT (not just the form's id) so it
  // stays in the option list even after the search query changes and its row
  // drops out of the results. Otherwise the <Select> would show one client
  // while the form still submits another (silent wrong-client booking).
  // picked and the form's client_id are always updated together below.
  const [picked, setPicked] = useState<ClientOption | null>(clients[0] ?? null);
  const displayedClients = useMemo<ClientOption[]>(() => {
    const base = search.trim().length >= 2 ? serverResults : clients.slice(0, 50);
    if (!picked || base.some((c) => c.id === picked.id)) return base;
    return [picked, ...base];
  }, [search, serverResults, clients, picked]);

  // Group services by category for the multi-select.
  //
  // Services W3 (UX-08) — DISABLED services are excluded: the owner's status
  // toggle was decorative for walk-ins (the public booking + embed already
  // filter `enabled`, but this admin picker offered everything). Filtered
  // HERE rather than in getCachedServices because the calendar still needs
  // disabled rows to resolve names on EXISTING appointments; this modal is
  // create-only, so nothing previously selected can be hidden.
  const servicesByCategory = useMemo(() => {
    const map = new Map<string, ServiceRow[]>();
    for (const s of services) {
      if (s.status !== 'enabled') continue;
      const key = s.category_id ?? '';
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return map;
  }, [services]);

  function onSubmit(values: AppointmentFormValues) {
    startTransition(async () => {
      const result = await createAppointment(values);
      if (result.ok) {
        // Plan 033 — hand the calendar a provisional block so it renders
        // instantly. Mirrors the server's composition exactly (end_at =
        // start + Σ duration_min, total_amount = Σ price, source 'admin');
        // `picked` is the client OBJECT (not just the form id), so the name
        // is right even when the client came from a server search. Guarded:
        // a composition failure must never break the success toast/close —
        // worst case we fall back to today's wait-for-realtime behavior.
        try {
          const chosen = services.filter((s) => values.service_ids.includes(s.id));
          const startAt = combineShopDateTime(values.date, values.start_time, timezone);
          const durationMin = chosen.reduce((sum, s) => sum + s.duration_min, 0);
          onCreated?.({
            id: result.data.id,
            barber_id: values.barber_id,
            client_id: values.client_id,
            client_name: values.walk_in
              ? (values.client_name ?? '')
              : picked
                ? `${picked.first_name}${picked.last_name ? ` ${picked.last_name}` : ''}`
                : '',
            start_at: startAt.toISOString(),
            end_at: new Date(startAt.getTime() + durationMin * 60_000).toISOString(),
            status: values.status,
            notes: values.notes ?? null,
            source: 'admin',
            total_amount: chosen.reduce((sum, s) => sum + s.price, 0),
            services: chosen,
            payment_status: 'unpaid',
          });
        } catch {
          // fall through — the appointment was created; realtime will render it
        }
        show({ variant: 'success', title: t('toasts.created') });
        onClose();
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('form.createTitle')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            {tCommon('actions.cancel')}
          </Button>
          <Button onClick={handleSubmit(onSubmit)} loading={isPending}>
            {t('form.book')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="grid grid-cols-1 gap-6 md:grid-cols-2"
        noValidate
      >
        <div>
          <div className="mb-2">
            <Checkbox
              checked={walkIn ?? false}
              onChange={(e) => {
                const on = e.target.checked;
                setValue('walk_in', on, { shouldValidate: true });
                if (on) {
                  // Walk-in: detach any picked client; the name field takes over.
                  setPicked(null);
                  setValue('client_id', null, { shouldValidate: true });
                } else {
                  // Back to a booked client: drop the walk-in name, restore picker.
                  setValue('client_name', null);
                  const first = clients[0] ?? null;
                  setPicked(first);
                  setValue('client_id', first?.id ?? null, { shouldValidate: true });
                }
              }}
              label={t('form.walkIn')}
            />
          </div>

          {walkIn ? (
            <div>
              <Label htmlFor="client_name">{t('form.walkInName')}</Label>
              <Input
                id="client_name"
                placeholder={t('form.walkInNamePlaceholder')}
                {...register('client_name')}
              />
            </div>
          ) : (
            <>
              <Label htmlFor="client_id" required>
                {t('form.client')}
              </Label>
              <Input
                placeholder={t('form.searchClient')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Select
                id="client_id"
                className="mt-2"
                value={picked?.id ?? ''}
                onChange={(e) => {
                  const c = displayedClients.find((x) => x.id === e.target.value) ?? null;
                  setPicked(c);
                  setValue('client_id', e.target.value, { shouldValidate: true });
                }}
              >
                {displayedClients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.first_name}
                    {c.last_name ? ` ${c.last_name}` : ''}
                    {c.phone ? ` — ${c.phone}` : ''}
                  </option>
                ))}
              </Select>
              {searching ? (
                <p className="mt-1 text-[10px] text-text-muted">{t('form.searching')}</p>
              ) : search.trim().length >= 2 && serverResults.length === 0 ? (
                <p className="mt-1 text-[10px] text-text-muted">{t('form.noClients')}</p>
              ) : null}
              {errors.client_id ? (
                <FieldHint error>
                  {tErr('field.CLIENT_REQUIRED' as 'field.NAME_REQUIRED')}
                </FieldHint>
              ) : null}
            </>
          )}
        </div>

        <div>
          <Label htmlFor="barber_id" required>
            {t('form.barber')}
          </Label>
          <Select id="barber_id" {...register('barber_id')}>
            {barbers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.display_name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="date" required>
            {t('form.date')}
          </Label>
          <Input id="date" type="date" {...register('date')} />
        </div>

        <div>
          <Label htmlFor="start_time" required>
            {t('form.startTime')}
          </Label>
          <Input id="start_time" type="time" step={300} {...register('start_time')} />
        </div>

        <div className="md:col-span-2">
          <Label required>
            {t('form.services')} {totalMinutes > 0 ? `(${totalMinutes} min)` : ''}
          </Label>
          <div className="max-h-64 overflow-y-auto rounded-lg bg-bg-surface p-3 shadow-sm">
            {[...servicesByCategory.entries()].map(([categoryId, list]) => {
              const category = categories.find((c) => c.id === categoryId);
              return (
                <div key={categoryId || 'none'} className="mb-3 last:mb-0">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    {category?.name ?? t('form.uncategorized')}
                  </p>
                  <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
                    {list.map((s) => {
                      const checked = selectedServiceIds.includes(s.id);
                      return (
                        <Checkbox
                          key={s.id}
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...selectedServiceIds, s.id]
                              : selectedServiceIds.filter((id) => id !== s.id);
                            setValue('service_ids', next, { shouldValidate: true });
                          }}
                          label={
                            <span className="flex w-full items-center justify-between gap-2">
                              <span>{s.name}</span>
                              <span className="text-[10px] text-text-muted">
                                {s.duration_min} min
                              </span>
                            </span>
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {errors.service_ids ? (
            <FieldHint error>{tErr('field.SERVICE_REQUIRED' as 'field.NAME_REQUIRED')}</FieldHint>
          ) : null}
        </div>

        <div className="md:col-span-2">
          <Label htmlFor="notes">{t('form.notes')}</Label>
          <Textarea id="notes" rows={2} {...register('notes')} />
        </div>
      </form>
    </Modal>
  );
}
