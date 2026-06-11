'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Send, Mail, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyCell } from '@/components/ui/empty-cell';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { formatShopTime } from '@/lib/business/timezone';
import { sendReviewCampaign } from './actions';

export type Candidate = {
  appointmentId: string;
  startAt: string;
  client: {
    firstName: string;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  };
  services: string[];
};

type Labels = {
  title: string;
  subtitle: string;
  emptyTitle: string;
  emptyDescription: string;
  columns: {
    client: string;
    lastVisit: string;
    services: string;
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

/**
 * Loop 63 — Review-campaign client.
 *
 * Table of eligible appointments with per-row checkboxes + a bulk
 * "Send review request" button. The action generates signed tokens
 * server-side and dispatches email + SMS — we just collect the
 * selection here.
 *
 * No optimistic UI: we wait for the server result and refresh the
 * page on success so the freshly-asked rows fall out of the
 * candidate list (their `client_marketing_sends` row now matches the
 * exclusion filter).
 */
export function ReviewCampaignClient({
  // locale is reserved for future locale-aware date formatting
  // (services formatter, etc.); currently we hardcode America/Toronto
  // — see the formatShopTime call below for the right fix.
  locale: _locale,
  candidates,
  labels,
}: Props) {
  const L = labels;
  const { show } = useToast();
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, startSend] = useTransition();
  // Plan 039 (MKT-01) — the native confirm() is now a themed ConfirmDialog.
  const [confirmSend, setConfirmSend] = useState(false);

  // Loop 64 SR — cap the bulk-select at 50 (matches schema cap, which
  // matches Vercel Hobby's 10s server-action timeout). Without this,
  // "Select all" on a 100-candidate list would queue 100 → action
  // rejects with INVALID_INPUT and the operator gets a confusing toast.
  const BATCH_CAP = 50;

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < BATCH_CAP) {
        next.add(id);
      }
      // At cap → silently ignore the toggle-on. Checkbox stays
      // unchecked. UI hint below tells operator about the limit.
      return next;
    });
  }
  function toggleAll() {
    const effective = Math.min(candidates.length, BATCH_CAP);
    if (selected.size === effective) setSelected(new Set());
    else setSelected(new Set(candidates.slice(0, effective).map((c) => c.appointmentId)));
  }

  const effectiveTotal = Math.min(candidates.length, BATCH_CAP);
  const allSelected = selected.size > 0 && selected.size === effectiveTotal;
  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  function onSend() {
    // Plan 039 (MKT-01) — irreversible bulk send: themed confirm dialog
    // instead of the native confirm(), and router.refresh() instead of a
    // full page reload so the success/partial-failure toast SURVIVES the
    // candidate-list re-fetch (the reload wiped it).
    if (selectedIds.length === 0) return;
    setConfirmSend(true);
  }

  function doSend() {
    setConfirmSend(false);
    startSend(async () => {
      const result = await sendReviewCampaign({ appointment_ids: selectedIds });
      if (result.ok) {
        const { sent, failed, attempted } = result.data;
        if (failed === 0) {
          show({
            variant: 'success',
            title: L?.sentToast.replace('{sent}', String(sent)) ?? 'Sent',
          });
        } else {
          show({
            variant: 'warning',
            title:
              L?.partialToast
                .replace('{sent}', String(sent))
                .replace('{failed}', String(failed))
                .replace('{attempted}', String(attempted)) ?? 'Partial',
          });
        }
        setSelected(new Set());
        // Re-fetch the page so the just-sent rows disappear from the
        // candidate list (they now have a client_marketing_sends row).
        router.refresh();
      } else {
        show({ variant: 'danger', title: L?.failedToast ?? 'Failed' });
      }
    });
  }

  if (candidates.length === 0) {
    return (
      <>
        <PageHeader title={L?.title ?? 'Review campaign'} subtitle={L?.subtitle} />
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
        title={L?.title ?? 'Review campaign'}
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
                  <th className="py-3">{L?.columns.services}</th>
                  <th className="py-3 pr-4">{L?.columns.contact}</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => {
                  const checked = selected.has(c.appointmentId);
                  const fullName =
                    `${c.client.firstName}${c.client.lastName ? ` ${c.client.lastName}` : ''}`.trim();
                  return (
                    <tr
                      key={c.appointmentId}
                      className="border-b border-border-soft last:border-b-0 hover:bg-bg-surface-2"
                    >
                      <td className="py-3 pl-4">
                        <Checkbox
                          checked={checked}
                          onChange={() => toggleOne(c.appointmentId)}
                          aria-label={`Select ${fullName}`}
                        />
                      </td>
                      <td className="py-3">
                        <p className="font-medium text-text-primary">{fullName}</p>
                      </td>
                      <td className="py-3 text-text-secondary">
                        {formatShopTime(c.startAt, 'America/Toronto', 'd MMM yyyy')}
                      </td>
                      <td className="py-3 text-text-secondary">
                        {c.services.length > 0 ? c.services.join(', ') : <EmptyCell />}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2 text-xs text-text-secondary">
                          {c.client.email ? (
                            <span className="inline-flex items-center gap-1" title={c.client.email}>
                              <Mail className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">{c.client.email}</span>
                            </span>
                          ) : null}
                          {c.client.phone ? (
                            <span className="inline-flex items-center gap-1" title={c.client.phone}>
                              <Phone className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">{c.client.phone}</span>
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
          {L?.selectedSummary
            .replace('{selected}', String(selectedIds.length))
            .replace('{total}', String(candidates.length))}
        </p>
      </div>

      {/* Plan 039 (MKT-01) — themed confirm for the irreversible bulk send.
          Reuses the page's localized confirm copy (count interpolated). */}
      <ConfirmDialog
        open={confirmSend}
        title={tCommon('actions.confirm')}
        description={L?.confirm.replace('{count}', String(selectedIds.length)) ?? ''}
        loading={sending}
        confirmLabel={L?.send ?? tCommon('actions.confirm')}
        cancelLabel={tCommon('actions.cancel')}
        onConfirm={doSend}
        onCancel={() => setConfirmSend(false)}
      />
    </>
  );
}
