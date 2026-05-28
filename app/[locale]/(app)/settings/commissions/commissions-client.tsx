'use client';

import { useMemo, useState, useTransition } from 'react';
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

  // Single "cumulative" flag for the whole scope shown on the page: applied to
  // every barber row at save time. Initial value = majority of confirmed barbers.
  const initialCumulative = useMemo(() => {
    const rows = barbers.map((b) => initialDrafts.get(`${b.id}:${scope}`));
    const on = rows.filter((r) => r?.cumulative).length;
    return on > rows.length / 2;
  }, [barbers, initialDrafts, scope]);
  const [cumulative, setCumulative] = useState(initialCumulative);

  function onSave() {
    startTransition(async () => {
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
          cumulative,
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
        title={t('title')}
        actions={
          <Button onClick={onSave} loading={isPending} size="sm">
            {tCommon('actions.save')}
          </Button>
        }
      />

      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-center gap-6">
          <Tabs
            value={scope}
            onChange={setScope}
            items={[
              { value: 'services', label: t('tabs.services') },
              { value: 'products', label: t('tabs.products') },
            ]}
          />
          <Toggle checked={cumulative} onChange={setCumulative} label={t('cumulative')} />
        </div>

        <div className="overflow-x-auto rounded-lg bg-bg-surface shadow-sm">
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
                  </tr>
                );
              })}
              {barbers.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-sm text-text-muted">
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
