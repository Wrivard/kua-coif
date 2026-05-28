'use client';

import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { FieldHint, Input, Label } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { MoneyInput } from '@/components/ui/money-input';
import { PercentInput } from '@/components/ui/percent-input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { DISCOUNT_ASSIGNMENTS, DISCOUNT_TYPES } from '@/db/enums';
import type { DiscountRow } from '@/db/rows';
import { createDiscount, updateDiscount } from './actions';
import { discountSchema, type DiscountInput } from './schema';

type Mode = { kind: 'add' } | { kind: 'edit'; discount: DiscountRow };

export function DiscountFormModal({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  const t = useTranslations('pages.settings.discounts');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  const defaults: DiscountInput =
    mode.kind === 'edit'
      ? {
          name: mode.discount.name,
          type: mode.discount.type,
          value: mode.discount.value,
          assignment: mode.discount.assignment,
        }
      : { name: '', type: 'percent', value: 0, assignment: 'services_only' };

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<DiscountInput>({
    resolver: zodResolver(discountSchema),
    defaultValues: defaults,
  });

  const type = watch('type');

  function onSubmit(values: DiscountInput) {
    startTransition(async () => {
      const result =
        mode.kind === 'edit'
          ? await updateDiscount({ id: mode.discount.id, ...values })
          : await createDiscount(values);
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
        className="grid grid-cols-1 gap-6 md:grid-cols-2"
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
          <Label htmlFor="type">{t('form.type')}</Label>
          <Select id="type" {...register('type')}>
            {DISCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t === 'percent' ? '%' : '$'}
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

        <div className="md:col-span-2">
          <Label htmlFor="assignment">{t('form.assignment')}</Label>
          <Select id="assignment" {...register('assignment')}>
            {DISCOUNT_ASSIGNMENTS.map((a) => (
              <option key={a} value={a}>
                {t(`assignment.${a}`)}
              </option>
            ))}
          </Select>
        </div>
      </form>
    </Modal>
  );
}
