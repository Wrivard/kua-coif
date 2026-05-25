'use client';

import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldHint, Input, Label } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { MoneyInput } from '@/components/ui/money-input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import type { ServiceCategoryRow, ServiceRow, TaxRow } from '@/db/rows';
import { createService, updateService } from './actions';
import { serviceSchema, type ServiceInput } from './schema';

type Mode = { kind: 'add' } | { kind: 'edit'; service: ServiceRow };

type Props = {
  mode: Mode;
  categories: ServiceCategoryRow[];
  taxes: TaxRow[];
  existingTaxIds: string[];
  onClose: () => void;
};

export function ServiceFormModal({ mode, categories, taxes, existingTaxIds, onClose }: Props) {
  const t = useTranslations('pages.services');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  const defaults: ServiceInput =
    mode.kind === 'edit'
      ? {
          name: mode.service.name,
          category_id: mode.service.category_id,
          duration_min: mode.service.duration_min,
          price: mode.service.price,
          status: mode.service.status,
          tax_ids: existingTaxIds,
          // Phase 42 — service.deposit_amount_cents was added in
          // migration 20260525190000_appointment_payments. The ServiceRow
          // type doesn't carry it yet (db/rows.ts is hand-rolled), so
          // we coerce via `any` until the rows file regenerates.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          deposit_amount_cents: ((mode.service as any).deposit_amount_cents as number) ?? 0,
        }
      : {
          name: '',
          category_id: categories[0]?.id ?? null,
          duration_min: 30,
          price: 0,
          status: 'enabled',
          tax_ids: taxes.map((t) => t.id), // default: all shop taxes
          deposit_amount_cents: 0,
        };

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ServiceInput>({
    resolver: zodResolver(serviceSchema),
    defaultValues: defaults,
  });

  const selectedTaxIds = watch('tax_ids');

  function onSubmit(values: ServiceInput) {
    startTransition(async () => {
      const result =
        mode.kind === 'edit'
          ? await updateService({ id: mode.service.id, ...values })
          : await createService(values);

      if (result.ok) {
        show({
          variant: 'success',
          title: mode.kind === 'edit' ? t('toasts.updated') : t('toasts.created'),
        });
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
      size="lg"
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
          <Label htmlFor="name" required>
            {t('form.name')}
          </Label>
          <Input id="name" invalid={Boolean(errors.name)} {...register('name')} />
          {errors.name ? <FieldHint error>{tErr('field.NAME_REQUIRED')}</FieldHint> : null}
        </div>

        <div>
          <Label htmlFor="category_id">{t('form.category')}</Label>
          <Select id="category_id" {...register('category_id')}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="duration_min" required>
            {t('form.duration')}
          </Label>
          <Input
            id="duration_min"
            type="number"
            step={5}
            min={5}
            invalid={Boolean(errors.duration_min)}
            {...register('duration_min', { valueAsNumber: true })}
          />
          {errors.duration_min ? (
            <FieldHint error>
              {tErr(`field.${errors.duration_min.message}` as 'field.DURATION_MIN')}
            </FieldHint>
          ) : null}
        </div>

        <div>
          <Label htmlFor="price" required>
            {t('form.price')}
          </Label>
          <MoneyInput
            id="price"
            invalid={Boolean(errors.price)}
            {...register('price', { valueAsNumber: true })}
          />
        </div>

        <div>
          <Label htmlFor="status">{t('form.status')}</Label>
          <Select id="status" {...register('status')}>
            <option value="enabled">{t('status.enabled')}</option>
            <option value="disabled">{t('status.disabled')}</option>
          </Select>
        </div>

        <div>
          <Label htmlFor="deposit_amount_cents">{t('form.deposit')}</Label>
          {/* Phase 42 — store as cents but show as dollars in the UI.
              `setValueAs` converts string "12.50" → 1250 cents on submit. */}
          <MoneyInput
            id="deposit_amount_cents"
            placeholder="0.00"
            {...register('deposit_amount_cents', {
              setValueAs: (v) => {
                const n = typeof v === 'string' ? parseFloat(v) : Number(v);
                return Number.isFinite(n) ? Math.round(n * 100) : 0;
              },
            })}
            defaultValue={(defaults.deposit_amount_cents / 100).toFixed(2)}
          />
          <FieldHint>{t('form.depositHint')}</FieldHint>
        </div>

        <div className="md:col-span-2">
          <Label>{t('form.taxes')}</Label>
          <div className="grid grid-cols-2 gap-2 rounded border border-border bg-bg-surface p-3">
            {taxes.length === 0 ? (
              <p className="text-xs text-text-muted">{t('form.noTaxes')}</p>
            ) : (
              taxes.map((tax) => {
                const isChecked = selectedTaxIds.includes(tax.id);
                return (
                  <Checkbox
                    key={tax.id}
                    checked={isChecked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...selectedTaxIds, tax.id]
                        : selectedTaxIds.filter((id) => id !== tax.id);
                      setValue('tax_ids', next, { shouldDirty: true });
                    }}
                    label={`${tax.name} ${tax.percentage}%`}
                  />
                );
              })
            )}
          </div>
        </div>
      </form>
    </Modal>
  );
}
