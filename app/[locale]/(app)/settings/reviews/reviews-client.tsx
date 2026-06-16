'use client';

import { useMemo, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Star, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyCell } from '@/components/ui/empty-cell';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { deleteReview, moderateReview } from './actions';

export type ReviewRow = {
  id: string;
  rating: number;
  comment: string | null;
  status: 'pending' | 'published' | 'rejected';
  client_name: string | null;
  barber_id: string | null;
  created_at: string;
  published_at: string | null;
  appointment_id: string | null;
};

export function ReviewsClient({
  rows,
  barberNames,
}: {
  rows: ReviewRow[];
  barberNames: Record<string, string>;
}) {
  const { show } = useToast();
  const t = useTranslations('pages.settings.reviews');
  const tCommon = useTranslations('common');
  const [isPending, startTransition] = useTransition();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    return {
      pending: rows.filter((r) => r.status === 'pending'),
      published: rows.filter((r) => r.status === 'published'),
      rejected: rows.filter((r) => r.status === 'rejected'),
    };
  }, [rows]);

  function moderate(id: string, status: 'published' | 'rejected') {
    startTransition(async () => {
      const result = await moderateReview({ review_id: id, status });
      if (result.ok)
        show({
          variant: 'success',
          title: status === 'published' ? t('toasts.published') : t('toasts.rejected'),
        });
      else show({ variant: 'danger', title: t('toasts.moderationFailed') });
    });
  }

  function doRemove(id: string) {
    startTransition(async () => {
      const result = await deleteReview({ review_id: id });
      if (result.ok) show({ variant: 'success', title: t('toasts.deleted') });
      else show({ variant: 'danger', title: t('toasts.deleteFailed') });
    });
  }

  return (
    <>
      <PageHeader title={t('title')} />
      <div className="space-y-6 p-6">
        <Section title={t('sections.pending')} rows={grouped.pending} kind="pending">
          {(r) => (
            <Row
              key={r.id}
              row={r}
              barberNames={barberNames}
              actions={
                <>
                  <button
                    type="button"
                    onClick={() => moderate(r.id, 'published')}
                    disabled={isPending}
                    className="rounded-md p-1 text-text-muted transition-colors duration-150 ease-out-quint hover:bg-bg-surface-2 hover:text-success focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={t('actions.publish')}
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moderate(r.id, 'rejected')}
                    disabled={isPending}
                    className="rounded-md p-1 text-text-muted transition-colors duration-150 ease-out-quint hover:bg-bg-surface-2 hover:text-warning focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={t('actions.reject')}
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(r.id)}
                    disabled={isPending}
                    className="rounded-md p-1 text-text-muted transition-colors duration-150 ease-out-quint hover:bg-bg-surface-2 hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={tCommon('actions.delete')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              }
            />
          )}
        </Section>

        <Section title={t('sections.published')} rows={grouped.published} kind="published">
          {(r) => (
            <Row
              key={r.id}
              row={r}
              barberNames={barberNames}
              actions={
                <button
                  type="button"
                  onClick={() => setConfirmId(r.id)}
                  disabled={isPending}
                  className="rounded-md p-1 text-text-muted transition-colors duration-150 ease-out-quint hover:bg-bg-surface-2 hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={tCommon('actions.delete')}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              }
            />
          )}
        </Section>

        <Section title={t('sections.rejected')} rows={grouped.rejected} kind="rejected">
          {(r) => (
            <Row
              key={r.id}
              row={r}
              barberNames={barberNames}
              actions={
                <button
                  type="button"
                  onClick={() => setConfirmId(r.id)}
                  disabled={isPending}
                  className="rounded-md p-1 text-text-muted transition-colors duration-150 ease-out-quint hover:bg-bg-surface-2 hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={tCommon('actions.delete')}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              }
            />
          )}
        </Section>
      </div>

      <ConfirmDialog
        open={confirmId !== null}
        title={t('confirmDelete.title')}
        description={t('confirmDelete.description')}
        destructive
        loading={isPending}
        confirmLabel={tCommon('actions.delete')}
        cancelLabel={tCommon('actions.cancel')}
        onConfirm={() => {
          if (confirmId) doRemove(confirmId);
          setConfirmId(null);
        }}
        onCancel={() => setConfirmId(null)}
      />
    </>
  );
}

function Section({
  title,
  rows,
  kind,
  children,
}: {
  title: string;
  rows: ReviewRow[];
  kind: 'pending' | 'published' | 'rejected';
  children: (r: ReviewRow) => React.ReactNode;
}) {
  const t = useTranslations('pages.settings.reviews');
  const variant: Record<typeof kind, 'accent' | 'success' | 'default'> = {
    pending: 'accent',
    published: 'success',
    rejected: 'default',
  } as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <Badge variant={variant[kind]}>{rows.length}</Badge>
      </CardHeader>
      <CardBody className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-sm text-text-muted">{t('empty')}</p>
        ) : (
          rows.map((r) => children(r))
        )}
      </CardBody>
    </Card>
  );
}

function Row({
  row,
  barberNames,
  actions,
}: {
  row: ReviewRow;
  barberNames: Record<string, string>;
  actions: React.ReactNode;
}) {
  const t = useTranslations('pages.settings.reviews');
  const locale = useLocale();
  const stars = '★'.repeat(row.rating) + '☆'.repeat(5 - row.rating);
  const barberName = row.barber_id ? barberNames[row.barber_id] : null;
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg bg-bg-base p-3 text-sm shadow-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="font-mono tracking-widest text-warning"
            aria-label={t('ratingAria', { rating: row.rating })}
          >
            {stars}
          </span>
          <span className="text-xs text-text-muted">
            {row.client_name ?? <EmptyCell />}
            {barberName ? ` · ${barberName}` : ''}
          </span>
        </div>
        {row.comment ? (
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-text-primary">
            {row.comment}
          </p>
        ) : (
          <p className="mt-1 text-xs italic text-text-muted">{t('noComment')}</p>
        )}
        <p className="mt-1 text-[11px] text-text-muted">
          {new Date(row.created_at).toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-CA')}
        </p>
      </div>
      <div className="inline-flex shrink-0 items-center gap-1">{actions}</div>
    </div>
  );
}

// Unused — kept for future use when a Star-icon column lookalike is needed.
export { Star };
