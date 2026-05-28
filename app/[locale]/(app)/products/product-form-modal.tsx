'use client';

import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
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
          <Input id="name" invalid={Boolean(errors.name)} {...register('name')} />
          {errors.name ? <FieldHint error>{tErr('field.NAME_REQUIRED')}</FieldHint> : null}
        </div>

        <div>
          <Label htmlFor="brand_id">{t('form.brand')}</Label>
          <Select id="brand_id" {...register('brand_id')}>
            <option value="">—</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="category_id">{t('form.category')}</Label>
          <Select id="category_id" {...register('category_id')}>
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="price" required>
            {t('form.price')}
          </Label>
          <MoneyInput id="price" {...register('price', { valueAsNumber: true })} />
        </div>

        <div>
          <Label htmlFor="supply_price">{t('form.supplyPrice')}</Label>
          <MoneyInput id="supply_price" {...register('supply_price', { valueAsNumber: true })} />
        </div>

        <div>
          <Label htmlFor="current_inventory">{t('form.currentInventory')}</Label>
          <Input
            id="current_inventory"
            type="number"
            min={0}
            {...register('current_inventory', { valueAsNumber: true })}
          />
        </div>

        <div>
          <Label htmlFor="low_inventory_threshold">{t('form.lowInventoryThreshold')}</Label>
          <Input
            id="low_inventory_threshold"
            type="number"
            min={0}
            {...register('low_inventory_threshold', { valueAsNumber: true })}
          />
        </div>

        <div className="md:col-span-2">
          <Label htmlFor="sku">{t('form.sku')}</Label>
          <Input id="sku" {...register('sku')} />
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
