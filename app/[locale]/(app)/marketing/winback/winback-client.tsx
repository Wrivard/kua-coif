'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Send, Mail, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { sendWinbackCampaign } from './actions';

export type Candidate = {
  clientId: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  /** ISO timestamp of the most recent non-cancelled appointment. */
  lastVisitAt: string;
};

type Labels = {
  title: string;
  subtitle: string;
  emptyTitle: string;
  emptyDescription: string;
  columns: {
    client: string;
    lastVisit: string;
    contact: string;
  };
  selectAll: string;
  send: string;
  sending: string;
  selectedSummary: string;
  sentToast: string;
  partialToast: string;
  failedToast: string;
  confirm: string;
};

type Props = {
  locale: string;
  candidates: Candidate[];
  labels?: Labels;
};

function formatRelative(iso: string, locale: 'fr' | 'en'): string {
  const then = new Date(iso).getTime();
  const days = Math.max(1, Math.round((Date.now() - then) / (24 * 60 * 60 * 1000)));
  if (locale === 'fr') {
    if (days < 60) return `il y a ${days} j`;
    const months = Math.round(days / 30);
    if (months < 18) return `il y a ${months} mois`;
    return `il y a ${Math.round(months / 12)} an(s)`;
  }
  if (days < 60) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 18) return `${months} mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

/**
 * Loop 64 — Winback client.
 *
 * Mirror of the review-campaign client (Loop 63), with one row per
 * lapsed client (not per-appointment). The "last visit" column shows a
 * relative age — "3 mo ago", "il y a 2 ans" — which is the operator's
 * primary signal for who to prioritize.
 */
export function WinbackClient({ locale, candidates, labels }: Props) {
  const L = labels;
  const { show } = useToast();
  const tCommon = useTranslations('common');
  const tMarketing = useTranslations('pages.marketing');
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, startSend] = useTransition();
  // Plan 039 (MKT-01) — the native confirm() is now a themed ConfirmDialog.
  const [confirmSend, setConfirmSend] = useState(false);

  // Loop 64 SR — bulk-select cap matches the schema cap (50), which
  // matches Vercel Hobby's 10s server-action timeout. Above 50 the
  // action would silently drop the tail.
  const BATCH_CAP = 50;

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < BATCH_CAP) {
        next.add(id);
      }
      return next;
    });
  }
  function toggleAll() {
    const effective = Math.min(candidates.length, BATCH_CAP);
    if (selected.size === effective) setSelected(new Set());
    else setSelected(new Set(candidates.slice(0, effective).map((c) => c.clientId)));
  }
  const effectiveTotal = Math.min(candidates.length, BATCH_CAP);
  const allSelected = selected.size > 0 && selected.size === effectiveTotal;
  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const fmtLocale: 'fr' | 'en' = locale === 'en' ? 'en' : 'fr';

  function onSend() {
    // Plan 039 (MKT-01) — same treatment as the review campaign: themed
    // confirm + router.refresh() so the result toast survives the re-fetch.
    if (selectedIds.length === 0) return;
    setConfirmSend(true);
  }

  function doSend() {
    setConfirmSend(false);
    startSend(async () => {
      const result = await sendWinbackCampaign({ client_ids: selectedIds });
      if (result.ok) {
        const { sent, skipped, failed } = result.data;
        // W10 — surface the skipped channels (opted out, no contact info,
        // already nudged this year, or channel disabled) so a bulk send
        // that reached few or none no longer reads as a clean success.
        const skippedNote =
          skipped > 0 ? tMarketing('winback.skippedToast', { skipped }) : undefined;
        if (sent === 0 && failed === 0) {
          show({
            variant: 'warning',
            title: skippedNote ?? (L?.sentToast ?? '').replace('{sent}', '0'),
          });
        } else if (failed === 0) {
          show({
            variant: 'success',
            title: (L?.sentToast ?? '').replace('{sent}', String(sent)),
            description: skippedNote,
          });
        } else {
          show({
            variant: 'warning',
            title: (L?.partialToast ?? '')
              .replace('{sent}', String(sent))
              .replace('{failed}', String(failed)),
            description: skippedNote,
          });
        }
        setSelected(new Set());
        router.refresh();
      } else {
        show({ variant: 'danger', title: L?.failedToast ?? 'Failed' });
      }
    });
  }

  if (candidates.length === 0) {
    return (
      <>
        <PageHeader title={L?.title ?? 'Win-back'} subtitle={L?.subtitle} />
        <div className="p-6">
          <Card>
            <CardBody className="space-y-2 py-12 text-center">
              <p className="font-medium text-text-primary">{L?.emptyTitle}</p>
              <p className="text-sm text-text-secondary">{L?.emptyDescription}</p>
            </CardBody>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={L?.title ?? 'Win-back'}
        subtitle={L?.subtitle}
        actions={
          <Button onClick={onSend} loading={sending} disabled={selectedIds.length === 0}>
            <Send className="h-4 w-4" />
            {sending ? (L?.sending ?? 'Sending…') : `${L?.send ?? 'Send'} (${selectedIds.length})`}
          </Button>
        }
      />
      <div className="space-y-6 p-6">
        <Card>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-soft text-left text-[10px] uppercase tracking-wide text-text-muted">
                  <th className="w-10 py-3 pl-4">
                    <Checkbox
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label={L?.selectAll}
                    />
                  </th>
                  <th className="py-3">{L?.columns.client}</th>
                  <th className="py-3">{L?.columns.lastVisit}</th>
                  <th className="py-3 pr-4">{L?.columns.contact}</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => {
                  const checked = selected.has(c.clientId);
                  const fullName = `${c.firstName}${c.lastName ? ` ${c.lastName}` : ''}`.trim();
                  return (
                    <tr
                      key={c.clientId}
                      className="border-b border-border-soft last:border-b-0 hover:bg-bg-surface-2"
                    >
                      <td className="py-3 pl-4">
                        <Checkbox
                          checked={checked}
                          onChange={() => toggleOne(c.clientId)}
                          aria-label={tMarketing('selectClient', { name: fullName })}
                        />
                      </td>
                      <td className="py-3">
                        <p className="font-medium text-text-primary">{fullName}</p>
                      </td>
                      <td className="py-3 text-text-secondary">
                        {formatRelative(c.lastVisitAt, fmtLocale)}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2 text-xs text-text-secondary">
                          {c.email ? (
                            <span className="inline-flex items-center gap-1" title={c.email}>
                              <Mail className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">{c.email}</span>
                            </span>
                          ) : null}
                          {c.phone ? (
                            <span className="inline-flex items-center gap-1" title={c.phone}>
                              <Phone className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">{c.phone}</span>
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardBody>
        </Card>
        <p className="text-xs text-text-muted">
          {(L?.selectedSummary ?? '')
            .replace('{selected}', String(selectedIds.length))
            .replace('{total}', String(candidates.length))}
        </p>
      </div>

      {/* Plan 039 (MKT-01) — themed confirm for the irreversible bulk send. */}
      <ConfirmDialog
        open={confirmSend}
        title={tCommon('actions.confirm')}
        description={(L?.confirm ?? '').replace('{count}', String(selectedIds.length))}
        loading={sending}
        confirmLabel={L?.send ?? tCommon('actions.confirm')}
        cancelLabel={tCommon('actions.cancel')}
        onConfirm={doSend}
        onCancel={() => setConfirmSend(false)}
      />
    </>
  );
}
