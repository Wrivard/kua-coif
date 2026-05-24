'use client';

import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { FieldHint, Input, Label, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { PhoneInput } from '@/components/ui/phone-input';
import { useToast } from '@/components/ui/toast';
import type { ClientRow } from '@/db/rows';
import { createClient, updateClient } from './actions';
import { clientSchema, type ClientInput } from './schema';

type Mode = { kind: 'add' } | { kind: 'edit'; client: ClientRow };

export function ClientFormModal({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  const t = useTranslations('pages.clients');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  const defaults: ClientInput =
    mode.kind === 'edit'
      ? {
          first_name: mode.client.first_name,
          last_name: mode.client.last_name,
          email: mode.client.email,
          phone: mode.client.phone,
          notes: mode.client.notes,
        }
      : { first_name: '', last_name: null, email: null, phone: null, notes: null };

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClientInput>({
    resolver: zodResolver(clientSchema),
    defaultValues: defaults,
  });

  function onSubmit(values: ClientInput) {
    startTransition(async () => {
      const result =
        mode.kind === 'edit'
          ? await updateClient({ id: mode.client.id, ...values })
          : await createClient(values);
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
        <div>
          <Label htmlFor="first_name" required>
            {t('form.firstName')}
          </Label>
          <Input id="first_name" invalid={Boolean(errors.first_name)} {...register('first_name')} />
          {errors.first_name ? <FieldHint error>{tErr('field.NAME_REQUIRED')}</FieldHint> : null}
        </div>

        <div>
          <Label htmlFor="last_name">{t('form.lastName')}</Label>
          <Input id="last_name" {...register('last_name')} />
        </div>

        <div>
          <Label htmlFor="email">{t('form.email')}</Label>
          <Input id="email" type="email" invalid={Boolean(errors.email)} {...register('email')} />
        </div>

        <div>
          <Label htmlFor="phone">{t('form.phone')}</Label>
          <PhoneInput id="phone" {...register('phone')} />
        </div>

        <div className="md:col-span-2">
          <Label htmlFor="notes">{t('form.notes')}</Label>
          <Textarea id="notes" rows={3} {...register('notes')} />
        </div>
      </form>
    </Modal>
  );
}
