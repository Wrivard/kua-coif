'use client';

import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { BellRing, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import { deleteWaitlistEntry, updateWaitlistEntryStatus, upsertWaitingList } from './actions';
// Loop 59 hotfix — schema + type live in `./schema` not `./actions`
// because the latter is `'use server'` and the bundler strips
// non-function exports from the client bundle.
import { waitingListSchema, type WaitingListInput } from './schema';

export type WaitlistEntry = {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string;
  preferred_barber_id: string | null;
  service_ids: string[] | null;
  date_window_start: string;
  date_window_end: string;
  notes: string | null;
  status: 'waiting' | 'notified' | 'booked' | 'cancelled';
  created_at: string;
  notified_at: string | null;
};

export function WaitingListClient({
  initial,
  entries,
  barbers,
}: {
  initial: WaitingListInput;
  entries: WaitlistEntry[];
  barbers: Array<{ id: string; display_name: string }>;
}) {
  const t = useTranslations('pages.settings.waitingList');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  const { register, handleSubmit, watch, setValue } = useForm<WaitingListInput>({
    resolver: zodResolver(waitingListSchema),
    defaultValues: initial,
  });

  const enabled = watch('enabled');

  function onSubmit(values: WaitingListInput) {
    startTransition(async () => {
      const result = await upsertWaitingList(values);
      if (result.ok) show({ variant: 'success', title: t('toasts.saved') });
      else show({ variant: 'danger', title: tErr(result.errorCode) });
    });
  }

  function onMarkNotified(id: string) {
    startTransition(async () => {
      const result = await updateWaitlistEntryStatus({
        entry_id: id,
        status: 'notified',
      });
      if (result.ok) show({ variant: 'success', title: t('toasts.notified') });
      else show({ variant: 'danger', title: tErr(result.errorCode) });
    });
  }

  function onCancel(id: string) {
    startTransition(async () => {
      const result = await updateWaitlistEntryStatus({
        entry_id: id,
        status: 'cancelled',
      });
      if (result.ok) show({ variant: 'success', title: t('toasts.cancelled') });
      else show({ variant: 'danger', title: tErr(result.errorCode) });
    });
  }

  function onDelete(id: string) {
    if (!window.confirm(t('confirmDelete'))) return;
    startTransition(async () => {
      const result = await deleteWaitlistEntry({ entry_id: id });
      if (result.ok) show({ variant: 'success', title: t('toasts.deleted') });
      else show({ variant: 'danger', title: tErr(result.errorCode) });
    });
  }

  const barberById = new Map(barbers.map((b) => [b.id, b.display_name]));
  const waitingCount = entries.filter((e) => e.status === 'waiting').length;

  return (
    <>
      <PageHeader title={t('title')} />
      <div className="space-y-6 p-6">
        <form onSubmit={handleSubmit(onSubmit)} className="max-w-xl" noValidate>
          <Card>
            <CardHeader>
              <CardTitle>{t('configTitle')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-5">
              <Toggle
                checked={enabled}
                onChange={(v) => setValue('enabled', v, { shouldDirty: true })}
                label={t('form.enabled')}
              />

              <div>
                <Label htmlFor="threshold_hours">{t('form.threshold')}</Label>
                <div className="flex items-center gap-3">
                  <Input
                    id="threshold_hours"
                    type="number"
                    min={0}
                    max={72}
                    className="w-24"
                    disabled={!enabled}
                    {...register('threshold_hours', { valueAsNumber: true })}
                  />
                  <span className="text-sm text-text-secondary">{t('form.hours')}</span>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button type="submit" loading={isPending}>
                  {tCommon('actions.save')}
                </Button>
              </div>
            </CardBody>
          </Card>
        </form>

        {/* Entries list — Phase 53. The admin works this manually until
            V1.1 notification automation lands. Status pills use the
            existing Badge variants; row actions are the trio
            (notified / cancelled / delete) and the buttons disable on
            terminal states so the admin doesn't accidentally re-mark. */}
        <Card>
          <CardHeader>
            <CardTitle>{t('entries.title')}</CardTitle>
            <Badge variant="default">{waitingCount}</Badge>
          </CardHeader>
          <CardBody>
            {entries.length === 0 ? (
              <p className="text-sm text-text-muted">{t('entries.empty')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                        {t('entries.columns.client')}
                      </th>
                      <th className="py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                        {t('entries.columns.contact')}
                      </th>
                      <th className="py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                        {t('entries.columns.window')}
                      </th>
                      <th className="py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                        {t('entries.columns.barber')}
                      </th>
                      <th className="py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                        {t('entries.columns.status')}
                      </th>
                      <th className="py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                        {t('entries.columns.actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => {
                      const name = `${e.first_name}${e.last_name ? ` ${e.last_name}` : ''}`;
                      const barber = e.preferred_barber_id
                        ? (barberById.get(e.preferred_barber_id) ?? '?')
                        : t('entries.anyBarber');
                      const isTerminal = e.status === 'cancelled' || e.status === 'booked';
                      return (
                        <tr key={e.id} className="border-b border-border last:border-b-0">
                          <td className="py-2 font-medium text-text-primary">{name}</td>
                          <td className="py-2 text-text-secondary">
                            <div>{e.phone}</div>
                            {e.email ? (
                              <div className="text-[11px] text-text-muted">{e.email}</div>
                            ) : null}
                          </td>
                          <td className="py-2 text-text-secondary">
                            {e.date_window_start === e.date_window_end
                              ? e.date_window_start
                              : `${e.date_window_start} → ${e.date_window_end}`}
                          </td>
                          <td className="py-2 text-text-secondary">{barber}</td>
                          <td className="py-2">
                            <StatusPill status={e.status} t={t} />
                          </td>
                          <td className="py-2 text-right">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => onMarkNotified(e.id)}
                                disabled={isTerminal || e.status === 'notified' || isPending}
                                aria-label={t('entries.actions.notify')}
                                className="rounded-md p-1 text-text-muted transition-colors duration-150 ease-out-quint hover:bg-bg-surface-2 hover:text-info focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <BellRing className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onCancel(e.id)}
                                disabled={isTerminal || isPending}
                                aria-label={t('entries.actions.cancel')}
                                className="rounded-md p-1 text-text-muted transition-colors duration-150 ease-out-quint hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <X className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onDelete(e.id)}
                                disabled={isPending}
                                aria-label={t('entries.actions.delete')}
                                className="rounded-md p-1 text-text-muted transition-colors duration-150 ease-out-quint hover:bg-bg-surface-2 hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function StatusPill({
  status,
  t,
}: {
  status: WaitlistEntry['status'];
  t: ReturnType<typeof useTranslations<'pages.settings.waitingList'>>;
}) {
  const variantMap: Record<WaitlistEntry['status'], 'accent' | 'info' | 'success' | 'default'> = {
    waiting: 'accent',
    notified: 'info',
    booked: 'success',
    cancelled: 'default',
  };
  return <Badge variant={variantMap[status]}>{t(`entries.statuses.${status}`)}</Badge>;
}
