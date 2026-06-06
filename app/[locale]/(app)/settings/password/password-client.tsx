'use client';

import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { FieldHint, Input, Label } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { changePassword, changePasswordSchema, type ChangePasswordInput } from './actions';

export function PasswordClient() {
  const t = useTranslations('pages.settings.password');
  const tNav = useTranslations('pages.settings.nav');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current_password: '', new_password: '', confirm_password: '' },
  });

  function onSubmit(values: ChangePasswordInput) {
    startTransition(async () => {
      const result = await changePassword(values);
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.changed') });
        reset();
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  return (
    <>
      <PageHeader eyebrow={tNav('title')} title={t('title')} />
      <form onSubmit={handleSubmit(onSubmit)} className="mx-auto max-w-md p-6" noValidate>
        <div className="surface-hero space-y-4 p-6">
          <div>
            <Label htmlFor="current_password" required>
              {t('form.current')}
            </Label>
            <Input
              id="current_password"
              type="password"
              autoComplete="current-password"
              invalid={Boolean(errors.current_password)}
              {...register('current_password')}
            />
          </div>
          <div>
            <Label htmlFor="new_password" required>
              {t('form.new')}
            </Label>
            <Input
              id="new_password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              invalid={Boolean(errors.new_password)}
              {...register('new_password')}
            />
          </div>
          <div>
            <Label htmlFor="confirm_password" required>
              {t('form.confirm')}
            </Label>
            <Input
              id="confirm_password"
              type="password"
              autoComplete="new-password"
              invalid={Boolean(errors.confirm_password)}
              {...register('confirm_password')}
            />
            {errors.confirm_password ? <FieldHint error>{t('form.dontMatch')}</FieldHint> : null}
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" loading={isPending}>
              {tCommon('actions.save')}
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
