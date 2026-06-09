'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Download, FileDown, Pencil, Plus, Trash2, UserX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { EmptyCell } from '@/components/ui/empty-cell';
import { PageHeader } from '@/components/ui/page-header';
import { RowActions } from '@/components/ui/row-actions';
import { SearchBar } from '@/components/ui/search-bar';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import type { ClientRow } from '@/db/rows';
import { ClientFormModal } from './client-form-modal';
import { anonymizeClient, deleteClient, exportClient } from './actions';

type Mode = { kind: 'closed' } | { kind: 'add' } | { kind: 'edit'; client: ClientRow };

const PAGE_SIZE = 25;

// A–Z letter buckets, plus '#' for names whose first letter isn't a plain
// A–Z character. Accented Québec names (« Élodie », « Çağla ») fold to their
// base letter (E, C); anonymized '[Anonymized]' rows and any symbol/number-
// leading name land under '#' so they stay reachable by the letter bar.
const ALPHABET = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), '#'];

function bucketLetter(name: string | null | undefined): string {
  const first = (name?.[0] ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  return first >= 'A' && first <= 'Z' ? first : '#';
}

export function ClientsClient({ locale, clients }: { locale: string; clients: ClientRow[] }) {
  const t = useTranslations('pages.clients');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();

  const [letterFilter, setLetterFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showDupesOnly, setShowDupesOnly] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: 'closed' });
  const [confirmDelete, setConfirmDelete] = useState<ClientRow | null>(null);
  const [isPending, startTransition] = useTransition();

  // Detect duplicates: rows that share the same normalised phone OR email.
  const duplicateIds = useMemo(() => {
    const byPhone = new Map<string, string[]>();
    const byEmail = new Map<string, string[]>();
    for (const c of clients) {
      if (c.phone) {
        const key = c.phone.replace(/\D/g, '');
        if (key.length > 0) {
          const list = byPhone.get(key) ?? [];
          list.push(c.id);
          byPhone.set(key, list);
        }
      }
      if (c.email) {
        const key = c.email.toLowerCase();
        const list = byEmail.get(key) ?? [];
        list.push(c.id);
        byEmail.set(key, list);
      }
    }
    const dupes = new Set<string>();
    for (const list of [...byPhone.values(), ...byEmail.values()]) {
      if (list.length > 1) list.forEach((id) => dupes.add(id));
    }
    return dupes;
  }, [clients]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (showDupesOnly && !duplicateIds.has(c.id)) return false;
      if (letterFilter) {
        if (bucketLetter(c.first_name) !== letterFilter) return false;
      }
      if (q) {
        const hay =
          `${c.first_name} ${c.last_name ?? ''} ${c.email ?? ''} ${c.phone ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [clients, search, letterFilter, showDupesOnly, duplicateIds]);

  // Letters that actually have a client, for dimming empty letters in the A-Z bar.
  const lettersWithClients = useMemo(
    () => new Set(clients.map((c) => bucketLetter(c.first_name))),
    [clients],
  );

  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  function onDelete(row: ClientRow) {
    startTransition(async () => {
      const result = await deleteClient({ id: row.id });
      setConfirmDelete(null);
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.deleted', { name: clientLabel(row) }) });
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  // Phase 40 — Loi 25. Triggers a server export that returns the full
  // JSON snapshot, then downloads it as a file via a data URL. Keeps
  // the data flow server-side (no PII passes through the client beyond
  // the final download blob).
  function onExport(row: ClientRow) {
    startTransition(async () => {
      const result = await exportClient({ id: row.id });
      if (!result.ok) {
        show({ variant: 'danger', title: tErr(result.errorCode) });
        return;
      }
      const blob = new Blob([JSON.stringify(result.data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kua-client-export-${row.id}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      show({ variant: 'success', title: t('toasts.exported', { name: clientLabel(row) }) });
    });
  }

  function onAnonymize(row: ClientRow) {
    startTransition(async () => {
      const result = await anonymizeClient({ id: row.id });
      if (result.ok) {
        show({ variant: 'info', title: t('toasts.anonymized', { name: clientLabel(row) }) });
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  function clientLabel(c: ClientRow) {
    return `${c.first_name}${c.last_name ? ` ${c.last_name}` : ''}`;
  }

  const columns: ReadonlyArray<ColumnDef<ClientRow>> = [
    {
      id: 'name',
      header: t('columns.client'),
      cell: (r) => (
        <span className="flex items-center gap-2">
          {/* Name links to the client fiche (history, spend, loyalty, notes). */}
          <Link
            href={`/${locale}/clients/${r.id}`}
            onClick={(e) => e.stopPropagation()}
            className="rounded font-medium text-text-primary transition-colors hover:text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {clientLabel(r)}
          </Link>
          {duplicateIds.has(r.id) ? (
            <Badge variant="warning" title={t('duplicateHint')}>
              <AlertTriangle className="h-3 w-3" /> {t('duplicate')}
            </Badge>
          ) : null}
        </span>
      ),
      sortable: true,
      sortValue: (r) => clientLabel(r).toLowerCase(),
    },
    {
      id: 'email',
      header: t('columns.email'),
      cell: (r) => r.email ?? <EmptyCell />,
    },
    {
      id: 'phone',
      header: t('columns.phone'),
      // Loop 37 (P114) — phone numbers are technical labels; mono font
      // makes the +1 ### ### #### blocks line up across the table.
      cell: (r) =>
        r.phone ? <span className="font-mono tabular-nums">{r.phone}</span> : <EmptyCell />,
    },
    {
      id: 'actions',
      header: '',
      width: '150px',
      align: 'right',
      cell: (r) => (
        <RowActions
          actions={[
            {
              icon: Pencil,
              label: tCommon('actions.edit'),
              onClick: () => setMode({ kind: 'edit', client: r }),
            },
            // Phase 40 — Loi 25 actions (export + anonymize)
            {
              icon: FileDown,
              label: t('actions.exportData'),
              title: t('actions.exportData'),
              onClick: () => onExport(r),
            },
            {
              icon: UserX,
              label: t('actions.anonymize'),
              title: t('actions.anonymize'),
              tone: 'warning',
              onClick: () => onAnonymize(r),
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
        title={t('title')}
        subtitle={t('total', { count: clients.length, dupes: duplicateIds.size })}
        center={
          <SearchBar
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
          />
        }
        actions={
          <>
            <Button
              variant={showDupesOnly ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => {
                setShowDupesOnly((v) => !v);
                setPage(1);
              }}
            >
              <AlertTriangle className="h-3.5 w-3.5" /> {t('locateDuplicates')}
            </Button>
            <a
              href="/api/export/clients"
              className="inline-flex h-8 items-center gap-2 rounded-sm border border-border bg-bg-surface px-3 text-xs font-medium text-text-primary hover:bg-bg-surface-2"
            >
              <Download className="h-3.5 w-3.5" /> {tCommon('actions.download')}
            </a>
            <Button onClick={() => setMode({ kind: 'add' })} size="sm">
              <Plus className="h-4 w-4" /> {t('addClient')}
            </Button>
          </>
        }
      />

      <div className="space-y-6 p-6">
        <div
          className="flex flex-wrap items-center gap-0.5 rounded-lg bg-bg-surface p-1 shadow-border"
          data-reveal
        >
          <button
            type="button"
            onClick={() => {
              setLetterFilter(null);
              setPage(1);
            }}
            aria-pressed={letterFilter === null}
            className={cn(
              'rounded-md px-2.5 py-1 font-mono text-xs font-semibold uppercase tracking-wide transition-all duration-150 ease-out-quint focus:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-95',
              letterFilter === null
                ? 'bg-accent text-accent-fg shadow-accent-glow'
                : 'text-text-secondary hover:bg-bg-surface-2 hover:text-text-primary',
            )}
          >
            {t('all')}
          </button>
          {ALPHABET.map((letter) => {
            const active = letterFilter === letter;
            const hasClients = lettersWithClients.has(letter);
            return (
              <button
                key={letter}
                type="button"
                disabled={!hasClients}
                onClick={() => {
                  setLetterFilter(active ? null : letter);
                  setPage(1);
                }}
                aria-pressed={active}
                className={cn(
                  'h-7 w-7 rounded-md font-mono text-xs font-semibold transition-all duration-150 ease-out-quint focus:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-95',
                  active
                    ? 'bg-accent text-accent-fg shadow-accent-glow'
                    : hasClients
                      ? 'text-text-secondary hover:bg-bg-surface-2 hover:text-text-primary'
                      : 'cursor-not-allowed text-text-disabled',
                )}
              >
                {letter}
              </button>
            );
          })}
        </div>

        <DataTable
          columns={columns}
          data={pageRows}
          getRowKey={(r) => r.id}
          emptyState={{ title: t('emptyTitle'), description: t('emptyHint') }}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total: filtered.length,
            onPageChange: setPage,
          }}
        />
      </div>

      {mode.kind !== 'closed' && (
        <ClientFormModal mode={mode} onClose={() => setMode({ kind: 'closed' })} />
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t('confirmDelete.title')}
        description={
          confirmDelete ? t('confirmDelete.description', { name: clientLabel(confirmDelete) }) : ''
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
