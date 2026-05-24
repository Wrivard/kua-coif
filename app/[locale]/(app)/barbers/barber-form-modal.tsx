'use client';

import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { FieldHint, Input, Label } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { PhoneInput } from '@/components/ui/phone-input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { SHOP_MEMBER_STATUSES } from '@/db/enums';
import type { BarberRow } from '@/db/rows';
import { createBarber, updateBarber } from './actions';
import { barberSchema, type BarberInput } from './schema';

type Mode = { kind: 'add' } | { kind: 'edit'; barber: BarberRow };

export function BarberFormModal({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  const t = useTranslations('pages.barbers');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  const defaults: BarberInput =
    mode.kind === 'edit'
      ? {
          display_name: mode.barber.display_name,
          email: mode.barber.email,
          phone: mode.barber.phone,
          personnel_id: mode.barber.personnel_id,
          status: mode.barber.status,
        }
      : {
          display_name: '',
          email: null,
          phone: null,
          personnel_id: null,
          status: 'confirmed',
        };

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BarberInput>({
    resolver: zodResolver(barberSchema),
    defaultValues: defaults,
  });

  function onSubmit(values: BarberInput) {
    startTransition(async () => {
      const result =
        mode.kind === 'edit'
          ? await updateBarber({ id: mode.barber.id, ...values })
          : await createBarber(values);
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
          <Label htmlFor="display_name" required>
            {t('form.displayName')}
          </Label>
          <Input
            id="display_name"
            invalid={Boolean(errors.display_name)}
            {...register('display_name')}
          />
          {errors.display_name ? <FieldHint error>{tErr('field.NAME_REQUIRED')}</FieldHint> : null}
        </div>

        <div>
          <Label htmlFor="email">{t('form.email')}</Label>
          <Input id="email" type="email" invalid={Boolean(errors.email)} {...register('email')} />
        </div>

        <div>
          <Label htmlFor="phone">{t('form.phone')}</Label>
          <PhoneInput id="phone" {...register('phone')} />
        </div>

        <div>
          <Label htmlFor="personnel_id">{t('form.personnelId')}</Label>
          <Input id="personnel_id" {...register('personnel_id')} />
        </div>

        <div>
          <Label htmlFor="status">{t('form.status')}</Label>
          <Select id="status" {...register('status')}>
            {SHOP_MEMBER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`tabs.${s}`)}
              </option>
            ))}
          </Select>
        </div>
      </form>
    </Modal>
  );
}
