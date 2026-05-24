'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import type { BarberRow } from '@/db/rows';
import type { BarberSettingsScope } from '@/db/enums';
import { saveBarberSettings } from './actions';
import type { BarberSettingsRowInput } from './schema';

export type BarberSettingsRow = BarberSettingsRowInput & {
  id: string;
  shop_id: string;
};

const BOOKING_INTERVAL_OPTIONS = [5, 10, 15, 20, 30, 45, 60] as const;
const HOUR_OPTIONS = Array.from({ length: 49 }, (_, i) => i); // 0..48
const MINUTE_OPTIONS = [0, 5, 10, 15, 20, 30, 45] as const;

const DEFAULTS: Omit<BarberSettingsRowInput, 'scope' | 'barber_id'> = {
  allow_booking_wo_payment: true,
  booking_tip: true,
  confirmation_tip: false,
  allow_multiple_services: true,
  client_booking_interval_min: 30,
  barber_booking_interval_min: 15,
  days_book_in_advance: 30,
  mins_book_before_appt: 5,
  customer_cancellations: true,
  mins_cancel_before_appt: 300,
  reminder1_h: 24,
  reminder1_m: 0,
  reminder2_h: 1,
  reminder2_m: 0,
};

type Draft = BarberSettingsRowInput;

export function BarberSettingsClient({
  barbers,
  settings,
}: {
  barbers: BarberRow[];
  settings: BarberSettingsRow[];
}) {
  const t = useTranslations('pages.settings.barberSettings');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  // Build initial drafts: one "shop" row + one per barber.
  const initialDrafts = useMemo<Draft[]>(() => {
    const shopRow = settings.find((s) => s.scope === 'shop');
    const out: Draft[] = [
      shopRow
        ? toDraft(shopRow)
        : { scope: 'shop' as BarberSettingsScope, barber_id: null, ...DEFAULTS },
    ];
    for (const b of barbers) {
      const row = settings.find((s) => s.scope === 'barber' && s.barber_id === b.id);
      out.push(
        row
          ? toDraft(row)
          : { scope: 'barber' as BarberSettingsScope, barber_id: b.id, ...DEFAULTS },
      );
    }
    return out;
  }, [settings, barbers]);

  const [drafts, setDrafts] = useState<Draft[]>(initialDrafts);

  function patch(idx: number, mutator: (d: Draft) => Draft) {
    setDrafts((prev) => prev.map((d, i) => (i === idx ? mutator(d) : d)));
  }

  function applyShopDefaultsToAll() {
    const shop = drafts[0];
    if (!shop) return;
    setDrafts((prev) =>
      prev.map((d, i) =>
        i === 0
          ? d
          : {
              ...d,
              allow_booking_wo_payment: shop.allow_booking_wo_payment,
              booking_tip: shop.booking_tip,
              confirmation_tip: shop.confirmation_tip,
              allow_multiple_services: shop.allow_multiple_services,
              client_booking_interval_min: shop.client_booking_interval_min,
              barber_booking_interval_min: shop.barber_booking_interval_min,
              days_book_in_advance: shop.days_book_in_advance,
              mins_book_before_appt: shop.mins_book_before_appt,
              customer_cancellations: shop.customer_cancellations,
              mins_cancel_before_appt: shop.mins_cancel_before_appt,
              reminder1_h: shop.reminder1_h,
              reminder1_m: shop.reminder1_m,
              reminder2_h: shop.reminder2_h,
              reminder2_m: shop.reminder2_m,
            },
      ),
    );
    show({ variant: 'info', title: t('toasts.overrideApplied') });
  }

  function onSave() {
    startTransition(async () => {
      const result = await saveBarberSettings({ rows: drafts });
      if (result.ok) show({ variant: 'success', title: t('toasts.saved') });
      else show({ variant: 'danger', title: tErr(result.errorCode) });
    });
  }

  function rowLabel(d: Draft): string {
    if (d.scope === 'shop') return t('shopDefault');
    return barbers.find((b) => b.id === d.barber_id)?.display_name ?? '?';
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={applyShopDefaultsToAll}>
              {t('overrideButton')}
            </Button>
            <Button onClick={onSave} loading={isPending} size="sm">
              {tCommon('actions.save')}
            </Button>
          </>
        }
      />

      <div className="space-y-4 p-6">
        <p className="text-xs text-text-muted">{t('intro')}</p>

        <div className="overflow-x-auto rounded border border-border bg-bg-surface">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-bg-surface text-text-muted">
                <th className="sticky left-0 z-10 min-w-[140px] bg-bg-surface px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wide">
                  {t('columns.row')}
                </th>
                <Th>{t('columns.allowBookingWoPayment')}</Th>
                <Th>{t('columns.bookingTip')}</Th>
                <Th>{t('columns.confirmationTip')}</Th>
                <Th>{t('columns.allowMultipleServices')}</Th>
                <Th>{t('columns.clientBookingInterval')}</Th>
                <Th>{t('columns.barberBookingInterval')}</Th>
                <Th>{t('columns.daysBookInAdvance')}</Th>
                <Th>{t('columns.minsBookBefore')}</Th>
                <Th>{t('columns.customerCancellations')}</Th>
                <Th>{t('columns.minsCancelBefore')}</Th>
                <Th>{t('columns.reminder1')}</Th>
                <Th>{t('columns.reminder2')}</Th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d, idx) => (
                <tr
                  key={`${d.scope}:${d.barber_id ?? 'shop'}`}
                  className="border-b border-border last:border-b-0"
                >
                  <td
                    className={`sticky left-0 z-10 bg-bg-surface px-3 py-2 font-medium ${
                      d.scope === 'shop' ? 'text-accent' : ''
                    }`}
                  >
                    {rowLabel(d)}
                  </td>
                  <Td>
                    <Toggle
                      checked={d.allow_booking_wo_payment}
                      onChange={(v) => patch(idx, (r) => ({ ...r, allow_booking_wo_payment: v }))}
                    />
                  </Td>
                  <Td>
                    <Toggle
                      checked={d.booking_tip}
                      onChange={(v) => patch(idx, (r) => ({ ...r, booking_tip: v }))}
                    />
                  </Td>
                  <Td>
                    <Toggle
                      checked={d.confirmation_tip}
                      onChange={(v) => patch(idx, (r) => ({ ...r, confirmation_tip: v }))}
                    />
                  </Td>
                  <Td>
                    <Toggle
                      checked={d.allow_multiple_services}
                      onChange={(v) => patch(idx, (r) => ({ ...r, allow_multiple_services: v }))}
                    />
                  </Td>
                  <Td>
                    <MinSelect
                      value={d.client_booking_interval_min}
                      onChange={(v) =>
                        patch(idx, (r) => ({ ...r, client_booking_interval_min: v }))
                      }
                    />
                  </Td>
                  <Td>
                    <MinSelect
                      value={d.barber_booking_interval_min}
                      onChange={(v) =>
                        patch(idx, (r) => ({ ...r, barber_booking_interval_min: v }))
                      }
                    />
                  </Td>
                  <Td>
                    <Input
                      type="number"
                      min={0}
                      max={365}
                      className="w-16"
                      value={d.days_book_in_advance}
                      onChange={(e) =>
                        patch(idx, (r) => ({
                          ...r,
                          days_book_in_advance: Number(e.target.value) || 0,
                        }))
                      }
                    />
                  </Td>
                  <Td>
                    <HmEdit
                      h={Math.floor(d.mins_book_before_appt / 60)}
                      m={d.mins_book_before_appt % 60}
                      onChange={(h, m) =>
                        patch(idx, (r) => ({ ...r, mins_book_before_appt: h * 60 + m }))
                      }
                    />
                  </Td>
                  <Td>
                    <Toggle
                      checked={d.customer_cancellations}
                      onChange={(v) => patch(idx, (r) => ({ ...r, customer_cancellations: v }))}
                    />
                  </Td>
                  <Td>
                    <HmEdit
                      h={Math.floor(d.mins_cancel_before_appt / 60)}
                      m={d.mins_cancel_before_appt % 60}
                      onChange={(h, m) =>
                        patch(idx, (r) => ({ ...r, mins_cancel_before_appt: h * 60 + m }))
                      }
                    />
                  </Td>
                  <Td>
                    <HmEdit
                      h={d.reminder1_h}
                      m={d.reminder1_m}
                      onChange={(h, m) =>
                        patch(idx, (r) => ({ ...r, reminder1_h: h, reminder1_m: m }))
                      }
                    />
                  </Td>
                  <Td>
                    <HmEdit
                      h={d.reminder2_h}
                      m={d.reminder2_m}
                      onChange={(h, m) =>
                        patch(idx, (r) => ({ ...r, reminder2_h: h, reminder2_m: m }))
                      }
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="min-w-[100px] px-2 py-3 text-left text-[10px] font-semibold uppercase tracking-wide">
      {children}
    </th>
  );
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-2 py-2 align-middle">{children}</td>;
}

function MinSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <Select className="w-20" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {BOOKING_INTERVAL_OPTIONS.map((m) => (
        <option key={m} value={m}>
          {m} min
        </option>
      ))}
    </Select>
  );
}

function HmEdit({
  h,
  m,
  onChange,
}: {
  h: number;
  m: number;
  onChange: (h: number, m: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Select className="w-16" value={h} onChange={(e) => onChange(Number(e.target.value), m)}>
        {HOUR_OPTIONS.map((hh) => (
          <option key={hh} value={hh}>
            {hh}h
          </option>
        ))}
      </Select>
      <Select className="w-16" value={m} onChange={(e) => onChange(h, Number(e.target.value))}>
        {MINUTE_OPTIONS.map((mm) => (
          <option key={mm} value={mm}>
            {mm}m
          </option>
        ))}
      </Select>
    </div>
  );
}

function toDraft(row: BarberSettingsRow): Draft {
  return {
    scope: row.scope,
    barber_id: row.barber_id,
    allow_booking_wo_payment: row.allow_booking_wo_payment,
    booking_tip: row.booking_tip,
    confirmation_tip: row.confirmation_tip,
    allow_multiple_services: row.allow_multiple_services,
    client_booking_interval_min: row.client_booking_interval_min,
    barber_booking_interval_min: row.barber_booking_interval_min,
    days_book_in_advance: row.days_book_in_advance,
    mins_book_before_appt: row.mins_book_before_appt,
    customer_cancellations: row.customer_cancellations,
    mins_cancel_before_appt: row.mins_cancel_before_appt,
    reminder1_h: row.reminder1_h,
    reminder1_m: row.reminder1_m,
    reminder2_h: row.reminder2_h,
    reminder2_m: row.reminder2_m,
  };
}
