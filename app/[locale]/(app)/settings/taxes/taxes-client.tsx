'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import type { TaxRow } from '@/db/rows';
import { TaxFormModal } from './tax-form-modal';
import { deleteTax, updateTax } from './actions';

type Mode = { kind: 'closed' } | { kind: 'add' } | { kind: 'edit'; tax: TaxRow };

export function TaxesClient({ taxes }: { taxes: TaxRow[] }) {
  const t = useTranslations('pages.settings.taxes');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [mode, setMode] = useState<Mode>({ kind: 'closed' });
  const [confirmDelete, setConfirmDelete] = useState<TaxRow | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggleField(row: TaxRow, field: 'add_to_price' | 'external_orders_only' | 'enabled') {
    startTransition(async () => {
      const result = await updateTax({
        id: row.id,
        name: row.name,
        percentage: row.percentage,
        add_to_price: field === 'add_to_price' ? !row.add_to_price : row.add_to_price,
        external_orders_only:
          field === 'external_orders_only' ? !row.external_orders_only : row.external_orders_only,
        enabled: field === 'enabled' ? !row.enabled : row.enabled,
      });
      if (!result.ok) show({ variant: 'danger', title: tErr(result.errorCode) });
    });
  }

  function onDelete(row: TaxRow) {
    startTransition(async () => {
      const result = await deleteTax({ id: row.id });
      setConfirmDelete(null);
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.deleted', { name: row.name }) });
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  const columns: ReadonlyArray<ColumnDef<TaxRow>> = [
    {
      id: 'name',
      header: t('columns.name'),
      cell: (r) => <span className="font-semibold">{r.name}</span>,
      sortable: true,
      sortValue: (r) => r.name.toLowerCase(),
    },
    {
      id: 'percentage',
      header: t('columns.percentage'),
      cell: (r) => `${r.percentage}%`,
      align: 'right',
      width: '120px',
    },
    {
      id: 'add_to_price',
      header: t('columns.addToPrice'),
      align: 'center',
      width: '120px',
      cell: (r) => (
        <div onClick={(e) => e.stopPropagation()} className="flex justify-center">
          <Checkbox checked={r.add_to_price} onChange={() => toggleField(r, 'add_to_price')} />
        </div>
      ),
    },
    {
      id: 'external_orders_only',
      header: t('columns.externalOrdersOnly'),
      align: 'center',
      width: '140px',
      cell: (r) => (
        <div onClick={(e) => e.stopPropagation()} className="flex justify-center">
          <Checkbox
            checked={r.external_orders_only}
            onChange={() => toggleField(r, 'external_orders_only')}
          />
        </div>
      ),
    },
    {
      id: 'enabled',
      header: t('columns.enabled'),
      align: 'center',
      width: '110px',
      cell: (r) => (
        <div onClick={(e) => e.stopPropagation()} className="flex justify-center">
          <Checkbox checked={r.enabled} onChange={() => toggleField(r, 'enabled')} />
        </div>
      ),
    },
    {
      id: 'actions',
      header: '',
      width: '90px',
      align: 'right',
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            aria-label={tCommon('actions.edit')}
            onClick={(e) => {
              e.stopPropagation();
              setMode({ kind: 'edit', tax: r });
            }}
            className="rounded p-1 text-text-muted hover:bg-bg-surface-2 hover:text-text-primary"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={tCommon('actions.delete')}
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDelete(r);
            }}
            className="rounded p-1 text-text-muted hover:bg-bg-surface-2 hover:text-danger"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          <Button onClick={() => setMode({ kind: 'add' })} size="sm">
            <Plus className="h-4 w-4" /> {t('addTax')}
          </Button>
        }
      />

      <div className="p-6">
        <DataTable
          columns={columns}
          data={taxes}
          getRowKey={(r) => r.id}
          emptyState={{ title: t('emptyTitle'), description: t('emptyHint') }}
        />
      </div>

      {mode.kind !== 'closed' && (
        <TaxFormModal mode={mode} onClose={() => setMode({ kind: 'closed' })} />
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
