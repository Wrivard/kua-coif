'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';

export type SortDirection = 'asc' | 'desc';

export type ColumnDef<Row> = {
  id: string;
  header: ReactNode;
  /** Render the cell for this column. */
  cell: (row: Row) => ReactNode;
  /** Comparable value for client-side sorting. Required when sortable. */
  sortValue?: (row: Row) => string | number;
  sortable?: boolean;
  className?: string;
  headerClassName?: string;
  width?: string;
  align?: 'left' | 'right' | 'center';
};

export type PaginationState = {
  page: number;
  pageSize: number;
  total: number;
};

type Props<Row> = {
  columns: ReadonlyArray<ColumnDef<Row>>;
  data: ReadonlyArray<Row>;
  getRowKey: (row: Row, index: number) => string;
  /** Optional row click handler — turns rows into clickable. */
  onRowClick?: (row: Row) => void;
  /** When true, prepends a non-sortable grip column for future drag-reorder. */
  reorderable?: boolean;
  emptyState?: { title: ReactNode; description?: ReactNode; action?: ReactNode };
  pagination?: PaginationState & { onPageChange: (page: number) => void };
  className?: string;
  loading?: boolean;
};

export function DataTable<Row>({
  columns,
  data,
  getRowKey,
  onRowClick,
  reorderable,
  emptyState,
  pagination,
  className,
  loading,
}: Props<Row>) {
  const t = useTranslations('common.table');
  const [sort, setSort] = useState<{ id: string; dir: SortDirection } | null>(null);

  const sortedData = useMemo(() => {
    if (!sort) return data;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return data;
    const copy = [...data];
    copy.sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (va < vb) return sort.dir === 'asc' ? -1 : 1;
      if (va > vb) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }, [columns, data, sort]);

  function toggleSort(colId: string) {
    setSort((current) => {
      if (current?.id !== colId) return { id: colId, dir: 'asc' };
      if (current.dir === 'asc') return { id: colId, dir: 'desc' };
      return null;
    });
  }

  const isEmpty = !loading && sortedData.length === 0;

  return (
    <div className={cn('flex flex-col rounded border border-border bg-bg-surface', className)}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-bg-surface">
            <tr className="border-b border-border">
              {reorderable && <th className="w-8" />}
              {columns.map((col) => {
                const isSorted = sort?.id === col.id;
                return (
                  <th
                    key={col.id}
                    className={cn(
                      'px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-muted',
                      col.align === 'right' && 'text-right',
                      col.align === 'center' && 'text-center',
                      col.headerClassName,
                    )}
                    style={col.width ? { width: col.width } : undefined}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.id)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-sm transition-colors hover:text-text-primary',
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface',
                          isSorted && 'text-text-primary',
                        )}
                      >
                        {col.header}
                        {isSorted ? (
                          sort.dir === 'asc' ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )
                        ) : (
                          <ChevronUp className="h-3.5 w-3.5 opacity-30" />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody aria-busy={loading ? 'true' : undefined}>
            {loading ? (
              // Skeleton rows match the live row layout (one Skeleton per
              // column) so the page doesn't reflow when data arrives.
              // 5 rows × column count gives the right visual weight on
              // most tables without being noisy.
              Array.from({ length: 5 }).map((_, rowIdx) => (
                <tr key={`skeleton-${rowIdx}`} className="border-b border-border last:border-b-0">
                  {reorderable && <td className="w-8 px-2" />}
                  {columns.map((col, colIdx) => (
                    <td
                      key={col.id}
                      className={cn(
                        'px-4 py-3',
                        col.align === 'right' && 'text-right',
                        col.align === 'center' && 'text-center',
                      )}
                    >
                      {/* Vary widths so it doesn't look like a mechanical grid. */}
                      <Skeleton
                        className={cn(
                          'h-4',
                          colIdx === 0 ? 'w-32' : colIdx % 3 === 0 ? 'w-20' : 'w-16',
                        )}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : isEmpty ? (
              <tr>
                <td colSpan={columns.length + (reorderable ? 1 : 0)} className="p-0">
                  <EmptyState
                    className="rounded-none border-0"
                    title={emptyState?.title ?? t('empty')}
                    description={emptyState?.description}
                    action={emptyState?.action}
                  />
                </td>
              </tr>
            ) : (
              sortedData.map((row, idx) => (
                <tr
                  key={getRowKey(row, idx)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'border-b border-border transition-colors last:border-b-0',
                    onRowClick && 'cursor-pointer hover:bg-bg-surface-2',
                  )}
                >
                  {reorderable && (
                    <td className="w-8 px-2 text-text-muted">
                      <GripVertical className="h-4 w-4 cursor-grab" aria-hidden />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.id}
                      className={cn(
                        'px-4 py-3 text-sm text-text-primary',
                        col.align === 'right' && 'text-right',
                        col.align === 'center' && 'text-center',
                        col.className,
                      )}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination ? (
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-text-muted">
          <span>
            {t('pageOf', {
              page: pagination.page,
              total: Math.max(1, Math.ceil(pagination.total / pagination.pageSize)),
              rows: pagination.total,
            })}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              className="rounded border border-border px-3 py-1 transition-colors hover:bg-bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('prev')}
            </button>
            <button
              type="button"
              disabled={pagination.page * pagination.pageSize >= pagination.total}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              className="rounded border border-border px-3 py-1 transition-colors hover:bg-bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('next')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
