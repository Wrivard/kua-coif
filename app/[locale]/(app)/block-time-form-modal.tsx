'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input, Label } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import type { BarberRow } from '@/db/rows';
import type { z } from 'zod';
import { blockTime } from './actions';
import { blockTimeSchema, type BlockTimeInput } from './schema';

// React Hook Form needs the schema's INPUT shape (where recurrence
// and until_date are still optional, before the Zod defaults run),
// not the post-parse OUTPUT shape (`BlockTimeInput`). Using
// z.infer/output here gives TS errors at the resolver call because
// the form values won't have those keys until the user touches the
// recurrence checkbox.
type BlockTimeFormValues = z.input<typeof blockTimeSchema>;

type Props = {
  isoDate: string;
  barbers: BarberRow[];
  onClose: () => void;
};

/**
 * Loop 27 — modal for creating a block of time on the calendar.
 * Block-time prevents new bookings on the selected barber × time
 * range. Use cases:
 *   - barber-level: vacation, lunch break, training half-day
 *   - shop-wide (barber_id=null): power outage, statutory holiday
 *     not in shop_days_off
 *
 * Recurrence: optional weekly / biweekly / monthly with an until-
 * date. The server fans the input out into N rows (cap 53). When
 * recurrence === 'none' (default), the form behaves exactly like a
 * single-row form.
 */
export function BlockTimeFormModal({ isoDate, barbers, onClose }: Props) {
  const t = useTranslations('pages.appointments.blockTime');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();
  // Local state for the recurrence toggle drives whether the
  // `until_date` row appears. React Hook Form's `watch` could do the
  // same job but useState is clearer for a binary surface choice.
  const [showRecurrence, setShowRecurrence] = useState(false);
  // When the block would bury live appointments, the server returns the count;
  // we hold it here to ask the operator to confirm before forcing the block.
  const [buriedWarning, setBuriedWarning] = useState<{
    count: number;
    payload: BlockTimeInput;
  } | null>(null);

  const defaults: BlockTimeFormValues = {
    barber_id: barbers[0]?.id ?? null,
    date: isoDate,
    start_time: '12:00',
    end_time: '13:00',
    reason: null,
    recurrence: 'none',
    until_date: null,
  };

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<BlockTimeFormValues>({
    resolver: zodResolver(blockTimeSchema),
    defaultValues: defaults,
  });

  const recurrence = watch('recurrence');

  function submit(payload: BlockTimeInput) {
    startTransition(async () => {
      const result = await blockTime(payload);
      if (result.ok) {
        const count = result.data.count;
        show({
          variant: 'success',
          title: count > 1 ? t('toasts.createdRecurring', { count }) : t('toasts.created'),
        });
        setBuriedWarning(null);
        onClose();
        return;
      }
      // The block would cover live appointments — ask the operator to confirm
      // before forcing it (they can move/cancel those appointments instead).
      if (result.errorCode === 'INVALID_INPUT' && result.fieldErrors?.buried_appointments) {
        setBuriedWarning({ count: Number(result.fieldErrors.buried_appointments), payload });
        return;
      }
      setBuriedWarning(null);
      show({ variant: 'danger', title: tErr(result.errorCode) });
    });
  }

  function onSubmit(values: BlockTimeFormValues) {
    // Sanitise: when recurrence is 'none' we strip until_date so the
    // payload reads as "single block" on the server even if the user
    // toggled the recurrence row on then off. The action accepts the
    // parsed (output) shape — cast here is safe because the resolver
    // already ran the Zod parse before calling onSubmit.
    const payload: BlockTimeInput = (
      values.recurrence === 'none' ? { ...values, until_date: null } : values
    ) as BlockTimeInput;
    submit(payload);
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={t('createTitle')}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={isPending}>
              {tCommon('actions.cancel')}
            </Button>
            <Button onClick={handleSubmit(onSubmit)} loading={isPending}>
              {t('save')}
            </Button>
          </>
        }
      >
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="grid grid-cols-1 gap-6 md:grid-cols-2"
          noValidate
        >
          <div className="md:col-span-2">
            <Label htmlFor="barber_id">{t('barber')}</Label>
            <Select
              id="barber_id"
              // null on the form means "shop-wide block" — convert the
              // empty-string option value back to null before submission
              // via setValue. Same trick the appointment form uses for
              // the optional barber field.
              value={watch('barber_id') ?? ''}
              onChange={(e) => setValue('barber_id', e.target.value || null)}
            >
              <option value="">{t('barberShopWide')}</option>
              {barbers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.display_name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="date" required>
              {t('date')}
            </Label>
            <Input id="date" type="date" {...register('date')} />
          </div>

          <div>
            <Label htmlFor="reason">{t('reason')}</Label>
            <Input
              id="reason"
              type="text"
              placeholder={t('reasonPlaceholder')}
              {...register('reason')}
            />
          </div>

          <div>
            <Label htmlFor="start_time" required>
              {t('startTime')}
            </Label>
            <Input id="start_time" type="time" step={300} {...register('start_time')} />
          </div>

          <div>
            <Label htmlFor="end_time" required>
              {t('endTime')}
            </Label>
            <Input id="end_time" type="time" step={300} {...register('end_time')} />
          </div>

          {/* Recurrence row — opt-in via a single checkbox so the form
            stays compact for the common single-block case. When
            checked, the recurrence select + until-date input slide in.
            The Zod default keeps `recurrence='none'` whenever the
            section is hidden. */}
          <div className="space-y-2 rounded-lg bg-bg-surface p-3 shadow-sm md:col-span-2">
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={showRecurrence}
                onChange={(e) => {
                  setShowRecurrence(e.target.checked);
                  if (!e.target.checked) {
                    setValue('recurrence', 'none');
                    setValue('until_date', null);
                  }
                }}
                className="h-4 w-4 rounded border-border bg-bg-surface-2 text-accent focus:ring-focus"
              />
              <span>{t('repeatToggle')}</span>
            </label>

            {showRecurrence ? (
              <div className="grid grid-cols-1 gap-3 pt-1 md:grid-cols-2">
                <div>
                  <Label htmlFor="recurrence">{t('repeatEvery')}</Label>
                  <Select id="recurrence" {...register('recurrence')}>
                    <option value="weekly">{t('recurrences.weekly')}</option>
                    <option value="biweekly">{t('recurrences.biweekly')}</option>
                    <option value="monthly">{t('recurrences.monthly')}</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="until_date" required>
                    {t('repeatUntil')}
                  </Label>
                  <Input
                    id="until_date"
                    type="date"
                    // Loop 27 self-review — min={date} stops the user
                    // from picking an until-date before the start. The
                    // schema also refuses it via .superRefine, but the
                    // native date picker is the better first line of
                    // defence.
                    min={watch('date')}
                    {...register('until_date')}
                  />
                  {errors.until_date ? (
                    <p className="mt-1 text-[10px] text-danger">
                      {errors.until_date.message === 'UNTIL_DATE_REQUIRED'
                        ? t('errors.untilRequired')
                        : errors.until_date.message === 'UNTIL_DATE_BEFORE_START'
                          ? t('errors.untilBeforeStart')
                          : t('errors.untilInvalid')}
                    </p>
                  ) : (
                    <p className="mt-1 text-[10px] text-text-muted">
                      {t('repeatHelper', {
                        label:
                          recurrence === 'weekly'
                            ? t('recurrences.weekly').toLowerCase()
                            : recurrence === 'biweekly'
                              ? t('recurrences.biweekly').toLowerCase()
                              : t('recurrences.monthly').toLowerCase(),
                      })}
                    </p>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          {/* Surface any Zod errors at the bottom — keeps the field
            order tidy and lets the owner scan the whole form at a
            glance. */}
          {Object.values(errors).length > 0 ? (
            <p className="text-xs text-danger md:col-span-2">{t('validationError')}</p>
          ) : null}
        </form>
      </Modal>
      <ConfirmDialog
        open={buriedWarning !== null}
        destructive
        loading={isPending}
        title={t('buried.title')}
        description={buriedWarning ? t('buried.body', { count: buriedWarning.count }) : ''}
        confirmLabel={t('buried.confirm')}
        cancelLabel={tCommon('actions.cancel')}
        onConfirm={() => {
          if (buriedWarning) submit({ ...buriedWarning.payload, force: true });
        }}
        onCancel={() => setBuriedWarning(null)}
      />
    </>
  );
}
