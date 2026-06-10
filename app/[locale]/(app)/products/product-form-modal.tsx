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
import type { ProductBrandRow, ProductCategoryRow, ProductRow, TaxRow } from '@/db/rows';
import { createProduct, updateProduct } from './actions';
import { productSchema, type ProductInput } from './schema';

type Mode = { kind: 'add' } | { kind: 'edit'; product: ProductRow };

type Props = {
  mode: Mode;
  brands: ProductBrandRow[];
  categories: ProductCategoryRow[];
  taxes: TaxRow[];
  existingTaxIds: string[];
  onClose: () => void;
};

// W0 — normalize a money/quantity field BEFORE zod sees it: accept the fr
// decimal comma ("12,50") and turn a blank into NaN (not 0) so the zod
// `invalid_type` error fires instead of silently saving 0. The native
// `type="number"` already dot-normalizes per OS locale; this is the defensive
// net for paste / mixed-locale input. Done in the form (option A) — the shared
// MoneyInput is left untouched so the other 7 consumers don't change.
function toNumber(v: unknown): number {
  const s = String(v ?? '')
    .trim()
    .replace(',', '.');
  return s === '' ? NaN : Number(s);
}

// W0 — the blank `<option value="">` must become `null`, not `""` (which fails
// the schema's `z.string().uuid().nullable()` and silently blocked the submit).
function emptyToNull(v: unknown): string | null {
  return v === '' || v == null ? null : (v as string);
}

export function ProductFormModal({
  mode,
  brands,
  categories,
  taxes,
  existingTaxIds,
  onClose,
}: Props) {
  const t = useTranslations('pages.products');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  // W0 — map a react-hook-form error (zod issue `type` + custom `message` code)
  // to a localized, field-appropriate hint. Covers the custom codes
  // (NAME_REQUIRED, INVALID_PRICE_PRECISION from the server's incoming
  // multipleOf) and zod's default issue types (invalid_type / too_small /
  // too_big / not_multiple_of).
  function fieldError(
    err: FieldError | undefined,
    kind: 'name' | 'amount' | 'quantity' | 'sku' | 'select',
  ): string | null {
    if (!err) return null;
    if (err.message === 'INVALID_PRICE_PRECISION') return tErr('field.INVALID_PRICE_PRECISION');
    switch (kind) {
      case 'name':
        return err.type === 'too_big'
          ? t('form.errors.nameTooLong')
          : t('form.errors.nameRequired');
      case 'amount':
        return err.type === 'not_multiple_of'
          ? t('form.errors.amountPrecision')
          : t('form.errors.amount');
      case 'quantity':
        return t('form.errors.quantity');
      case 'sku':
        return t('form.errors.sku');
      case 'select':
        return t('form.errors.select');
    }
  }

  const defaults: ProductInput =
    mode.kind === 'edit'
      ? {
          name: mode.product.name,
          brand_id: mode.product.brand_id,
          category_id: mode.product.category_id,
          price: mode.product.price,
          supply_price: mode.product.supply_price,
          current_inventory: mode.product.current_inventory,
          low_inventory_threshold: mode.product.low_inventory_threshold,
          sku: mode.product.sku,
          tax_ids: existingTaxIds,
        }
      : {
          name: '',
          brand_id: brands[0]?.id ?? null,
          category_id: categories[0]?.id ?? null,
          price: 0,
          supply_price: 0,
          current_inventory: 0,
          low_inventory_threshold: 0,
          sku: null,
          tax_ids: [],
        };

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ProductInput>({
    resolver: zodResolver(productSchema),
    defaultValues: defaults,
  });

  const selectedTaxIds = watch('tax_ids');

  function onSubmit(values: ProductInput) {
    startTransition(async () => {
      const result =
        mode.kind === 'edit'
          ? await updateProduct({ id: mode.product.id, ...values })
          : await createProduct(values);
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
          <Label htmlFor="brand_id">{t('form.brand')}</Label>
          <Select
            id="brand_id"
            invalid={Boolean(errors.brand_id)}
            aria-invalid={errors.brand_id ? true : undefined}
            {...register('brand_id', { setValueAs: emptyToNull })}
          >
            <option value=""></option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          {errors.brand_id ? (
            <FieldHint error>{fieldError(errors.brand_id, 'select')}</FieldHint>
          ) : null}
        </div>

        <div>
          <Label htmlFor="category_id">{t('form.category')}</Label>
          <Select
            id="category_id"
            invalid={Boolean(errors.category_id)}
            aria-invalid={errors.category_id ? true : undefined}
            {...register('category_id', { setValueAs: emptyToNull })}
          >
            <option value=""></option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          {errors.category_id ? (
            <FieldHint error>{fieldError(errors.category_id, 'select')}</FieldHint>
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
          <Label htmlFor="supply_price">{t('form.supplyPrice')}</Label>
          <MoneyInput
            id="supply_price"
            invalid={Boolean(errors.supply_price)}
            aria-invalid={errors.supply_price ? true : undefined}
            {...register('supply_price', { setValueAs: toNumber })}
          />
          {errors.supply_price ? (
            <FieldHint error>{fieldError(errors.supply_price, 'amount')}</FieldHint>
          ) : null}
        </div>

        <div>
          <Label htmlFor="current_inventory">{t('form.currentInventory')}</Label>
          <Input
            id="current_inventory"
            type="number"
            min={0}
            invalid={Boolean(errors.current_inventory)}
            aria-invalid={errors.current_inventory ? true : undefined}
            {...register('current_inventory', { setValueAs: toNumber })}
          />
          {errors.current_inventory ? (
            <FieldHint error>{fieldError(errors.current_inventory, 'quantity')}</FieldHint>
          ) : null}
        </div>

        <div>
          <Label htmlFor="low_inventory_threshold">{t('form.lowInventoryThreshold')}</Label>
          <Input
            id="low_inventory_threshold"
            type="number"
            min={0}
            invalid={Boolean(errors.low_inventory_threshold)}
            aria-invalid={errors.low_inventory_threshold ? true : undefined}
            {...register('low_inventory_threshold', { setValueAs: toNumber })}
          />
          {errors.low_inventory_threshold ? (
            <FieldHint error>{fieldError(errors.low_inventory_threshold, 'quantity')}</FieldHint>
          ) : null}
        </div>

        <div className="md:col-span-2">
          <Label htmlFor="sku">{t('form.sku')}</Label>
          <Input
            id="sku"
            invalid={Boolean(errors.sku)}
            aria-invalid={errors.sku ? true : undefined}
            {...register('sku')}
          />
          {errors.sku ? <FieldHint error>{fieldError(errors.sku, 'sku')}</FieldHint> : null}
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
