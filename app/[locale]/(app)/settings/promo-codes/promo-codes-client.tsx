'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { FieldHint, Input, Label } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { MoneyInput } from '@/components/ui/money-input';
import { PageHeader } from '@/components/ui/page-header';
import { PercentInput } from '@/components/ui/percent-input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { formatCurrencyCAD } from '@/lib/utils';
import { DISCOUNT_TYPES, type DiscountType } from '@/db/enums';
import { createPromoCode, deletePromoCode, updatePromoCode } from './actions';
import { promoCodeSchema, type PromoCodeInput } from './schema';

export type PromoCodeRow = {
  id: string;
  code: string;
  type: DiscountType;
  value: number;
  first_appointment_only: boolean;
  one_time: boolean;
  expiration_date: string | null;
  redemptions: number;
  total_redemption_value: number;
};

type Mode = { kind: 'closed' } | { kind: 'add' } | { kind: 'edit'; promo: PromoCodeRow };

export function PromoCodesClient({
  locale,
  promoCodes,
}: {
  locale: string;
  promoCodes: PromoCodeRow[];
}) {
  const t = useTranslations('pages.settings.promoCodes');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [mode, setMode] = useState<Mode>({ kind: 'closed' });
  const [confirmDelete, setConfirmDelete] = useState<PromoCodeRow | null>(null);
  const [isPending, startTransition] = useTransition();

  function onDelete(row: PromoCodeRow) {
    startTransition(async () => {
      const result = await deletePromoCode({ id: row.id });
      setConfirmDelete(null);
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.deleted', { code: row.code }) });
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  const columns: ReadonlyArray<ColumnDef<PromoCodeRow>> = [
    {
      id: 'code',
      header: t('columns.code'),
      cell: (r) => <span className="font-mono font-semibold uppercase">{r.code}</span>,
      sortable: true,
      sortValue: (r) => r.code.toLowerCase(),
    },
    {
      id: 'value',
      header: t('columns.value'),
      cell: (r) =>
        r.type === 'percent'
          ? `${r.value}%`
          : formatCurrencyCAD(r.value, locale === 'fr' ? 'fr' : 'en'),
      align: 'right',
      width: '110px',
    },
    {
      id: 'first_appt',
      header: t('columns.firstAppt'),
      align: 'center',
      width: '160px',
      cell: (r) => (r.first_appointment_only ? <Badge variant="accent">●</Badge> : '—'),
    },
    {
      id: 'one_time',
      header: t('columns.oneTime'),
      align: 'center',
      width: '110px',
      cell: (r) => (r.one_time ? <Badge variant="accent">●</Badge> : '—'),
    },
    {
      id: 'expiration',
      header: t('columns.expiration'),
      cell: (r) => r.expiration_date ?? <span className="text-text-muted">—</span>,
    },
    {
      id: 'redemptions',
      header: t('columns.redemptions'),
      align: 'right',
      width: '120px',
      cell: (r) => r.redemptions,
    },
    {
      id: 'total',
      header: t('columns.totalValue'),
      align: 'right',
      width: '140px',
      cell: (r) => formatCurrencyCAD(r.total_redemption_value, locale === 'fr' ? 'fr' : 'en'),
    },
    {
      id: 'actions',
      header: '',
      width: '90px',
      align: 'right',
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            aria-label={tCommon('actions.edit')}
            onClick={(e) => {
              e.stopPropagation();
              setMode({ kind: 'edit', promo: r });
            }}
            className="rounded p-1 text-text-muted hover:bg-bg-surface-2 hover:text-text-primary"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={tCommon('actions.delete')}
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDelete(r);
            }}
            className="rounded p-1 text-text-muted hover:bg-bg-surface-2 hover:text-danger"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          <Button onClick={() => setMode({ kind: 'add' })} size="sm">
            <Plus className="h-4 w-4" /> {t('addPromo')}
          </Button>
        }
      />

      <div className="p-6">
        <DataTable
          columns={columns}
          data={promoCodes}
          getRowKey={(r) => r.id}
          emptyState={{ title: t('emptyTitle'), description: t('emptyHint') }}
        />
      </div>

      {mode.kind !== 'closed' && (
        <PromoCodeFormModal mode={mode} onClose={() => setMode({ kind: 'closed' })} />
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t('confirmDelete.title')}
        description={
          confirmDelete ? t('confirmDelete.description', { code: confirmDelete.code }) : ''
        }
        destructive
        loading={isPending}
        confirmLabel={tCommon('actions.delete')}
        cancelLabel={tCommon('actions.cancel')}
        onConfirm={() => confirmDelete && onDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}

function PromoCodeFormModal({
  mode,
  onClose,
}: {
  mode: { kind: 'add' } | { kind: 'edit'; promo: PromoCodeRow };
  onClose: () => void;
}) {
  const t = useTranslations('pages.settings.promoCodes');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  const defaults: PromoCodeInput =
    mode.kind === 'edit'
      ? {
          code: mode.promo.code,
          type: mode.promo.type,
          value: mode.promo.value,
          first_appointment_only: mode.promo.first_appointment_only,
          one_time: mode.promo.one_time,
          expiration_date: mode.promo.expiration_date,
        }
      : {
          code: '',
          type: 'percent',
          value: 0,
          first_appointment_only: true,
          one_time: false,
          expiration_date: null,
        };

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<PromoCodeInput>({
    resolver: zodResolver(promoCodeSchema),
    defaultValues: defaults,
  });

  const type = watch('type');

  function onSubmit(values: PromoCodeInput) {
    startTransition(async () => {
      const result =
        mode.kind === 'edit'
          ? await updatePromoCode({ id: mode.promo.id, ...values })
          : await createPromoCode(values);
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.saved') });
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
      title={mode.kind === 'edit' ? t('form.editTitle') : t('form.addTitle')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            {tCommon('actions.cancel')}
          </Button>
          <Button onClick={handleSubmit(onSubmit)} loading={isPending}>
            {tCommon('actions.save')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="grid grid-cols-1 gap-4 md:grid-cols-2"
        noValidate
      >
        <div className="md:col-span-2">
          <Label htmlFor="code" required>
            {t('form.code')}
          </Label>
          <Input
            id="code"
            className="font-mono uppercase"
            invalid={Boolean(errors.code)}
            {...register('code')}
          />
          {errors.code ? <FieldHint error>{tErr('field.NAME_REQUIRED')}</FieldHint> : null}
        </div>

        <div>
          <Label htmlFor="type">{t('form.type')}</Label>
          <Select id="type" {...register('type')}>
            {DISCOUNT_TYPES.map((tp) => (
              <option key={tp} value={tp}>
                {tp === 'percent' ? '%' : '$'}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="value" required>
            {t('form.value')}
          </Label>
          {type === 'percent' ? (
            <PercentInput id="value" {...register('value', { valueAsNumber: true })} />
          ) : (
            <MoneyInput id="value" {...register('value', { valueAsNumber: true })} />
          )}
        </div>

        <div>
          <Label htmlFor="expiration_date">{t('form.expiration')}</Label>
          <Input id="expiration_date" type="date" {...register('expiration_date')} />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Checkbox
            checked={watch('first_appointment_only')}
            onChange={(e) =>
              setValue('first_appointment_only', e.target.checked, { shouldDirty: true })
            }
            label={t('form.firstApptOnly')}
          />
          <Checkbox
            checked={watch('one_time')}
            onChange={(e) => setValue('one_time', e.target.checked, { shouldDirty: true })}
            label={t('form.oneTime')}
          />
        </div>
      </form>
    </Modal>
  );
}
