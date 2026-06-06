'use client';

import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { PageHeader } from '@/components/ui/page-header';
import { RadioGroup } from '@/components/ui/radio-group';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import type { LoyaltyProgramRow } from '@/db/rows';
import { upsertLoyalty } from './actions';
// Loop 59 hotfix — schema + type live in `./schema` not `./actions`
// because the latter is `'use server'` and the bundler strips
// non-function exports from the client bundle.
import { loyaltySchema, type LoyaltyInput } from './schema';

export function LoyaltyClient({ row }: { row: LoyaltyProgramRow | null }) {
  const t = useTranslations('pages.settings.loyalty');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  const defaults: LoyaltyInput = row
    ? {
        enabled: row.enabled,
        type: row.type,
        goal_count: row.goal_count,
        min_transaction_amount: row.min_transaction_amount,
        reward_amount: row.reward_amount,
        include_product_sales: row.include_product_sales,
        include_tips: row.include_tips,
      }
    : {
        enabled: false,
        type: 'transaction',
        goal_count: 0,
        min_transaction_amount: 0,
        reward_amount: 0,
        include_product_sales: false,
        include_tips: false,
      };

  const { register, handleSubmit, watch, setValue } = useForm<LoyaltyInput>({
    resolver: zodResolver(loyaltySchema),
    defaultValues: defaults,
  });

  const enabled = watch('enabled');
  const type = watch('type');

  function onSubmit(values: LoyaltyInput) {
    startTransition(async () => {
      const result = await upsertLoyalty(values);
      if (result.ok) show({ variant: 'success', title: t('toasts.saved') });
      else show({ variant: 'danger', title: tErr(result.errorCode) });
    });
  }

  return (
    <>
      <PageHeader title={t('title')} />
      <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl space-y-6 p-6" noValidate>
        <Toggle
          checked={enabled}
          onChange={(v) => setValue('enabled', v, { shouldDirty: true })}
          label={t('form.enabled')}
        />

        <div>
          <Label>{t('form.type')}</Label>
          <RadioGroup
            name="type"
            value={type}
            onChange={(v) => setValue('type', v, { shouldDirty: true })}
            orientation="horizontal"
            options={[
              { value: 'transaction', label: t('form.transactionBased') },
              { value: 'value', label: t('form.valueBased') },
            ]}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <Label htmlFor="goal_count">
              {type === 'value' ? t('form.goalValueAmount') : t('form.goalCount')}
            </Label>
            <Input
              id="goal_count"
              type="number"
              min={0}
              disabled={!enabled}
              {...register('goal_count', { valueAsNumber: true })}
            />
          </div>
          <div>
            <Label htmlFor="min_transaction_amount">{t('form.minTransactionAmount')}</Label>
            <MoneyInput
              id="min_transaction_amount"
              disabled={!enabled}
              {...register('min_transaction_amount', { valueAsNumber: true })}
            />
          </div>
          <div>
            <Label htmlFor="reward_amount">{t('form.rewardAmount')}</Label>
            <MoneyInput
              id="reward_amount"
              disabled={!enabled}
              {...register('reward_amount', { valueAsNumber: true })}
            />
          </div>
        </div>

        <Toggle
          checked={watch('include_product_sales')}
          onChange={(v) => setValue('include_product_sales', v, { shouldDirty: true })}
          label={t('form.includeProductSales')}
          disabled={!enabled}
        />
        <Toggle
          checked={watch('include_tips')}
          onChange={(v) => setValue('include_tips', v, { shouldDirty: true })}
          label={t('form.includeTips')}
          disabled={!enabled}
        />

        <div className="flex justify-end gap-2">
          <Button type="submit" loading={isPending}>
            {tCommon('actions.save')}
          </Button>
        </div>
      </form>
    </>
  );
}
