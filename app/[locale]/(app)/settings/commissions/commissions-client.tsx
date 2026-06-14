'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { MoneyInput } from '@/components/ui/money-input';
import { PageHeader } from '@/components/ui/page-header';
import { PercentInput } from '@/components/ui/percent-input';
import { Tabs } from '@/components/ui/tabs';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import type { CommissionScope } from '@/db/enums';
import type { BarberRow, CommissionTierRow } from '@/db/rows';
import { saveCommissions } from './actions';

type DraftRow = {
  barber_id: string;
  scope: CommissionScope;
  cumulative: boolean;
  tiers: Array<{ threshold: number; pct: number }>;
};

const EMPTY_TIERS: DraftRow['tiers'] = Array.from({ length: 5 }, () => ({ threshold: 0, pct: 0 }));

export function CommissionsClient({
  barbers,
  tiers,
}: {
  barbers: BarberRow[];
  tiers: CommissionTierRow[];
}) {
  const t = useTranslations('pages.settings.commissions');
  const tNav = useTranslations('pages.settings.nav');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [scope, setScope] = useState<CommissionScope>('services');
  const [isPending, startTransition] = useTransition();

  // Build initial drafts keyed by `${barber_id}:${scope}`.
  const initialDrafts = useMemo<Map<string, DraftRow>>(() => {
    const m = new Map<string, DraftRow>();
    for (const b of barbers) {
      for (const s of ['services', 'products'] as CommissionScope[]) {
        const row = tiers.find((tr) => tr.barber_id === b.id && tr.scope === s);
        m.set(`${b.id}:${s}`, {
          barber_id: b.id,
          scope: s,
          cumulative: row?.cumulative ?? false,
          tiers: row
            ? [
                { threshold: row.tier1_threshold, pct: row.tier1_pct },
                { threshold: row.tier2_threshold, pct: row.tier2_pct },
                { threshold: row.tier3_threshold, pct: row.tier3_pct },
                { threshold: row.tier4_threshold, pct: row.tier4_pct },
                { threshold: row.tier5_threshold, pct: row.tier5_pct },
              ]
            : [...EMPTY_TIERS],
        });
      }
    }
    return m;
  }, [barbers, tiers]);

  const [drafts, setDrafts] = useState<Map<string, DraftRow>>(initialDrafts);

  function patch(barberId: string, mutator: (d: DraftRow) => DraftRow) {
    const key = `${barberId}:${scope}`;
    setDrafts((prev) => {
      const next = new Map(prev);
      const current = next.get(key);
      if (current) next.set(key, mutator(current));
      return next;
    });
  }

  // Plan 039 (SET-01) — `cumulative` is now PER ROW (matching the DB's
  // per-barber column and the /finances per-barber mode badge). The old
  // page-level flag was initialized from a majority vote, never re-inited on
  // scope change, and stamped onto EVERY barber at save — one save silently
  // flattened a mixed-mode shop's payroll. The per-row toggle lives in the
  // matrix below; `draft.cumulative` is the single source of truth.

  // Plan 039 (SET-02) — dirty-state guard ported from
  // `barber-settings-client.tsx` (B18): warn on unload while edited, offer a
  // Reset. Drafts are Maps, so compare entry arrays (JSON.stringify on a Map
  // yields '{}'); insertion order is identical by construction. After a save
  // the revalidated props rebuild `initialDrafts` with the saved values, so
  // the dirty state clears on its own.
  const isDirty = useMemo(
    () => JSON.stringify([...drafts.entries()]) !== JSON.stringify([...initialDrafts.entries()]),
    [drafts, initialDrafts],
  );
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  function onSave() {
    startTransition(async () => {
      // SM-19: reject ambiguous tier configs before submit. Among the tiers a
      // barber actually uses (threshold>0 or pct>0, the ones normalizeTiers
      // keeps), thresholds must be strictly increasing; duplicates make the
      // "highest tier <= revenue" lookup ambiguous.
      for (const b of barbers) {
        const draft = drafts.get(`${b.id}:${scope}`);
        if (!draft) continue;
        const thresholds = draft.tiers
          .filter((tier) => tier.threshold > 0 || tier.pct > 0)
          .map((tier) => tier.threshold);
        const increasing = thresholds.every((v, i) => i === 0 || v > thresholds[i - 1]!);
        if (!increasing) {
          show({
            variant: 'danger',
            title: t('errors.tiersNotIncreasing', { barber: b.display_name }),
          });
          return;
        }
      }

      const rows: Array<{
        barber_id: string;
        scope: CommissionScope;
        cumulative: boolean;
        tier1_threshold: number;
        tier1_pct: number;
        tier2_threshold: number;
        tier2_pct: number;
        tier3_threshold: number;
        tier3_pct: number;
        tier4_threshold: number;
        tier4_pct: number;
        tier5_threshold: number;
        tier5_pct: number;
      }> = [];
      for (const b of barbers) {
        const draft = drafts.get(`${b.id}:${scope}`);
        if (!draft) continue;
        rows.push({
          barber_id: b.id,
          scope,
          // Plan 039 (SET-01) — each row keeps ITS OWN mode; a save can no
          // longer flatten a mixed-mode shop.
          cumulative: draft.cumulative,
          tier1_threshold: draft.tiers[0]?.threshold ?? 0,
          tier1_pct: draft.tiers[0]?.pct ?? 0,
          tier2_threshold: draft.tiers[1]?.threshold ?? 0,
          tier2_pct: draft.tiers[1]?.pct ?? 0,
          tier3_threshold: draft.tiers[2]?.threshold ?? 0,
          tier3_pct: draft.tiers[2]?.pct ?? 0,
          tier4_threshold: draft.tiers[3]?.threshold ?? 0,
          tier4_pct: draft.tiers[3]?.pct ?? 0,
          tier5_threshold: draft.tiers[4]?.threshold ?? 0,
          tier5_pct: draft.tiers[4]?.pct ?? 0,
        });
      }
      const result = await saveCommissions({ rows });
      if (result.ok) show({ variant: 'success', title: t('toasts.saved') });
      else show({ variant: 'danger', title: tErr(result.errorCode) });
    });
  }

  return (
    <>
      <PageHeader
        eyebrow={tNav('title')}
        title={t('title')}
        actions={
          <>
            {/* Plan 039 (SET-02) — Reset appears only while dirty, mirroring
                the barber-settings matrix guard. */}
            {isDirty ? (
              <Button variant="ghost" size="sm" onClick={() => setDrafts(initialDrafts)}>
                {tCommon('actions.cancel')}
              </Button>
            ) : null}
            <Button onClick={onSave} loading={isPending} size="sm">
              {tCommon('actions.save')}
            </Button>
          </>
        }
      />

      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-center gap-6">
          <Tabs
            value={scope}
            onChange={setScope}
            items={[
              { value: 'services', label: t('tabs.services') },
              // Product commissions are configurable in the schema but never
              // paid out: the shop has no product-sale / POS surface yet, so a
              // saved products tier would silently do nothing. Greyed out until
              // the POS lands (same spirit as the hide-dead-features decision).
              { value: 'products', label: t('tabs.products'), disabled: true },
            ]}
          />
          <p className="text-xs text-text-muted">{t('productsTabDisabledHint')}</p>
        </div>

        <div className="overflow-x-auto rounded-lg bg-bg-surface shadow-warm-md">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-surface text-text-muted">
                <th className="sticky left-0 z-10 bg-bg-surface px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide">
                  {t('columns.barber')}
                </th>
                {[1, 2, 3, 4, 5].map((tier) => (
                  <th
                    key={tier}
                    colSpan={2}
                    className="px-2 py-3 text-center text-[11px] font-semibold uppercase tracking-wide"
                  >
                    {t('tier', { n: tier })}
                  </th>
                ))}
                {/* Plan 039 (SET-01) — per-row cumulative mode column. */}
                <th className="px-3 py-3 text-center text-[11px] font-semibold uppercase tracking-wide">
                  {t('cumulative')}
                </th>
              </tr>
              <tr className="border-b border-border bg-bg-surface text-text-muted">
                <th className="sticky left-0 z-10 bg-bg-surface" />
                {[0, 1, 2, 3, 4].map((idx) => (
                  <th
                    key={idx}
                    colSpan={2}
                    className="px-2 py-1 text-center text-[10px] text-text-muted"
                  >
                    {t('thresholdPct')}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {barbers.map((b) => {
                const draft = drafts.get(`${b.id}:${scope}`);
                if (!draft) return null;
                return (
                  <tr key={b.id} className="border-b border-border last:border-b-0">
                    <td className="sticky left-0 z-10 bg-bg-surface px-4 py-2 font-medium">
                      {b.display_name}
                    </td>
                    {draft.tiers.map((tier, idx) => (
                      <td key={idx} colSpan={2} className="px-2 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <MoneyInput
                            className="w-28"
                            value={tier.threshold}
                            onChange={(e) => {
                              const v = Number(e.target.value) || 0;
                              patch(b.id, (d) => ({
                                ...d,
                                tiers: d.tiers.map((tt, i) =>
                                  i === idx ? { ...tt, threshold: v } : tt,
                                ),
                              }));
                            }}
                          />
                          <PercentInput
                            className="w-24"
                            value={tier.pct}
                            onChange={(e) => {
                              const v = Number(e.target.value) || 0;
                              patch(b.id, (d) => ({
                                ...d,
                                tiers: d.tiers.map((tt, i) => (i === idx ? { ...tt, pct: v } : tt)),
                              }));
                            }}
                          />
                        </div>
                      </td>
                    ))}
                    {/* Plan 039 (SET-01) — this barber's own payroll mode. */}
                    <td className="px-3 py-2.5 text-center">
                      <Toggle
                        checked={draft.cumulative}
                        onChange={(v) => patch(b.id, (d) => ({ ...d, cumulative: v }))}
                        aria-label={`${t('cumulative')} — ${b.display_name}`}
                        className="justify-center"
                      />
                    </td>
                  </tr>
                );
              })}
              {barbers.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-sm text-text-muted">
                    {t('emptyHint')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
