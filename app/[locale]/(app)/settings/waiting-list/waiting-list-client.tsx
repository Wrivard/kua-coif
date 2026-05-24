'use client';

import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import { upsertWaitingList, waitingListSchema, type WaitingListInput } from './actions';

export function WaitingListClient({ initial }: { initial: WaitingListInput }) {
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

  return (
    <>
      <PageHeader title={t('title')} />
      <form onSubmit={handleSubmit(onSubmit)} className="max-w-xl p-6" noValidate>
        <Card>
          <CardHeader>
            <CardTitle>{t('title')}</CardTitle>
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
    </>
  );
}
