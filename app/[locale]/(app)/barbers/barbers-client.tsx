'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { ArchiveRestore, Check, Download, Mail, Pencil, Plus, Trash2, Unlink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { EmptyCell } from '@/components/ui/empty-cell';
import { Input, Label } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { PageHeader } from '@/components/ui/page-header';
import { RowActions } from '@/components/ui/row-actions';
import { SearchBar } from '@/components/ui/search-bar';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import type { BarberRow } from '@/db/rows';
import type { ShopMemberStatus } from '@/db/enums';
import { BarberFormModal } from './barber-form-modal';
import { deleteBarber, disconnectGoogleCalendar, inviteBarber, setBarberStatus } from './actions';

type Mode = { kind: 'closed' } | { kind: 'add' } | { kind: 'edit'; barber: BarberRow };

export type GoogleConnectionView = {
  googleEmail: string;
  syncStatus: 'active' | 'paused' | 'error';
  lastError: string | null;
  lastSyncedAt: string | null;
};

type Props = {
  locale: string;
  barbers: BarberRow[];
  /** Phase 34: feature gate. When false, the Google column is hidden. */
  googleConfigured: boolean;
  /** Per-barber connection state, keyed by barber.id. */
  googleByBarber: Record<string, GoogleConnectionView>;
};

export function BarbersClient({ locale, barbers, googleConfigured, googleByBarber }: Props) {
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
  // B18 — the Google disconnect deletes real events off the barber's external
  // calendar, so it must be confirmed (not fire on a stray icon click).
  const [confirmDisconnect, setConfirmDisconnect] = useState<BarberRow | null>(null);
  // B8 — the "invite to log in" modal target (a roster chair to link to an
  // auth account so the barber can self-serve their own calendar).
  const [invite, setInvite] = useState<BarberRow | null>(null);
  const [isPending, startTransition] = useTransition();

  // Phase 34 — surface a toast after the OAuth round-trip. The callback
  // route redirects here with ?google=connected or ?google=error&reason=...
  const params = useSearchParams();
  useEffect(() => {
    const status = params.get('google');
    if (!status) return;
    if (status === 'connected') {
      show({ variant: 'success', title: t('toasts.googleConnected') });
    } else {
      show({ variant: 'danger', title: t('toasts.googleError') });
    }
    // Strip the param so a back-nav doesn't re-fire the toast. Using
    // history API directly avoids a full route refresh.
    const url = new URL(window.location.href);
    url.searchParams.delete('google');
    url.searchParams.delete('reason');
    window.history.replaceState(null, '', url.toString());
  }, [params, show, t]);

  function startGoogleConnect(barberId: string) {
    // Plain navigation rather than `fetch` — Google needs a top-frame
    // redirect (the consent screen sets cookies and won't run inside an
    // XHR). The start route returns a 302 to accounts.google.com.
    window.location.href = `/api/google/oauth/start?barber_id=${barberId}`;
  }

  function disconnectGoogle(barberId: string, name: string) {
    startTransition(async () => {
      const result = await disconnectGoogleCalendar({ barber_id: barberId });
      if (result.ok) {
        show({ variant: 'info', title: t('toasts.googleDisconnected', { name }) });
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

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
      // Loop 44 self-review — display the avatar uploaded via the
      // form modal alongside the name so the upload result is
      // visible from the list page (without it, the only way to
      // know the upload landed was to re-open the form). Falls back
      // to a 24×24 initial chip when avatar_url is null.
      cell: (r) => (
        <span className="inline-flex items-center gap-3">
          {r.avatar_url ? (
            <Image
              src={r.avatar_url}
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-inset ring-border"
            />
          ) : (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-xs font-semibold text-accent-text ring-1 ring-inset ring-accent/15">
              {initialsFor(r.display_name)}
            </span>
          )}
          <span className="font-medium text-text-primary">{r.display_name}</span>
        </span>
      ),
      sortable: true,
      sortValue: (r) => r.display_name.toLowerCase(),
    },
    {
      id: 'email',
      header: t('columns.email'),
      cell: (r) => r.email ?? <EmptyCell />,
    },
    {
      id: 'phone',
      header: t('columns.phone'),
      // Loop 37 (P114) — phone numbers in mono so the +1 ### ### ####
      // blocks line up column-wise across all rows.
      cell: (r) =>
        r.phone ? <span className="font-mono tabular-nums">{r.phone}</span> : <EmptyCell />,
    },
    {
      id: 'personnel',
      header: t('columns.personnelId'),
      cell: (r) => r.personnel_id ?? <EmptyCell />,
    },
    // B8 — login access: a linked chair (barbers.user_id set) shows a badge;
    // an unlinked confirmed/staff chair gets an "invite to log in" button that
    // links it to an auth account so the barber can self-serve their own
    // calendar. Deleted chairs show nothing.
    {
      id: 'login',
      header: t('columns.login'),
      cell: (r) =>
        r.user_id ? (
          <Badge variant="success">
            <Check className="h-3 w-3" /> {t('loginStatus.linked')}
          </Badge>
        ) : r.status === 'deleted' ? (
          <EmptyCell />
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setInvite(r);
            }}
          >
            <Mail className="h-4 w-4" /> {t('actions.inviteToLogin')}
          </Button>
        ),
    },
    // Phase 34 — Google Calendar connection column. Hidden when the
    // feature isn't configured server-side (env vars missing).
    ...(googleConfigured
      ? [
          {
            id: 'google',
            header: t('columns.google'),
            cell: (r: BarberRow) => {
              const conn = googleByBarber[r.id];
              if (!conn) {
                return (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      startGoogleConnect(r.id);
                    }}
                  >
                    {t('actions.connectGoogle')}
                  </Button>
                );
              }
              // B25 — distinguish the three sync states: error (red),
              // paused (amber, NOT a healthy green), active (green + email).
              const badgeVariant =
                conn.syncStatus === 'error'
                  ? 'danger'
                  : conn.syncStatus === 'paused'
                    ? 'warning'
                    : 'success';
              return (
                <div className="flex items-center gap-2">
                  <Badge variant={badgeVariant}>
                    {conn.syncStatus === 'error' ? (
                      t('googleStatus.error')
                    ) : conn.syncStatus === 'paused' ? (
                      t('googleStatus.paused')
                    ) : (
                      <>
                        <Check className="h-3 w-3" /> {conn.googleEmail}
                      </>
                    )}
                  </Badge>
                  <button
                    type="button"
                    aria-label={t('actions.disconnectGoogle')}
                    title={t('actions.disconnectGoogle')}
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDisconnect(r);
                    }}
                    className="rounded-md p-1 text-text-muted transition-colors duration-150 ease-out-quint hover:bg-bg-surface-2 hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    <Unlink className="h-4 w-4" />
                  </button>
                </div>
              );
            },
          } satisfies ColumnDef<BarberRow>,
        ]
      : []),
    {
      id: 'actions',
      header: '',
      width: '120px',
      align: 'right',
      cell: (r) => (
        <RowActions
          actions={[
            {
              icon: Pencil,
              label: tCommon('actions.edit'),
              onClick: () => setMode({ kind: 'edit', barber: r }),
            },
            tab === 'deleted'
              ? { icon: ArchiveRestore, label: t('actions.restore'), onClick: () => onRestore(r) }
              : {
                  icon: Trash2,
                  label: tCommon('actions.delete'),
                  tone: 'danger' as const,
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

      <div className="space-y-6 p-6">
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
          // B7 — `reorderable` previously rendered a drag handle with NO DnD
          // wiring (DataTable.reorderable has no onReorder + is unsupported in
          // virtualized mode) and there's no reorderBarbers action, so the grip
          // was purely decorative and sort_order could never change from the
          // UI. Removed so the UI doesn't advertise a capability it lacks. Real
          // drag-reorder (a DataTable DnD addition or a custom sortable table +
          // a reorderBarbers action, mirroring services) is a dedicated
          // follow-up — see the Barbers audit (B7).
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

      {invite && <InviteBarberModal barber={invite} onClose={() => setInvite(null)} />}

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

      <ConfirmDialog
        open={confirmDisconnect !== null}
        title={t('confirmDisconnect.title')}
        description={
          confirmDisconnect
            ? t('confirmDisconnect.description', { name: confirmDisconnect.display_name })
            : ''
        }
        destructive
        loading={isPending}
        confirmLabel={t('actions.disconnectGoogle')}
        cancelLabel={tCommon('actions.cancel')}
        onConfirm={() => {
          if (confirmDisconnect) {
            disconnectGoogle(confirmDisconnect.id, confirmDisconnect.display_name);
            setConfirmDisconnect(null);
          }
        }}
        onCancel={() => setConfirmDisconnect(null)}
      />
    </>
  );
}

/**
 * B8 — "Invite to log in" modal. Prefilled with the chair's roster email
 * (overridable: the work address on the roster may differ from the personal
 * one the barber wants to sign in with). On submit, `inviteBarber` links an
 * existing Küa profile immediately or emails a brand-new invite, then writes
 * `barbers.user_id` so the barber can self-serve their own calendar.
 */
function InviteBarberModal({ barber, onClose }: { barber: BarberRow; onClose: () => void }) {
  const t = useTranslations('pages.barbers');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [email, setEmail] = useState(barber.email ?? '');
  const [isPending, startTransition] = useTransition();

  function onSubmit() {
    startTransition(async () => {
      const result = await inviteBarber({ barber_id: barber.id, email });
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.invited', { name: barber.display_name }) });
        onClose();
      } else if (result.errorCode === 'CONFLICT') {
        show({ variant: 'warning', title: t('toasts.inviteConflict') });
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('inviteModal.title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            {tCommon('actions.cancel')}
          </Button>
          <Button onClick={onSubmit} loading={isPending} disabled={!email.trim()}>
            <Mail className="h-4 w-4" /> {t('inviteModal.send')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-text-muted">
          {t('inviteModal.description', { name: barber.display_name })}
        </p>
        <div>
          <Label htmlFor="invite-email" required>
            {t('inviteModal.email')}
          </Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <p className="text-xs text-text-muted">{t('inviteModal.hint')}</p>
      </div>
    </Modal>
  );
}

/**
 * Loop 44 self-review — derive a 1–2 letter initial chip from the
 * display name. Same logic as the sidebar Avatar (different file)
 * so the two surfaces feel consistent. `?` is the fallback when the
 * name is empty/whitespace (shouldn't happen — schema requires
 * NAME_REQUIRED — but defensive against future schema relaxation).
 */
function initialsFor(displayName: string): string {
  return (
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('') || '?'
  );
}
