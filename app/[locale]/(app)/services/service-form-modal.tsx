'use client';

import { useTransition } from 'react';
import { useForm, type FieldError } from 'react-hook-form';
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

// Services W3 #6 (products-W0 parity) — defensive number parse for the money
// fields: paste / mixed-locale input ("12,50", "abc") becomes NaN so zod's
// invalid_type error FIRES instead of silently saving a wrong amount.
function toNumber(v: unknown): number {
  const s = String(v ?? '')
    .trim()
    .replace(',', '.');
  return s === '' ? NaN : Number(s);
}

// Dollars (string input) → integer cents, NaN-preserving: garbage used to
// coerce to 0 silently ("abc" saved a 0$ deposit with zero feedback).
function toCents(v: unknown): number {
  const n = toNumber(v);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

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
    setError,
    formState: { errors },
  } = useForm<ServiceInput>({
    resolver: zodResolver(serviceSchema),
    defaultValues: defaults,
  });

  const selectedTaxIds = watch('tax_ids');

  // Services W3 #6 — map RHF/zod errors to a localized, field-appropriate
  // hint (products-W0 idiom). Covers the schema's custom codes and zod's
  // default issue types (invalid_type / too_small / too_big).
  function fieldError(err: FieldError | undefined, kind: 'name' | 'amount'): string | null {
    if (!err) return null;
    switch (kind) {
      case 'name':
        if (err.message === 'NAME_DUPLICATE') return t('form.errors.nameDuplicate');
        return err.type === 'too_big' ? t('form.errors.nameTooLong') : tErr('field.NAME_REQUIRED');
      case 'amount':
        return t('form.errors.amount');
    }
  }

  function onSubmit(values: ServiceInput) {
    startTransition(async () => {
      const result =
        mode.kind === 'edit'
          ? await updateService({
              id: mode.service.id,
              // Services W2b — optimistic-concurrency precondition: the server
              // rejects the write (CONFLICT + {concurrency:'stale'}) if someone
              // else edited this service since it was loaded.
              expected_updated_at: mode.service.updated_at,
              ...values,
            })
          : await createService(values);

      if (result.ok) {
        show({
          variant: 'success',
          title: mode.kind === 'edit' ? t('toasts.updated') : t('toasts.created'),
        });
        onClose();
        return;
      }
      // Services W2b — the two distinct CONFLICT shapes the server returns.
      if (result.errorCode === 'CONFLICT' && result.fieldErrors?.name === 'duplicate') {
        // Duplicate per-shop service name → surface INLINE on the name field.
        setError('name', { type: 'manual', message: 'NAME_DUPLICATE' });
        return;
      }
      if (result.errorCode === 'CONFLICT' && result.fieldErrors?.concurrency === 'stale') {
        // Stale precondition — no automatic re-fetch (scope), just tell the user.
        show({ variant: 'danger', title: t('toasts.staleConflict') });
        return;
      }
      show({ variant: 'danger', title: tErr(result.errorCode) });
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
        className="grid grid-cols-1 gap-6 md:grid-cols-2"
        noValidate
      >
        <div className="md:col-span-2">
          <Label htmlFor="name" required>
            {t('form.name')}
          </Label>
          <Input
            id="name"
            invalid={Boolean(errors.name)}
            aria-invalid={errors.name ? true : undefined}
            {...register('name')}
          />
          {errors.name ? <FieldHint error>{fieldError(errors.name, 'name')}</FieldHint> : null}
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
            aria-invalid={errors.duration_min ? true : undefined}
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
            aria-invalid={errors.price ? true : undefined}
            {...register('price', { setValueAs: toNumber })}
          />
          {errors.price ? <FieldHint error>{fieldError(errors.price, 'amount')}</FieldHint> : null}
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
              `toCents` converts string "12.50" → 1250 cents on submit —
              and keeps NaN on garbage so the error SHOWS instead of the old
              silent 0$ coercion (W3 #6). */}
          <MoneyInput
            id="deposit_amount_cents"
            placeholder="0.00"
            invalid={Boolean(errors.deposit_amount_cents)}
            aria-invalid={errors.deposit_amount_cents ? true : undefined}
            {...register('deposit_amount_cents', { setValueAs: toCents })}
            defaultValue={(defaults.deposit_amount_cents / 100).toFixed(2)}
          />
          {errors.deposit_amount_cents ? (
            <FieldHint error>{fieldError(errors.deposit_amount_cents, 'amount')}</FieldHint>
          ) : (
            <FieldHint>{t('form.depositHint')}</FieldHint>
          )}
        </div>

        <div className="md:col-span-2">
          <Label>{t('form.taxes')}</Label>
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-bg-surface p-3 shadow-sm">
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
