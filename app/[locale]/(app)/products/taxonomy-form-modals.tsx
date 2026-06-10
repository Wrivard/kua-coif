'use client';

import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { FieldHint, Input, Label } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import type { ProductBrandRow, ProductCategoryRow } from '@/db/rows';
import { createBrand, createCategory, updateBrand, updateCategory } from './actions';
import { brandSchema, categorySchema } from './schema';

type BrandMode = { kind: 'add' } | { kind: 'edit'; brand: ProductBrandRow };
type CategoryMode = { kind: 'add' } | { kind: 'edit'; category: ProductCategoryRow };

type NameForm = { name: string };

export function BrandFormModal({ mode, onClose }: { mode: BrandMode; onClose: () => void }) {
  const t = useTranslations('pages.products');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<NameForm>({
    resolver: zodResolver(brandSchema),
    defaultValues: { name: mode.kind === 'edit' ? mode.brand.name : '' },
  });

  function onSubmit({ name }: NameForm) {
    startTransition(async () => {
      const result =
        mode.kind === 'edit'
          ? await updateBrand({ id: mode.brand.id, name })
          : await createBrand({ name });
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.brandSaved') });
        onClose();
      } else if (result.errorCode === 'CONFLICT') {
        // The only CONFLICT a create/edit can raise is a duplicate name — say
        // so instead of the generic "reload and retry".
        show({ variant: 'danger', title: t('conflicts.brandDuplicate') });
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={mode.kind === 'edit' ? t('brands.editTitle') : t('brands.addTitle')}
      size="sm"
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
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <Label htmlFor="brand-name" required>
          {t('brands.name')}
        </Label>
        <Input id="brand-name" invalid={Boolean(errors.name)} {...register('name')} />
        {errors.name ? <FieldHint error>{tErr('field.NAME_REQUIRED')}</FieldHint> : null}
      </form>
    </Modal>
  );
}

export function CategoryFormModal({ mode, onClose }: { mode: CategoryMode; onClose: () => void }) {
  const t = useTranslations('pages.products');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<NameForm>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: mode.kind === 'edit' ? mode.category.name : '' },
  });

  function onSubmit({ name }: NameForm) {
    startTransition(async () => {
      const result =
        mode.kind === 'edit'
          ? await updateCategory({ id: mode.category.id, name })
          : await createCategory({ name });
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.categorySaved') });
        onClose();
      } else if (result.errorCode === 'CONFLICT') {
        // The only CONFLICT a create/edit can raise is a duplicate name — say
        // so instead of the generic "reload and retry".
        show({ variant: 'danger', title: t('conflicts.categoryDuplicate') });
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={mode.kind === 'edit' ? t('categories.editTitle') : t('categories.addTitle')}
      size="sm"
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
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <Label htmlFor="category-name" required>
          {t('categories.name')}
        </Label>
        <Input id="category-name" invalid={Boolean(errors.name)} {...register('name')} />
        {errors.name ? <FieldHint error>{tErr('field.NAME_REQUIRED')}</FieldHint> : null}
      </form>
    </Modal>
  );
}
