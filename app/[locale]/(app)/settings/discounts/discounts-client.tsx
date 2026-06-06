'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { PageHeader } from '@/components/ui/page-header';
import { RowActions } from '@/components/ui/row-actions';
import { useToast } from '@/components/ui/toast';
import { formatCurrencyCAD } from '@/lib/utils';
import type { DiscountRow } from '@/db/rows';
import { DiscountFormModal } from './discount-form-modal';
import { deleteDiscount } from './actions';

type Mode = { kind: 'closed' } | { kind: 'add' } | { kind: 'edit'; discount: DiscountRow };

export function DiscountsClient({
  locale,
  discounts,
}: {
  locale: string;
  discounts: DiscountRow[];
}) {
  const t = useTranslations('pages.settings.discounts');
  const tNav = useTranslations('pages.settings.nav');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [mode, setMode] = useState<Mode>({ kind: 'closed' });
  const [confirmDelete, setConfirmDelete] = useState<DiscountRow | null>(null);
  const [isPending, startTransition] = useTransition();

  function onDelete(row: DiscountRow) {
    startTransition(async () => {
      const result = await deleteDiscount({ id: row.id });
      setConfirmDelete(null);
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.deleted', { name: row.name }) });
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  const columns: ReadonlyArray<ColumnDef<DiscountRow>> = [
    {
      id: 'name',
      header: t('columns.name'),
      cell: (r) => <span className="font-medium">{r.name}</span>,
      sortable: true,
      sortValue: (r) => r.name.toLowerCase(),
    },
    {
      id: 'value',
      header: t('columns.value'),
      cell: (r) => (
        <span className="font-medium tabular-nums text-accent">
          {r.type === 'percent'
            ? `${r.value}%`
            : formatCurrencyCAD(r.value, locale === 'fr' ? 'fr' : 'en')}
        </span>
      ),
      sortable: true,
      sortValue: (r) => r.value,
      align: 'right',
      width: '110px',
    },
    {
      id: 'assignment',
      header: t('columns.assignment'),
      cell: (r) => <Badge variant="default">{t(`assignment.${r.assignment}`)}</Badge>,
      width: '160px',
    },
    {
      id: 'actions',
      header: '',
      width: '90px',
      align: 'right',
      cell: (r) => (
        <RowActions
          actions={[
            {
              icon: Pencil,
              label: tCommon('actions.edit'),
              onClick: () => setMode({ kind: 'edit', discount: r }),
            },
            {
              icon: Trash2,
              label: tCommon('actions.delete'),
              tone: 'danger',
              onClick: () => setConfirmDelete(r),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow={tNav('title')}
        title={t('title')}
        actions={
          <Button onClick={() => setMode({ kind: 'add' })} size="sm">
            <Plus className="h-4 w-4" /> {t('addDiscount')}
          </Button>
        }
      />

      <div className="p-6">
        <DataTable
          columns={columns}
          data={discounts}
          getRowKey={(r) => r.id}
          emptyState={{ title: t('emptyTitle'), description: t('emptyHint') }}
        />
      </div>

      {mode.kind !== 'closed' && (
        <DiscountFormModal mode={mode} onClose={() => setMode({ kind: 'closed' })} />
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t('confirmDelete.title')}
        description={
          confirmDelete ? t('confirmDelete.description', { name: confirmDelete.name }) : ''
        }
        destructive
        loading={isPending}
        confirmLabel={tCommon('actions.delete')}
        cancelLabel={tCommon('actions.cancel')}
        onConfirm={() => confirmDelete && onDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}
