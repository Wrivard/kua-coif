'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Download, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { formatCurrencyCAD } from '@/lib/utils';
import type { ServiceCategoryRow, ServiceRow, TaxRow } from '@/db/rows';
import { ServiceFormModal } from './service-form-modal';
import { deleteService, toggleServiceStatus } from './actions';

export type ServicesClientProps = {
  locale: string;
  services: ServiceRow[];
  categories: ServiceCategoryRow[];
  taxes: TaxRow[];
  links: Array<{ service_id: string; tax_id: string }>;
};

type Mode = { kind: 'closed' } | { kind: 'add' } | { kind: 'edit'; service: ServiceRow };

export function ServicesClient({
  locale,
  services,
  categories,
  taxes,
  links,
}: ServicesClientProps) {
  const t = useTranslations('pages.services');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();

  const [mode, setMode] = useState<Mode>({ kind: 'closed' });
  const [confirmDelete, setConfirmDelete] = useState<ServiceRow | null>(null);
  const [isPending, startTransition] = useTransition();

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const taxById = useMemo(() => new Map(taxes.map((x) => [x.id, x])), [taxes]);
  const taxIdsByService = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of links) {
      const list = m.get(l.service_id) ?? [];
      list.push(l.tax_id);
      m.set(l.service_id, list);
    }
    return m;
  }, [links]);

  function onDelete(row: ServiceRow) {
    startTransition(async () => {
      const result = await deleteService({ id: row.id });
      setConfirmDelete(null);
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.deleted', { name: row.name }) });
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  function onToggleStatus(row: ServiceRow) {
    startTransition(async () => {
      const result = await toggleServiceStatus({ id: row.id });
      if (result.ok) {
        show({ variant: 'info', title: t('toasts.statusFlipped', { name: row.name }) });
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  const columns: ReadonlyArray<ColumnDef<ServiceRow>> = [
    {
      id: 'name',
      header: t('columns.name'),
      cell: (r) => <span className="font-medium">{r.name}</span>,
      sortable: true,
      sortValue: (r) => r.name.toLowerCase(),
    },
    {
      id: 'duration',
      header: t('columns.duration'),
      cell: (r) => `${r.duration_min} min`,
      sortable: true,
      sortValue: (r) => r.duration_min,
      align: 'right',
      width: '100px',
    },
    {
      id: 'price',
      header: t('columns.price'),
      cell: (r) => formatCurrencyCAD(r.price, locale === 'fr' ? 'fr' : 'en'),
      sortable: true,
      sortValue: (r) => r.price,
      align: 'right',
      width: '120px',
    },
    {
      id: 'tax',
      header: t('columns.tax'),
      cell: (r) => {
        const ids = taxIdsByService.get(r.id) ?? [];
        if (ids.length === 0) return <span className="text-text-muted">—</span>;
        return (
          <div className="flex flex-col text-xs text-text-secondary">
            {ids.map((id) => {
              const tx = taxById.get(id);
              if (!tx) return null;
              return (
                <span key={id}>
                  {tx.name} {tx.percentage}%
                </span>
              );
            })}
          </div>
        );
      },
    },
    {
      id: 'category',
      header: t('columns.category'),
      cell: (r) => {
        if (!r.category_id) return <span className="text-text-muted">—</span>;
        return <span>{categoryById.get(r.category_id)?.name ?? '—'}</span>;
      },
      sortable: true,
      sortValue: (r) => categoryById.get(r.category_id ?? '')?.name ?? '',
    },
    {
      id: 'status',
      header: t('columns.status'),
      width: '110px',
      cell: (r) =>
        r.status === 'enabled' ? (
          <Badge variant="success">{t('status.enabled')}</Badge>
        ) : (
          <Badge>{t('status.disabled')}</Badge>
        ),
    },
    {
      id: 'actions',
      header: '',
      width: '120px',
      align: 'right',
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            aria-label={tCommon('actions.edit')}
            onClick={(e) => {
              e.stopPropagation();
              setMode({ kind: 'edit', service: r });
            }}
            className="rounded-md p-1 text-text-muted transition-colors duration-150 ease-out-quint hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={t('actions.toggleStatus')}
            onClick={(e) => {
              e.stopPropagation();
              onToggleStatus(r);
            }}
            className="rounded-md p-1 text-text-muted transition-colors duration-150 ease-out-quint hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <Power className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={tCommon('actions.delete')}
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDelete(r);
            }}
            className="rounded-md p-1 text-text-muted transition-colors duration-150 ease-out-quint hover:bg-bg-surface-2 hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
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
          <>
            <a
              href="/api/export/services"
              className="inline-flex h-8 items-center gap-2 rounded-sm border border-border bg-bg-surface px-3 text-xs font-medium text-text-primary hover:bg-bg-surface-2"
            >
              <Download className="h-3.5 w-3.5" /> {tCommon('actions.export')}
            </a>
            <Button onClick={() => setMode({ kind: 'add' })} size="sm">
              <Plus className="h-4 w-4" /> {t('addService')}
            </Button>
          </>
        }
      />

      <div className="p-6">
        <DataTable
          columns={columns}
          data={services}
          getRowKey={(r) => r.id}
          emptyState={{
            title: t('emptyTitle'),
            description: t('emptyHint'),
            action: (
              <Button onClick={() => setMode({ kind: 'add' })} size="sm">
                <Plus className="h-4 w-4" /> {t('addService')}
              </Button>
            ),
          }}
        />
      </div>

      {mode.kind !== 'closed' && (
        <ServiceFormModal
          mode={mode}
          categories={categories}
          taxes={taxes}
          existingTaxIds={mode.kind === 'edit' ? (taxIdsByService.get(mode.service.id) ?? []) : []}
          onClose={() => setMode({ kind: 'closed' })}
        />
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
