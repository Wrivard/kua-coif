'use client';

import { useMemo, useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldHint, Input, Label, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import type { BarberRow, ClientRow, ServiceCategoryRow, ServiceRow } from '@/db/rows';
import { createAppointment } from './actions';
import { appointmentSchema, type AppointmentInput } from './schema';

type Mode = { kind: 'create'; barberId: string; minutes: number };

type Props = {
  mode: Mode;
  isoDate: string;
  barbers: BarberRow[];
  services: ServiceRow[];
  categories: ServiceCategoryRow[];
  clients: ClientRow[];
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
  barbers,
  services,
  categories,
  clients,
  onClose,
}: Props) {
  const t = useTranslations('pages.appointments');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState('');

  const defaults: AppointmentInput = {
    barber_id: mode.barberId,
    client_id: clients[0]?.id ?? '',
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
  } = useForm<AppointmentInput>({
    resolver: zodResolver(appointmentSchema),
    defaultValues: defaults,
  });

  const selectedServiceIds = watch('service_ids');
  const totalMinutes = useMemo(() => {
    return services
      .filter((s) => selectedServiceIds.includes(s.id))
      .reduce((sum, s) => sum + s.duration_min, 0);
  }, [services, selectedServiceIds]);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients.slice(0, 50);
    return clients
      .filter((c) =>
        `${c.first_name} ${c.last_name ?? ''} ${c.email ?? ''} ${c.phone ?? ''}`
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 50);
  }, [clients, search]);

  // Group services by category for the multi-select.
  const servicesByCategory = useMemo(() => {
    const map = new Map<string, ServiceRow[]>();
    for (const s of services) {
      const key = s.category_id ?? '';
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return map;
  }, [services]);

  function onSubmit(values: AppointmentInput) {
    startTransition(async () => {
      const result = await createAppointment(values);
      if (result.ok) {
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
          <Label htmlFor="client_id" required>
            {t('form.client')}
          </Label>
          <Input
            placeholder={t('form.searchClient')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select id="client_id" className="mt-2" {...register('client_id')}>
            {filteredClients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.first_name}
                {c.last_name ? ` ${c.last_name}` : ''}
                {c.phone ? ` — ${c.phone}` : ''}
              </option>
            ))}
          </Select>
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
