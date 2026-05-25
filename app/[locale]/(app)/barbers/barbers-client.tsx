'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ArchiveRestore, Download, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { PageHeader } from '@/components/ui/page-header';
import { SearchBar } from '@/components/ui/search-bar';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import type { BarberRow } from '@/db/rows';
import type { ShopMemberStatus } from '@/db/enums';
import { BarberFormModal } from './barber-form-modal';
import { deleteBarber, setBarberStatus } from './actions';

type Mode = { kind: 'closed' } | { kind: 'add' } | { kind: 'edit'; barber: BarberRow };

export function BarbersClient({ locale, barbers }: { locale: string; barbers: BarberRow[] }) {
  const t = useTranslations('pages.barbers');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  // `locale` is retained for the future i18n-aware sorting / phone formatting.
  void locale;

  const [tab, setTab] = useState<ShopMemberStatus>('confirmed');
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<Mode>({ kind: 'closed' });
  const [confirmDelete, setConfirmDelete] = useState<BarberRow | null>(null);
  const [isPending, startTransition] = useTransition();

  // Counts per tab — shown as small chips in the Tabs component.
  const counts = useMemo(() => {
    return barbers.reduce<Record<ShopMemberStatus, number>>(
      (acc, b) => {
        acc[b.status] = (acc[b.status] ?? 0) + 1;
        return acc;
      },
      { confirmed: 0, staff: 0, deleted: 0 },
    );
  }, [barbers]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return barbers
      .filter((b) => b.status === tab)
      .filter((b) => {
        if (!q) return true;
        return (
          b.display_name.toLowerCase().includes(q) ||
          (b.email ?? '').toLowerCase().includes(q) ||
          (b.phone ?? '').toLowerCase().includes(q)
        );
      });
  }, [barbers, tab, search]);

  function onDelete(row: BarberRow) {
    startTransition(async () => {
      const result = await deleteBarber({ id: row.id });
      setConfirmDelete(null);
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.deleted', { name: row.display_name }) });
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  function onRestore(row: BarberRow) {
    startTransition(async () => {
      const result = await setBarberStatus({ id: row.id, status: 'confirmed' });
      if (result.ok) {
        show({ variant: 'info', title: t('toasts.restored', { name: row.display_name }) });
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  const columns: ReadonlyArray<ColumnDef<BarberRow>> = [
    {
      id: 'name',
      header: t('columns.name'),
      cell: (r) => <span className="font-medium">{r.display_name}</span>,
      sortable: true,
      sortValue: (r) => r.display_name.toLowerCase(),
    },
    {
      id: 'email',
      header: t('columns.email'),
      cell: (r) => r.email ?? <span className="text-text-muted">—</span>,
    },
    {
      id: 'phone',
      header: t('columns.phone'),
      cell: (r) => r.phone ?? <span className="text-text-muted">—</span>,
    },
    {
      id: 'personnel',
      header: t('columns.personnelId'),
      cell: (r) => r.personnel_id ?? <span className="text-text-muted">—</span>,
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
              setMode({ kind: 'edit', barber: r });
            }}
            className="rounded p-1 text-text-muted transition-colors hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Pencil className="h-4 w-4" />
          </button>
          {tab === 'deleted' ? (
            <button
              type="button"
              aria-label={t('actions.restore')}
              onClick={(e) => {
                e.stopPropagation();
                onRestore(r);
              }}
              className="rounded p-1 text-text-muted transition-colors hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ArchiveRestore className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              aria-label={tCommon('actions.delete')}
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete(r);
              }}
              className="rounded p-1 text-text-muted transition-colors hover:bg-bg-surface-2 hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('title')}
        center={
          <SearchBar
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
          />
        }
        actions={
          <>
            <a
              href={`/api/export/barbers?status=${tab}`}
              className="inline-flex h-8 items-center gap-2 rounded-sm border border-border bg-bg-surface px-3 text-xs font-medium text-text-primary hover:bg-bg-surface-2"
            >
              <Download className="h-3.5 w-3.5" /> {tCommon('actions.export')}
            </a>
            <Button onClick={() => setMode({ kind: 'add' })} size="sm">
              <Plus className="h-4 w-4" /> {t('addBarber')}
            </Button>
          </>
        }
      />

      <div className="space-y-4 p-6">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'confirmed', label: t('tabs.confirmed'), count: counts.confirmed },
            { value: 'staff', label: t('tabs.staff'), count: counts.staff },
            { value: 'deleted', label: t('tabs.deleted'), count: counts.deleted },
          ]}
        />

        <DataTable
          columns={columns}
          data={rows}
          getRowKey={(r) => r.id}
          reorderable
          emptyState={{
            title: t('emptyTitle'),
            description: t('emptyHint'),
            action: (
              <Button onClick={() => setMode({ kind: 'add' })} size="sm">
                <Plus className="h-4 w-4" /> {t('addBarber')}
              </Button>
            ),
          }}
        />
      </div>

      {mode.kind !== 'closed' && (
        <BarberFormModal mode={mode} onClose={() => setMode({ kind: 'closed' })} />
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t('confirmDelete.title')}
        description={
          confirmDelete ? t('confirmDelete.description', { name: confirmDelete.display_name }) : ''
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
