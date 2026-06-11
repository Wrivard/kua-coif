'use client';

import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { Download, FolderTree, GripVertical, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { EmptyCell } from '@/components/ui/empty-cell';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { RowActions } from '@/components/ui/row-actions';
import { useToast } from '@/components/ui/toast';
import { cn, formatCurrencyCAD } from '@/lib/utils';
import type { ServiceCategoryRow, ServiceRow, TaxRow } from '@/db/rows';
import { CategoryManagementModal } from './category-management-modal';
import { ServiceFormModal } from './service-form-modal';
import { deleteService, reorderServices, toggleServiceStatus } from './actions';

export type ServicesClientProps = {
  locale: string;
  services: ServiceRow[];
  categories: ServiceCategoryRow[];
  taxes: TaxRow[];
  links: Array<{ service_id: string; tax_id: string }>;
};

type Mode = { kind: 'closed' } | { kind: 'add' } | { kind: 'edit'; service: ServiceRow };

export function ServicesClient({
  locale,
  services,
  categories,
  taxes,
  links,
}: ServicesClientProps) {
  const t = useTranslations('pages.services');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();

  const [mode, setMode] = useState<Mode>({ kind: 'closed' });
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ServiceRow | null>(null);
  const [isPending, startTransition] = useTransition();

  // Drag-to-reorder (Wave 3) keeps a local copy of the ordered list so the
  // reorder is optimistic — rows move instantly, then we persist. Re-sync
  // whenever the server sends a fresh ordering (revalidation after save).
  const [ordered, setOrdered] = useState<ServiceRow[]>(services);
  useEffect(() => {
    setOrdered(services);
  }, [services]);

  // A small activation distance so clicking the action icons / a row never
  // gets swallowed as the start of a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Keyboard drag: focus a grip handle, Space to lift, arrows to reorder,
    // Space to drop. The grip <button> already carries dnd-kit's attributes
    // + listeners, so this is the only missing piece for keyboard reorder.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const taxById = useMemo(() => new Map(taxes.map((x) => [x.id, x])), [taxes]);
  const taxIdsByService = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of links) {
      const list = m.get(l.service_id) ?? [];
      list.push(l.tax_id);
      m.set(l.service_id, list);
    }
    return m;
  }, [links]);

  function onDelete(row: ServiceRow) {
    startTransition(async () => {
      const result = await deleteService({ id: row.id });
      setConfirmDelete(null);
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.deleted', { name: row.name }) });
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  function onToggleStatus(row: ServiceRow) {
    // Optimistic flip — the row's displayed status comes from `ordered`, so
    // move it now and reconcile on the round-trip. Mirrors the drag-reorder
    // pattern below: snapshot `previous`, flip, revert on failure. The prop
    // re-sync (:75-77) settles any drift after revalidation.
    const previous = ordered;
    const flipped = row.status === 'enabled' ? 'disabled' : 'enabled';
    setOrdered((prev) => prev.map((s) => (s.id === row.id ? { ...s, status: flipped } : s)));
    startTransition(async () => {
      const result = await toggleServiceStatus({ id: row.id });
      if (result.ok) {
        show({ variant: 'info', title: t('toasts.statusFlipped', { name: row.name }) });
      } else {
        setOrdered(previous); // revert
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = ordered.findIndex((s) => s.id === active.id);
    const newIndex = ordered.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const previous = ordered;
    const next = arrayMove(ordered, oldIndex, newIndex);
    setOrdered(next); // optimistic

    startTransition(async () => {
      const result = await reorderServices({ ids: next.map((s) => s.id) });
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.reordered') });
      } else {
        setOrdered(previous); // revert
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  function renderTaxCell(r: ServiceRow) {
    const ids = taxIdsByService.get(r.id) ?? [];
    if (ids.length === 0) return <EmptyCell />;
    return (
      <div className="flex flex-col text-xs text-text-secondary">
        {ids.map((id) => {
          const tx = taxById.get(id);
          if (!tx) return null;
          return (
            <span key={id}>
              {tx.name} {tx.percentage}%
            </span>
          );
        })}
      </div>
    );
  }

  function renderActions(r: ServiceRow) {
    return (
      <RowActions
        actions={[
          {
            icon: Pencil,
            label: tCommon('actions.edit'),
            onClick: () => setMode({ kind: 'edit', service: r }),
          },
          { icon: Power, label: t('actions.toggleStatus'), onClick: () => onToggleStatus(r) },
          {
            icon: Trash2,
            label: tCommon('actions.delete'),
            tone: 'danger',
            onClick: () => setConfirmDelete(r),
          },
        ]}
      />
    );
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          <>
            <Button variant="secondary" onClick={() => setCategoriesOpen(true)} size="sm">
              <FolderTree className="h-4 w-4" /> {t('manageCategories')}
            </Button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- CSV download from an API route; <Link> does client nav, not a file download */}
            <a
              href="/api/export/services"
              className="inline-flex h-8 items-center gap-2 rounded-sm border border-border bg-bg-surface px-3 text-xs font-medium text-text-primary hover:bg-bg-surface-2"
            >
              <Download className="h-3.5 w-3.5" /> {tCommon('actions.export')}
            </a>
            <Button onClick={() => setMode({ kind: 'add' })} size="sm">
              <Plus className="h-4 w-4" /> {t('addService')}
            </Button>
          </>
        }
      />

      <div className="p-6">
        {ordered.length === 0 ? (
          <div className="rounded-lg bg-bg-surface shadow-sm">
            <EmptyState
              className="rounded-none border-0"
              title={t('emptyTitle')}
              description={t('emptyHint')}
              action={
                <Button onClick={() => setMode({ kind: 'add' })} size="sm">
                  <Plus className="h-4 w-4" /> {t('addService')}
                </Button>
              }
            />
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={ordered.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              {/* Desktop: dense sortable table. Mirrors the DataTable column
                  layout but renders draggable <tr>s so sort_order persists. */}
              <div className="hidden overflow-x-auto rounded-lg bg-bg-surface shadow-sm md:block">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-bg-surface">
                    <tr className="border-b border-border-strong">
                      <th className="w-8" aria-label={t('columns.sort')} />
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                        {t('columns.name')}
                      </th>
                      <th
                        className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-text-muted"
                        style={{ width: '100px' }}
                      >
                        {t('columns.duration')}
                      </th>
                      <th
                        className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-text-muted"
                        style={{ width: '120px' }}
                      >
                        {t('columns.price')}
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                        {t('columns.tax')}
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                        {t('columns.category')}
                      </th>
                      <th
                        className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-muted"
                        style={{ width: '110px' }}
                      >
                        {t('columns.status')}
                      </th>
                      <th className="px-4 py-3" style={{ width: '120px' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {ordered.map((row) => (
                      <SortableServiceRow key={row.id} id={row.id}>
                        {({ attributes, listeners, handleRef, dragging }) => (
                          <>
                            <td className="w-8 px-2 text-text-muted">
                              <button
                                type="button"
                                ref={handleRef}
                                aria-label={t('actions.dragHandle')}
                                className={cn(
                                  'cursor-grab touch-none rounded-md p-1 hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                                  dragging && 'cursor-grabbing',
                                )}
                                {...attributes}
                                {...listeners}
                              >
                                <GripVertical className="h-4 w-4" aria-hidden />
                              </button>
                            </td>
                            <td className="px-4 py-3 text-sm text-text-primary">
                              <span className="font-medium">{row.name}</span>
                            </td>
                            <td className="px-4 py-3 text-right text-sm text-text-primary">
                              {row.duration_min} min
                            </td>
                            <td className="px-4 py-3 text-right text-sm text-text-primary">
                              {formatCurrencyCAD(row.price, locale === 'fr' ? 'fr' : 'en')}
                            </td>
                            <td className="px-4 py-3 text-sm text-text-primary">
                              {renderTaxCell(row)}
                            </td>
                            <td className="px-4 py-3 text-sm text-text-primary">
                              {row.category_id ? (
                                <span>
                                  {categoryById.get(row.category_id)?.name ?? <EmptyCell />}
                                </span>
                              ) : (
                                <EmptyCell />
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-text-primary">
                              {row.status === 'enabled' ? (
                                <Badge variant="success">{t('status.enabled')}</Badge>
                              ) : (
                                <Badge>{t('status.disabled')}</Badge>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-text-primary">
                              {renderActions(row)}
                            </td>
                          </>
                        )}
                      </SortableServiceRow>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile: card-per-row, draggable by the grip handle. */}
              <div className="md:hidden">
                {ordered.map((row) => (
                  <SortableServiceCard key={row.id} id={row.id}>
                    {({ attributes, listeners, handleRef, dragging }) => (
                      <div
                        className={cn(
                          'flex items-start gap-2 border-b border-border-soft bg-bg-surface px-3 py-3 first:rounded-t-lg last:rounded-b-lg last:border-b-0',
                          dragging && 'shadow-md',
                        )}
                      >
                        <button
                          type="button"
                          ref={handleRef}
                          aria-label={t('actions.dragHandle')}
                          className={cn(
                            'mt-0.5 cursor-grab touch-none rounded-md p-1 text-text-muted hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                            dragging && 'cursor-grabbing',
                          )}
                          {...attributes}
                          {...listeners}
                        >
                          <GripVertical className="h-4 w-4" aria-hidden />
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-medium text-text-primary">
                              {row.name}
                            </span>
                            {row.status === 'enabled' ? (
                              <Badge variant="success">{t('status.enabled')}</Badge>
                            ) : (
                              <Badge>{t('status.disabled')}</Badge>
                            )}
                          </div>
                          <div className="mt-1 flex items-baseline justify-between gap-3 text-xs">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                              {t('columns.duration')}
                            </span>
                            <span className="text-text-primary">{row.duration_min} min</span>
                          </div>
                          <div className="mt-1 flex items-baseline justify-between gap-3 text-xs">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                              {t('columns.price')}
                            </span>
                            <span className="text-text-primary">
                              {formatCurrencyCAD(row.price, locale === 'fr' ? 'fr' : 'en')}
                            </span>
                          </div>
                          <div className="mt-1 flex items-baseline justify-between gap-3 text-xs">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                              {t('columns.category')}
                            </span>
                            <span className="min-w-0 truncate text-right text-text-primary">
                              {row.category_id ? (
                                (categoryById.get(row.category_id)?.name ?? <EmptyCell />)
                              ) : (
                                <EmptyCell />
                              )}
                            </span>
                          </div>
                          <div className="mt-2 flex justify-end">{renderActions(row)}</div>
                        </div>
                      </div>
                    )}
                  </SortableServiceCard>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {mode.kind !== 'closed' && (
        <ServiceFormModal
          mode={mode}
          categories={categories}
          taxes={taxes}
          existingTaxIds={mode.kind === 'edit' ? (taxIdsByService.get(mode.service.id) ?? []) : []}
          onClose={() => setMode({ kind: 'closed' })}
        />
      )}

      {categoriesOpen && (
        <CategoryManagementModal
          categories={categories}
          services={services}
          onClose={() => setCategoriesOpen(false)}
        />
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t('confirmDelete.title')}
        description={
          confirmDelete ? t('confirmDelete.description', { name: confirmDelete.name }) : ''
        }
        destructive
        loading={isPending}
        confirmLabel={tCommon('actions.delete')}
        cancelLabel={tCommon('actions.cancel')}
        onConfirm={() => confirmDelete && onDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}

type SortableHandle = ReturnType<typeof useSortable>;

type SortableRenderProps = {
  // dnd-kit's `attributes` (role/tabIndex/aria) and `listeners`
  // (pointer/keyboard handlers) are kept separate: their types don't
  // merge cleanly (SyntheticListenerMap is a Function index signature),
  // so the caller spreads both onto the grip handle.
  attributes: SortableHandle['attributes'];
  listeners: SortableHandle['listeners'];
  handleRef: (node: HTMLElement | null) => void;
  dragging: boolean;
};

/**
 * Sortable table row. Drag listeners are attached to the grip handle only
 * (via `handleProps`/`handleRef`), so the row's action buttons keep working.
 */
function SortableServiceRow({
  id,
  children,
}: {
  id: string;
  children: (props: SortableRenderProps) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { position: 'relative', zIndex: 1, background: 'var(--bg-surface-2)' } : {}),
  };

  return (
    <tr ref={setNodeRef} style={style} className="border-b border-border-soft last:border-b-0">
      {children({
        attributes,
        listeners,
        handleRef: setActivatorNodeRef,
        dragging: isDragging,
      })}
    </tr>
  );
}

function SortableServiceCard({
  id,
  children,
}: {
  id: string;
  children: (props: SortableRenderProps) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { position: 'relative', zIndex: 1 } : {}),
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children({
        attributes,
        listeners,
        handleRef: setActivatorNodeRef,
        dragging: isDragging,
      })}
    </div>
  );
}
