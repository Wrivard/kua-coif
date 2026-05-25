'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/lib/utils';
import type { Json } from '@/db/types';

export type AuditLogRow = {
  id: number;
  occurred_at: string;
  action: string;
  entity: string;
  entity_id: string | null;
  diff: Json | null;
  actor: { email: string; fullName: string | null };
};

type Props = {
  locale: string;
  rows: AuditLogRow[];
};

function actionVariant(action: string): 'success' | 'accent' | 'danger' | 'default' {
  if (action === 'insert') return 'success';
  if (action === 'update') return 'accent';
  if (action === 'delete') return 'danger';
  return 'default';
}

export function AuditLogClient({ locale, rows }: Props) {
  const t = useTranslations('pages.settings.auditLog');
  const [openId, setOpenId] = useState<number | null>(null);
  const fmt = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    dateStyle: 'short',
    timeStyle: 'medium',
  });

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle', { count: rows.length })} />

      <div className="p-6">
        <div className="overflow-hidden rounded border border-border bg-bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-surface-2 text-[10px] uppercase tracking-wide text-text-muted">
                <th className="w-6" />
                <th className="px-3 py-2 text-left">{t('columns.when')}</th>
                <th className="px-3 py-2 text-left">{t('columns.who')}</th>
                <th className="px-3 py-2 text-left">{t('columns.action')}</th>
                <th className="px-3 py-2 text-left">{t('columns.entity')}</th>
                <th className="px-3 py-2 text-left">{t('columns.entityId')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-text-muted">
                    {t('empty')}
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const isOpen = openId === row.id;
                  return (
                    <Row
                      key={row.id}
                      row={row}
                      isOpen={isOpen}
                      onToggle={() => setOpenId(isOpen ? null : row.id)}
                      formatWhen={(d) => fmt.format(new Date(d))}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-text-muted">{t('limitHint')}</p>
      </div>
    </>
  );
}

function Row({
  row,
  isOpen,
  onToggle,
  formatWhen,
}: {
  row: AuditLogRow;
  isOpen: boolean;
  onToggle: () => void;
  formatWhen: (d: string) => string;
}) {
  const actorName = row.actor.fullName ?? row.actor.email;
  return (
    <>
      <tr
        className={cn(
          'cursor-pointer border-b border-border transition-colors hover:bg-bg-surface-2',
          isOpen && 'bg-bg-surface-2',
        )}
        onClick={onToggle}
      >
        <td className="px-2">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-text-muted" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4 text-text-muted" aria-hidden />
          )}
        </td>
        <td className="px-3 py-2 font-mono text-xs text-text-secondary">
          {formatWhen(row.occurred_at)}
        </td>
        <td className="px-3 py-2">{actorName}</td>
        <td className="px-3 py-2">
          <Badge variant={actionVariant(row.action)}>{row.action}</Badge>
        </td>
        <td className="px-3 py-2 font-mono text-xs">{row.entity}</td>
        <td className="px-3 py-2 font-mono text-[11px] text-text-muted">{row.entity_id ?? '—'}</td>
      </tr>
      {isOpen && row.diff ? (
        <tr className="border-b border-border bg-bg-base">
          <td colSpan={6} className="p-3">
            <pre className="max-h-64 overflow-auto rounded border border-border bg-bg-surface p-3 text-[11px] leading-relaxed text-text-secondary">
              {JSON.stringify(row.diff, null, 2)}
            </pre>
          </td>
        </tr>
      ) : null}
    </>
  );
}
