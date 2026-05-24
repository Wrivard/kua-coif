'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { PageHeader } from '@/components/ui/page-header';
import { PhoneInput } from '@/components/ui/phone-input';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import { DATE_FORMATS, PAYOUT_DISCOUNT_MODES } from '@/db/enums';
import { updateShopDetails, updateShopHours } from './actions';
import {
  shopDetailsSchema,
  shopHoursSchema,
  type ShopDetailsInput,
  type ShopHoursInput,
} from './schema';

export type ShopFullRow = ShopDetailsInput & { id: string };
export type ShopHourRow = {
  weekday: number;
  enabled: boolean;
  open_time: string | null;
  close_time: string | null;
};

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

const COMMON_TIMEZONES = [
  'America/Toronto',
  'America/Montreal',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Vancouver',
];

export function ShopDetailsClient({ shop, hours }: { shop: ShopFullRow; hours: ShopHourRow[] }) {
  const t = useTranslations('pages.settings.shop');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  // Details form ───────────────────────────────────────────────────────────
  const detailsForm = useForm<ShopDetailsInput>({
    resolver: zodResolver(shopDetailsSchema),
    defaultValues: {
      name: shop.name,
      alias: shop.alias,
      website: shop.website,
      phone: shop.phone,
      email: shop.email,
      instagram: shop.instagram,
      yelp_id: shop.yelp_id,
      timezone: shop.timezone,
      date_format: shop.date_format,
      default_language: shop.default_language as 'fr' | 'en',
      default_cash_drawer_balance: shop.default_cash_drawer_balance,
      description: shop.description,
      country: shop.country,
      street: shop.street,
      street2: shop.street2,
      municipality: shop.municipality,
      province: shop.province,
      postal_code: shop.postal_code,
      age_21_only: shop.age_21_only,
      allow_booking_any_barber: shop.allow_booking_any_barber,
      gross_up_fees: shop.gross_up_fees,
      use_prod_price_in_tips: shop.use_prod_price_in_tips,
      use_taxes_in_tips: shop.use_taxes_in_tips,
      client_reviews: shop.client_reviews,
      payout_discount_mode: shop.payout_discount_mode,
    },
  });

  // Hours form ─────────────────────────────────────────────────────────────
  // Build a 7-row array, padding missing days with sensible defaults.
  const [hoursState, setHoursState] = useState<ShopHoursInput>(() => {
    const byWeekday = new Map(hours.map((h) => [h.weekday, h]));
    return Array.from({ length: 7 }, (_, weekday): ShopHoursInput[number] => {
      const h = byWeekday.get(weekday);
      return {
        weekday,
        enabled: h?.enabled ?? false,
        open_time: h?.open_time ?? '10:00',
        close_time: h?.close_time ?? '19:00',
      };
    });
  });

  function onDetailsSubmit(values: ShopDetailsInput) {
    startTransition(async () => {
      const result = await updateShopDetails(values);
      if (result.ok) show({ variant: 'success', title: t('toasts.saved') });
      else show({ variant: 'danger', title: tErr(result.errorCode) });
    });
  }

  function onHoursSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = shopHoursSchema.safeParse(hoursState);
    if (!parsed.success) {
      show({ variant: 'danger', title: tErr('INVALID_INPUT') });
      return;
    }
    startTransition(async () => {
      const result = await updateShopHours(parsed.data);
      if (result.ok) show({ variant: 'success', title: t('toasts.savedHours') });
      else show({ variant: 'danger', title: tErr(result.errorCode) });
    });
  }

  const detailsErrors = detailsForm.formState.errors;

  return (
    <>
      <PageHeader title={t('title')} />
      <div className="max-w-4xl space-y-6 p-6">
        {/* ─── Identity ──────────────────────────────────────────────────── */}
        <form onSubmit={detailsForm.handleSubmit(onDetailsSubmit)} className="space-y-6" noValidate>
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.identity')}</CardTitle>
            </CardHeader>
            <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label htmlFor="name" required>
                  {t('form.name')}
                </Label>
                <Input
                  id="name"
                  invalid={Boolean(detailsErrors.name)}
                  {...detailsForm.register('name')}
                />
              </div>
              <div>
                <Label htmlFor="alias">{t('form.alias')}</Label>
                <Input id="alias" {...detailsForm.register('alias')} />
              </div>
              <div>
                <Label htmlFor="website">{t('form.website')}</Label>
                <Input id="website" type="url" {...detailsForm.register('website')} />
              </div>
              <div>
                <Label htmlFor="phone">{t('form.phone')}</Label>
                <PhoneInput id="phone" {...detailsForm.register('phone')} />
              </div>
              <div>
                <Label htmlFor="email">{t('form.email')}</Label>
                <Input id="email" type="email" {...detailsForm.register('email')} />
              </div>
              <div>
                <Label htmlFor="instagram">{t('form.instagram')}</Label>
                <Input id="instagram" {...detailsForm.register('instagram')} />
              </div>
              <div>
                <Label htmlFor="yelp_id">{t('form.yelpId')}</Label>
                <Input id="yelp_id" {...detailsForm.register('yelp_id')} />
              </div>
              <div>
                <Label htmlFor="timezone">{t('form.timezone')}</Label>
                <Select id="timezone" {...detailsForm.register('timezone')}>
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="date_format">{t('form.dateFormat')}</Label>
                <Select id="date_format" {...detailsForm.register('date_format')}>
                  {DATE_FORMATS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="default_language">{t('form.defaultLanguage')}</Label>
                <Select id="default_language" {...detailsForm.register('default_language')}>
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="default_cash_drawer_balance">{t('form.cashDrawer')}</Label>
                <MoneyInput
                  id="default_cash_drawer_balance"
                  {...detailsForm.register('default_cash_drawer_balance', { valueAsNumber: true })}
                />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="description">{t('form.description')}</Label>
                <Textarea id="description" rows={2} {...detailsForm.register('description')} />
              </div>
            </CardBody>
          </Card>

          {/* ─── Location ────────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.location')}</CardTitle>
            </CardHeader>
            <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="country">{t('form.country')}</Label>
                <Input id="country" {...detailsForm.register('country')} />
              </div>
              <div>
                <Label htmlFor="street">{t('form.street')}</Label>
                <Input id="street" {...detailsForm.register('street')} />
              </div>
              <div>
                <Label htmlFor="street2">{t('form.street2')}</Label>
                <Input id="street2" {...detailsForm.register('street2')} />
              </div>
              <div>
                <Label htmlFor="municipality">{t('form.municipality')}</Label>
                <Input id="municipality" {...detailsForm.register('municipality')} />
              </div>
              <div>
                <Label htmlFor="province">{t('form.province')}</Label>
                <Input id="province" {...detailsForm.register('province')} />
              </div>
              <div>
                <Label htmlFor="postal_code">{t('form.postalCode')}</Label>
                <Input id="postal_code" {...detailsForm.register('postal_code')} />
              </div>
            </CardBody>
          </Card>

          {/* ─── Options ─────────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.options')}</CardTitle>
            </CardHeader>
            <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Toggle
                checked={detailsForm.watch('age_21_only')}
                onChange={(v) => detailsForm.setValue('age_21_only', v, { shouldDirty: true })}
                label={t('options.age21')}
              />
              <Toggle
                checked={detailsForm.watch('allow_booking_any_barber')}
                onChange={(v) =>
                  detailsForm.setValue('allow_booking_any_barber', v, { shouldDirty: true })
                }
                label={t('options.allowAnyBarber')}
              />
              <Toggle
                checked={detailsForm.watch('gross_up_fees')}
                onChange={(v) => detailsForm.setValue('gross_up_fees', v, { shouldDirty: true })}
                label={t('options.grossUpFees')}
              />
              <Toggle
                checked={detailsForm.watch('use_prod_price_in_tips')}
                onChange={(v) =>
                  detailsForm.setValue('use_prod_price_in_tips', v, { shouldDirty: true })
                }
                label={t('options.useProdPriceInTips')}
              />
              <Toggle
                checked={detailsForm.watch('use_taxes_in_tips')}
                onChange={(v) =>
                  detailsForm.setValue('use_taxes_in_tips', v, { shouldDirty: true })
                }
                label={t('options.useTaxesInTips')}
              />
              <Toggle
                checked={detailsForm.watch('client_reviews')}
                onChange={(v) => detailsForm.setValue('client_reviews', v, { shouldDirty: true })}
                label={t('options.clientReviews')}
              />
              <div className="md:col-span-2">
                <Label htmlFor="payout_discount_mode">{t('options.payoutDiscountMode')}</Label>
                <Select id="payout_discount_mode" {...detailsForm.register('payout_discount_mode')}>
                  {PAYOUT_DISCOUNT_MODES.map((m) => (
                    <option key={m} value={m}>
                      {t(`options.payoutModes.${m}`)}
                    </option>
                  ))}
                </Select>
              </div>
            </CardBody>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" loading={isPending}>
              {tCommon('actions.save')}
            </Button>
          </div>
        </form>

        {/* ─── Schedule (separate submit) ─────────────────────────────── */}
        <form onSubmit={onHoursSubmit}>
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.schedule')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
              {hoursState.map((h, idx) => (
                <div
                  key={h.weekday}
                  className="grid grid-cols-1 items-center gap-3 border-b border-border pb-2 last:border-b-0 last:pb-0 md:grid-cols-[140px_1fr_1fr_1fr]"
                >
                  <Toggle
                    checked={h.enabled}
                    onChange={(v) => {
                      const next = [...hoursState];
                      next[idx] = { ...next[idx]!, enabled: v };
                      setHoursState(next);
                    }}
                    label={t(`weekdays.${WEEKDAYS[h.weekday]}`)}
                  />
                  <div>
                    <Label htmlFor={`open-${h.weekday}`}>{t('form.open')}</Label>
                    <Input
                      id={`open-${h.weekday}`}
                      type="time"
                      disabled={!h.enabled}
                      value={h.open_time ?? ''}
                      onChange={(e) => {
                        const next = [...hoursState];
                        next[idx] = { ...next[idx]!, open_time: e.target.value || null };
                        setHoursState(next);
                      }}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`close-${h.weekday}`}>{t('form.close')}</Label>
                    <Input
                      id={`close-${h.weekday}`}
                      type="time"
                      disabled={!h.enabled}
                      value={h.close_time ?? ''}
                      onChange={(e) => {
                        const next = [...hoursState];
                        next[idx] = { ...next[idx]!, close_time: e.target.value || null };
                        setHoursState(next);
                      }}
                    />
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
          <div className="mt-4 flex justify-end">
            <Button type="submit" loading={isPending}>
              {tCommon('actions.save')}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
