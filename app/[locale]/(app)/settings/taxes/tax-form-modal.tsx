'use client';

import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldHint, Input, Label } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { PercentInput } from '@/components/ui/percent-input';
import { useToast } from '@/components/ui/toast';
import type { TaxRow } from '@/db/rows';
import { createTax, updateTax } from './actions';
import { taxSchema, type TaxInput } from './schema';

type Mode = { kind: 'add' } | { kind: 'edit'; tax: TaxRow };

export function TaxFormModal({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  const t = useTranslations('pages.settings.taxes');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  const defaults: TaxInput =
    mode.kind === 'edit'
      ? {
          name: mode.tax.name,
          percentage: mode.tax.percentage,
          add_to_price: mode.tax.add_to_price,
          external_orders_only: mode.tax.external_orders_only,
          enabled: mode.tax.enabled,
        }
      : {
          name: '',
          percentage: 0,
          add_to_price: true,
          external_orders_only: false,
          enabled: true,
        };

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<TaxInput>({
    resolver: zodResolver(taxSchema),
    defaultValues: defaults,
  });

  function onSubmit(values: TaxInput) {
    startTransition(async () => {
      const result =
        mode.kind === 'edit'
          ? await updateTax({ id: mode.tax.id, ...values })
          : await createTax(values);
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.saved') });
        onClose();
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  const addToPrice = watch('add_to_price');
  const externalOrdersOnly = watch('external_orders_only');
  const enabled = watch('enabled');

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
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div>
          <Label htmlFor="name" required>
            {t('form.name')}
          </Label>
          <Input id="name" invalid={Boolean(errors.name)} {...register('name')} />
          {errors.name ? <FieldHint error>{tErr('field.NAME_REQUIRED')}</FieldHint> : null}
        </div>

        <div>
          <Label htmlFor="percentage" required>
            {t('form.percentage')}
          </Label>
          <PercentInput
            id="percentage"
            step="0.001"
            {...register('percentage', { valueAsNumber: true })}
          />
        </div>

        <Checkbox
          checked={addToPrice}
          onChange={(e) => setValue('add_to_price', e.target.checked, { shouldDirty: true })}
          label={t('form.addToPrice')}
        />
        <Checkbox
          checked={externalOrdersOnly}
          onChange={(e) =>
            setValue('external_orders_only', e.target.checked, { shouldDirty: true })
          }
          label={t('form.externalOrdersOnly')}
        />
        <Checkbox
          checked={enabled}
          onChange={(e) => setValue('enabled', e.target.checked, { shouldDirty: true })}
          label={t('form.enabled')}
        />
      </form>
    </Modal>
  );
}
