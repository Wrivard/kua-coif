'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
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
  /**
   * Loop 45 (P115 from AUDIT_PHASE70) — opt-in row virtualization.
   * When true AND `data.length > 100`, the desktop table renders
   * only the visible rows + a few overscan items via
   * `@tanstack/react-virtual`. Useful when pagination is OFF and
   * the page wants infinite-scroll over a large dataset (1000+
   * rows). At small data sizes the full render is faster than the
   * virtualizer overhead, so we skip the path.
   *
   * Default false — every existing table call-site stays on the
   * regular full render until it explicitly asks for virtualization.
   */
  virtualize?: boolean;
  /** Pixel height per row. Defaults to 56 — matches the
   *  `px-4 py-4 text-sm` row padding used by every table. Override
   *  if the table renders taller rows (e.g., avatar chips). */
  estimatedRowHeight?: number;
  /** Viewport height when virtualization is on. Defaults to 600px;
   *  the scrollable region inside the card. */
  virtualizedMaxHeight?: number;
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
  virtualize = false,
  estimatedRowHeight = 56,
  virtualizedMaxHeight = 600,
}: Props<Row>) {
  const t = useTranslations('common.table');
  const [sort, setSort] = useState<{ id: string; dir: SortDirection } | null>(null);
  // Loop 45 — scroll container ref consumed by react-virtual. Only
  // used on the virtualized desktop path; the parent div otherwise
  // ignores it.
  const scrollRef = useRef<HTMLDivElement | null>(null);

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

  // Loop 45 — virtualize only when explicitly opted-in AND the row
  // count justifies it (overhead vs full-render isn't worth it for
  // small tables). The threshold of 100 is chosen so that
  // /clients-style screens (500 rows when cap is lifted) trigger
  // virtualization, while /barbers (4 rows) keeps its current
  // full-render path with sticky thead etc.
  const virtualizationActive = virtualize && !loading && sortedData.length > 100;

  const virtualizer = useVirtualizer({
    count: virtualizationActive ? sortedData.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: 8,
  });

  return (
    <div className={cn('flex flex-col rounded-lg bg-bg-surface shadow-sm', className)}>
      {/* Desktop: full table. Hidden on mobile where the dense grid would
          require horizontal scrolling and lose readability. */}
      <div
        ref={virtualizationActive ? scrollRef : undefined}
        className={cn('hidden overflow-x-auto md:block', virtualizationActive && 'overflow-y-auto')}
        style={virtualizationActive ? { maxHeight: `${virtualizedMaxHeight}px` } : undefined}
      >
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-bg-surface">
            <tr className="border-b border-border-strong">
              {reorderable && <th className="w-8" />}
              {columns.map((col) => {
                const isSorted = sort?.id === col.id;
                return (
                  <th
                    key={col.id}
                    scope="col"
                    aria-sort={
                      col.sortable
                        ? isSorted
                          ? sort?.dir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                        : undefined
                    }
                    className={cn(
                      'px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-muted',
                      col.align === 'right' && 'text-right tabular-nums',
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
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface',
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
                <tr
                  key={`skeleton-${rowIdx}`}
                  className="border-b border-border-soft last:border-b-0"
                >
                  {reorderable && <td className="w-8 px-2" />}
                  {columns.map((col, colIdx) => (
                    <td
                      key={col.id}
                      className={cn(
                        'px-4 py-4',
                        col.align === 'right' && 'text-right tabular-nums',
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
            ) : virtualizationActive ? (
              <VirtualizedRows
                virtualItems={virtualizer.getVirtualItems()}
                totalSize={virtualizer.getTotalSize()}
                data={sortedData}
                columns={columns}
                reorderable={!!reorderable}
                onRowClick={onRowClick}
                getRowKey={getRowKey}
              />
            ) : (
              sortedData.map((row, idx) => (
                <tr
                  key={getRowKey(row, idx)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'border-b border-border-soft transition-colors last:border-b-0',
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
                        'px-4 py-4 text-sm text-text-primary',
                        col.align === 'right' && 'text-right tabular-nums',
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

      {/* Mobile: card-per-row layout. First column renders as the card
          title, every other non-actions column renders as a `LABEL · value`
          row, and the last empty-header column (typically icon-only row
          actions) renders aligned to the bottom-right.

          The breakpoint matches the desktop sidebar's `md:flex` so the
          two responsive layers swap together. */}
      <div className="md:hidden" aria-busy={loading ? 'true' : undefined}>
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div
              key={`m-skeleton-${i}`}
              className="border-b border-border-soft px-4 py-3 last:border-b-0"
            >
              <Skeleton className="mb-2 h-4 w-40" />
              <Skeleton className="mb-1 h-3 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))
        ) : isEmpty ? (
          <EmptyState
            className="rounded-none border-0"
            title={emptyState?.title ?? t('empty')}
            description={emptyState?.description}
            action={emptyState?.action}
          />
        ) : (
          sortedData.map((row, idx) => {
            const clickable = Boolean(onRowClick);
            return (
              <div
                key={getRowKey(row, idx)}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onClick={clickable ? () => onRowClick!(row) : undefined}
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick!(row);
                        }
                      }
                    : undefined
                }
                className={cn(
                  'block border-b border-border-soft px-4 py-3 transition-colors last:border-b-0',
                  clickable &&
                    'cursor-pointer hover:bg-bg-surface-2 focus:outline-none focus-visible:bg-bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
                )}
              >
                {columns.map((col, colIdx) => {
                  const isPrimary = colIdx === 0;
                  // An empty header signals "this column is decorative" —
                  // usually the row-action icon column. Render it alone at
                  // the end without a label.
                  const isActions =
                    !col.header || (typeof col.header === 'string' && col.header.trim() === '');
                  if (isPrimary) {
                    return (
                      <div key={col.id} className="text-sm font-medium text-text-primary">
                        {col.cell(row)}
                      </div>
                    );
                  }
                  if (isActions) {
                    return (
                      <div
                        key={col.id}
                        className="mt-2 flex justify-end"
                        // Action icons inside should NOT trigger the card click
                        // (they have their own handlers + stopPropagation, but
                        // belt-and-braces).
                        onClick={(e) => e.stopPropagation()}
                      >
                        {col.cell(row)}
                      </div>
                    );
                  }
                  return (
                    <div
                      key={col.id}
                      className="mt-1 flex items-baseline justify-between gap-3 text-xs"
                    >
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                        {col.header}
                      </span>
                      <span className="min-w-0 truncate text-right tabular-nums text-text-primary">
                        {col.cell(row)}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      {pagination ? (
        <div className="flex items-center justify-between border-t border-border-soft px-4 py-3 text-xs text-text-muted">
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
              className="rounded-md px-3 py-1 transition-colors hover:bg-bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('prev')}
            </button>
            <button
              type="button"
              disabled={pagination.page * pagination.pageSize >= pagination.total}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              className="rounded-md px-3 py-1 transition-colors hover:bg-bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('next')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Loop 45 (P115) — virtualized tbody body. The standard
 * react-virtual recipe for tables: render a spacer row whose
 * height equals the total scroll surface, then absolutely-position
 * each visible row by `transform: translateY(start)`. The spacer
 * row keeps the scrollbar size accurate even when only a window of
 * rows is in the DOM.
 *
 * Caveats / known limitations:
 *   - The translated rows break native `<tr>` zebra striping
 *     (each row is at offset 0 visually). We don't use zebra
 *     striping anyway (the design system uses hover-bg only).
 *   - Sticky `thead` continues to work because the scroll
 *     container is the parent <div>, not the tbody.
 *   - Drag-reorder (reorderable=true) is not supported in
 *     virtualized mode — the grip column renders but @dnd-kit's
 *     position math doesn't play with translateY-based virtual
 *     rows. Reorderable + virtualize is unlikely to be a real
 *     use-case (drag is for small ordered sets like services).
 */
function VirtualizedRows<Row>({
  virtualItems,
  totalSize,
  data,
  columns,
  reorderable,
  onRowClick,
  getRowKey,
}: {
  virtualItems: ReturnType<ReturnType<typeof useVirtualizer>['getVirtualItems']>;
  totalSize: number;
  data: ReadonlyArray<Row>;
  columns: ReadonlyArray<ColumnDef<Row>>;
  reorderable: boolean;
  onRowClick?: (row: Row) => void;
  getRowKey: (row: Row, index: number) => string;
}) {
  // The spacer row enforces total scroll height. Subtract the height
  // of the last visible row's bottom offset so the scrollbar lands
  // exactly at the end of the dataset.
  const firstStart = virtualItems[0]?.start ?? 0;
  const lastEnd = virtualItems[virtualItems.length - 1]?.end ?? 0;
  const paddingTop = firstStart;
  const paddingBottom = totalSize - lastEnd;

  return (
    <>
      {paddingTop > 0 ? (
        <tr aria-hidden>
          <td colSpan={columns.length + (reorderable ? 1 : 0)} style={{ height: paddingTop }} />
        </tr>
      ) : null}
      {virtualItems.map((vRow) => {
        const row = data[vRow.index]!;
        return (
          <tr
            key={getRowKey(row, vRow.index)}
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
                  col.align === 'right' && 'text-right tabular-nums',
                  col.align === 'center' && 'text-center',
                  col.className,
                )}
              >
                {col.cell(row)}
              </td>
            ))}
          </tr>
        );
      })}
      {paddingBottom > 0 ? (
        <tr aria-hidden>
          <td colSpan={columns.length + (reorderable ? 1 : 0)} style={{ height: paddingBottom }} />
        </tr>
      ) : null}
    </>
  );
}
