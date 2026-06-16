'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Download, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { EmptyCell } from '@/components/ui/empty-cell';
import { PageHeader } from '@/components/ui/page-header';
import { RowActions } from '@/components/ui/row-actions';
import { SearchBar } from '@/components/ui/search-bar';
import { SectionSwitcher } from '@/components/ui/section-switcher';
import { useToast } from '@/components/ui/toast';
import { formatCurrencyCAD } from '@/lib/utils';
import type { ProductBrandRow, ProductCategoryRow, ProductRow, TaxRow } from '@/db/rows';
import { ProductFormModal } from './product-form-modal';
import { BrandFormModal, CategoryFormModal } from './taxonomy-form-modals';
import { deleteBrand, deleteCategory, deleteProduct, toggleProductStatus } from './actions';

type View = 'products' | 'brands' | 'categories';

type ProductMode = { kind: 'closed' } | { kind: 'add' } | { kind: 'edit'; product: ProductRow };
type BrandMode = { kind: 'closed' } | { kind: 'add' } | { kind: 'edit'; brand: ProductBrandRow };
type CategoryMode =
  | { kind: 'closed' }
  | { kind: 'add' }
  | { kind: 'edit'; category: ProductCategoryRow };

export function ProductsClient({
  locale,
  products,
  brands,
  categories,
  taxes,
  links,
}: {
  locale: string;
  products: ProductRow[];
  brands: ProductBrandRow[];
  categories: ProductCategoryRow[];
  taxes: TaxRow[];
  links: Array<{ product_id: string; tax_id: string }>;
}) {
  const t = useTranslations('pages.products');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();

  const [view, setView] = useState<View>('products');
  const [productMode, setProductMode] = useState<ProductMode>({ kind: 'closed' });
  const [brandMode, setBrandMode] = useState<BrandMode>({ kind: 'closed' });
  const [categoryMode, setCategoryMode] = useState<CategoryMode>({ kind: 'closed' });

  type AnyRow = {
    kind: 'product' | 'brand' | 'category';
    row: ProductRow | ProductBrandRow | ProductCategoryRow;
  };
  const [confirmDelete, setConfirmDelete] = useState<AnyRow | null>(null);
  const [isPending, startTransition] = useTransition();
  // Client-side product search (name / sku / brand / category) — same pattern
  // as the Clients roster. Brands+categories are a handful of rows so we don't
  // search them; the products table is the only one that grows.
  const [search, setSearch] = useState('');

  const brandById = useMemo(() => new Map(brands.map((b) => [b.id, b])), [brands]);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const taxById = useMemo(() => new Map(taxes.map((x) => [x.id, x])), [taxes]);
  const taxIdsByProduct = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of links) {
      const list = m.get(l.product_id) ?? [];
      list.push(l.tax_id);
      m.set(l.product_id, list);
    }
    return m;
  }, [links]);

  // Filtered view for the products table. The haystack folds in the resolved
  // brand + category NAMES (not ids) so a search for "AURA" or "AFRO" matches.
  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      const brand = brandById.get(p.brand_id ?? '')?.name ?? '';
      const category = categoryById.get(p.category_id ?? '')?.name ?? '';
      const hay = `${p.name} ${p.sku ?? ''} ${brand} ${category}`.toLowerCase();
      return hay.includes(q);
    });
  }, [products, search, brandById, categoryById]);

  // Retail / wholesale rollups shown next to the toolbar (annexe Image 11).
  const retailValue = products.reduce((sum, p) => sum + p.price * p.current_inventory, 0);
  const wholesaleValue = products.reduce((sum, p) => sum + p.supply_price * p.current_inventory, 0);
  const lowInventoryCount = products.filter(
    (p) => p.current_inventory <= p.low_inventory_threshold,
  ).length;

  // W2b — soft enable/disable, mirroring services. Pass the explicit next status
  // (not a blind flip) so a stale client view can't race the toggle.
  function onToggleStatus(p: ProductRow) {
    startTransition(async () => {
      const next = p.status === 'enabled' ? 'disabled' : 'enabled';
      const result = await toggleProductStatus({ id: p.id, status: next });
      if (result.ok) {
        show({ variant: 'info', title: t('toasts.statusFlipped', { name: p.name }) });
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  function isLowStock(p: ProductRow) {
    return p.current_inventory <= p.low_inventory_threshold;
  }
  function isNegativeMargin(p: ProductRow) {
    return p.supply_price > p.price;
  }

  function runConfirmDelete() {
    if (!confirmDelete) return;
    startTransition(async () => {
      const r = confirmDelete;
      const result =
        r.kind === 'product'
          ? await deleteProduct({ id: r.row.id })
          : r.kind === 'brand'
            ? await deleteBrand({ id: r.row.id })
            : await deleteCategory({ id: r.row.id });
      setConfirmDelete(null);
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.deleted') });
      } else if (result.errorCode === 'CONFLICT' && (r.kind === 'brand' || r.kind === 'category')) {
        // W1 (Kai) makes deleteBrand/deleteCategory return CONFLICT when
        // products still reference them. Guide the manager to the fix instead
        // of the generic "reload and retry".
        show({
          variant: 'danger',
          title: t(r.kind === 'brand' ? 'conflicts.brandInUse' : 'conflicts.categoryInUse'),
        });
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  // ─── Columns: Products ──────────────────────────────────────────────────
  const productColumns: ReadonlyArray<ColumnDef<ProductRow>> = [
    {
      id: 'name',
      header: t('columns.name'),
      // W2b — a disabled product reads as muted (the status badge column is the
      // primary cue; this dims the row's anchor text for an at-a-glance signal).
      cell: (r) => (
        <span
          className={`flex items-center gap-2 font-medium ${
            r.status === 'disabled' ? 'text-text-muted' : ''
          }`}
        >
          {r.name}
          {isNegativeMargin(r) ? (
            <Badge variant="warning" title={t('warnings.negativeMargin')}>
              <AlertTriangle className="h-3 w-3" />
            </Badge>
          ) : null}
        </span>
      ),
      sortable: true,
      sortValue: (r) => r.name.toLowerCase(),
    },
    {
      id: 'price',
      header: t('columns.price'),
      cell: (r) => formatCurrencyCAD(r.price, locale === 'fr' ? 'fr' : 'en'),
      sortable: true,
      sortValue: (r) => r.price,
      align: 'right',
      width: '110px',
    },
    {
      id: 'supply',
      header: t('columns.supplyPrice'),
      cell: (r) => (
        <span className={isNegativeMargin(r) ? 'text-warning' : undefined}>
          {formatCurrencyCAD(r.supply_price, locale === 'fr' ? 'fr' : 'en')}
        </span>
      ),
      sortable: true,
      sortValue: (r) => r.supply_price,
      align: 'right',
      width: '120px',
    },
    {
      id: 'inv',
      header: t('columns.inventory'),
      // WCAG 1.4.1 — low stock was signalled by colour ALONE. Pair it with the
      // same warning Badge + icon + accessible label used for negative margin
      // so it's perceivable without colour (and announced by screen readers).
      cell: (r) =>
        isLowStock(r) ? (
          <span className="flex items-center justify-end gap-1.5 font-semibold text-danger">
            {r.current_inventory}
            <Badge variant="warning" title={t('warnings.lowStock')}>
              <AlertTriangle className="h-3 w-3" aria-hidden />
              <span className="sr-only">{t('warnings.lowStock')}</span>
            </Badge>
          </span>
        ) : (
          r.current_inventory
        ),
      sortable: true,
      sortValue: (r) => r.current_inventory,
      align: 'right',
      width: '110px',
    },
    {
      id: 'lowInv',
      header: t('columns.lowInventory'),
      cell: (r) => r.low_inventory_threshold,
      align: 'right',
      width: '110px',
    },
    {
      id: 'sku',
      header: t('columns.sku'),
      cell: (r) => r.sku ?? <EmptyCell />,
    },
    {
      id: 'tax',
      header: t('columns.tax'),
      cell: (r) => {
        const ids = taxIdsByProduct.get(r.id) ?? [];
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
      },
    },
    {
      id: 'category',
      header: t('columns.category'),
      cell: (r) => categoryById.get(r.category_id ?? '')?.name ?? <EmptyCell />,
    },
    {
      id: 'brand',
      header: t('columns.brand'),
      cell: (r) => brandById.get(r.brand_id ?? '')?.name ?? <EmptyCell />,
    },
    {
      id: 'status',
      header: t('columns.status'),
      width: '110px',
      cell: (r) =>
        r.status === 'enabled' ? (
          <Badge variant="success">{t('status.enabled')}</Badge>
        ) : (
          <Badge>{t('status.disabled')}</Badge>
        ),
      sortable: true,
      sortValue: (r) => r.status,
    },
    {
      id: 'actions',
      header: '',
      width: '120px',
      align: 'right',
      cell: (r) => (
        <RowActions
          actions={[
            {
              icon: Pencil,
              label: tCommon('actions.edit'),
              onClick: () => setProductMode({ kind: 'edit', product: r }),
            },
            {
              icon: Power,
              label: r.status === 'enabled' ? t('actions.disable') : t('actions.enable'),
              onClick: () => onToggleStatus(r),
            },
            {
              icon: Trash2,
              label: tCommon('actions.delete'),
              tone: 'danger',
              onClick: () => setConfirmDelete({ kind: 'product', row: r }),
            },
          ]}
        />
      ),
    },
  ];

  // ─── Columns: Brands / Categories ───────────────────────────────────────
  const taxonomyColumns = (
    onEdit: (row: { id: string; name: string }) => void,
    onDelete: (row: { id: string; name: string }) => void,
  ): ReadonlyArray<ColumnDef<{ id: string; name: string }>> => [
    {
      id: 'name',
      header: t('columns.name'),
      cell: (r) => <span className="font-medium">{r.name}</span>,
      sortable: true,
      sortValue: (r) => r.name.toLowerCase(),
    },
    {
      id: 'actions',
      header: '',
      width: '90px',
      align: 'right',
      cell: (r) => (
        <RowActions
          actions={[
            { icon: Pencil, label: tCommon('actions.edit'), onClick: () => onEdit(r) },
            {
              icon: Trash2,
              label: tCommon('actions.delete'),
              tone: 'danger',
              onClick: () => onDelete(r),
            },
          ]}
        />
      ),
    },
  ];

  const addLabel =
    view === 'products' ? t('addProduct') : view === 'brands' ? t('addBrand') : t('addCategory');

  function handleAdd() {
    if (view === 'products') setProductMode({ kind: 'add' });
    if (view === 'brands') setBrandMode({ kind: 'add' });
    if (view === 'categories') setCategoryMode({ kind: 'add' });
  }

  return (
    <>
      {/* Phase H+7 UI pass — moved the products summary (retail /
          wholesale / low inv) out of the PageHeader subtitle and into a
          stat strip at the top of the body, freeing the header for the
          SectionSwitcher + Export + Add actions without title truncation
          under 1280px viewports. */}
      <PageHeader
        title={t('title')}
        center={
          view === 'products' ? (
            <SearchBar
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchPlaceholder')}
            />
          ) : undefined
        }
        actions={
          <>
            <a
              href={`/api/export/${view}`}
              className="inline-flex h-8 items-center gap-2 rounded-sm border border-border bg-bg-surface px-3 text-xs font-medium text-text-primary hover:bg-bg-surface-2"
            >
              <Download className="h-3.5 w-3.5" /> {tCommon('actions.export')}
            </a>
            <Button onClick={handleAdd} size="sm">
              <Plus className="h-4 w-4" /> {addLabel}
            </Button>
          </>
        }
        switcher={
          <SectionSwitcher
            trigger={t('view')}
            value={view}
            onChange={setView}
            options={[
              { value: 'products', label: t('viewLabels.products') },
              { value: 'brands', label: t('viewLabels.brands') },
              { value: 'categories', label: t('viewLabels.categories') },
            ]}
          />
        }
      />

      <div className="space-y-6 p-6">
        {view === 'products' ? (
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4" data-reveal>
            <div>
              <p className="type-eyebrow">{t('stats.retail')}</p>
              <p className="type-metric mt-1 text-display-lg text-text-primary">
                {formatCurrencyCAD(retailValue, locale === 'fr' ? 'fr' : 'en')}
              </p>
            </div>
            <div>
              <p className="type-eyebrow">{t('stats.wholesale')}</p>
              <p className="type-metric mt-1 text-display-sm text-text-secondary">
                {formatCurrencyCAD(wholesaleValue, locale === 'fr' ? 'fr' : 'en')}
              </p>
            </div>
            {lowInventoryCount > 0 ? (
              <div>
                <p className="type-eyebrow">{t('stats.lowInventory')}</p>
                <p className="type-metric mt-1 text-display-sm text-danger">{lowInventoryCount}</p>
              </div>
            ) : null}
          </div>
        ) : null}
        {view === 'products' && (
          <DataTable
            columns={productColumns}
            data={filteredProducts}
            getRowKey={(r) => r.id}
            virtualize
            emptyState={{
              title: t('emptyTitle'),
              description: t('emptyHint'),
              action: (
                <Button onClick={() => setProductMode({ kind: 'add' })} size="sm">
                  <Plus className="h-4 w-4" /> {t('addProduct')}
                </Button>
              ),
            }}
          />
        )}
        {view === 'brands' && (
          <DataTable
            columns={taxonomyColumns(
              (r) => setBrandMode({ kind: 'edit', brand: r as ProductBrandRow }),
              (r) => setConfirmDelete({ kind: 'brand', row: r as ProductBrandRow }),
            )}
            data={brands.map((b) => ({ id: b.id, name: b.name }))}
            getRowKey={(r) => r.id}
            emptyState={{ title: t('brands.emptyTitle'), description: t('brands.emptyHint') }}
          />
        )}
        {view === 'categories' && (
          <DataTable
            columns={taxonomyColumns(
              (r) => setCategoryMode({ kind: 'edit', category: r as ProductCategoryRow }),
              (r) => setConfirmDelete({ kind: 'category', row: r as ProductCategoryRow }),
            )}
            data={categories.map((c) => ({ id: c.id, name: c.name }))}
            getRowKey={(r) => r.id}
            emptyState={{
              title: t('categories.emptyTitle'),
              description: t('categories.emptyHint'),
            }}
          />
        )}
      </div>

      {productMode.kind !== 'closed' && (
        <ProductFormModal
          mode={productMode}
          brands={brands}
          categories={categories}
          taxes={taxes}
          existingTaxIds={
            productMode.kind === 'edit' ? (taxIdsByProduct.get(productMode.product.id) ?? []) : []
          }
          onClose={() => setProductMode({ kind: 'closed' })}
        />
      )}
      {brandMode.kind !== 'closed' && (
        <BrandFormModal mode={brandMode} onClose={() => setBrandMode({ kind: 'closed' })} />
      )}
      {categoryMode.kind !== 'closed' && (
        <CategoryFormModal
          mode={categoryMode}
          onClose={() => setCategoryMode({ kind: 'closed' })}
        />
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t('confirmDelete.title')}
        description={
          confirmDelete ? t('confirmDelete.description', { name: confirmDelete.row.name }) : ''
        }
        destructive
        loading={isPending}
        confirmLabel={tCommon('actions.delete')}
        cancelLabel={tCommon('actions.cancel')}
        onConfirm={runConfirmDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}
