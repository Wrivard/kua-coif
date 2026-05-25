'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Download, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { PageHeader } from '@/components/ui/page-header';
import { SectionSwitcher } from '@/components/ui/section-switcher';
import { useToast } from '@/components/ui/toast';
import { formatCurrencyCAD } from '@/lib/utils';
import type { ProductBrandRow, ProductCategoryRow, ProductRow, TaxRow } from '@/db/rows';
import { ProductFormModal } from './product-form-modal';
import { BrandFormModal, CategoryFormModal } from './taxonomy-form-modals';
import { deleteBrand, deleteCategory, deleteProduct } from './actions';

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

  // Retail / wholesale rollups shown next to the toolbar (annexe Image 11).
  const retailValue = products.reduce((sum, p) => sum + p.price * p.current_inventory, 0);
  const wholesaleValue = products.reduce((sum, p) => sum + p.supply_price * p.current_inventory, 0);
  const lowInventoryCount = products.filter(
    (p) => p.current_inventory <= p.low_inventory_threshold,
  ).length;

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
      cell: (r) => (
        <span className="flex items-center gap-2 font-medium">
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
      cell: (r) => (
        <span className={isLowStock(r) ? 'font-semibold text-danger' : undefined}>
          {r.current_inventory}
        </span>
      ),
      sortable: true,
      sortValue: (r) => r.current_inventory,
      align: 'right',
      width: '90px',
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
      cell: (r) => r.sku ?? <span className="text-text-muted">—</span>,
    },
    {
      id: 'tax',
      header: t('columns.tax'),
      cell: (r) => {
        const ids = taxIdsByProduct.get(r.id) ?? [];
        if (ids.length === 0) return <span className="text-text-muted">—</span>;
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
      cell: (r) =>
        categoryById.get(r.category_id ?? '')?.name ?? <span className="text-text-muted">—</span>,
    },
    {
      id: 'brand',
      header: t('columns.brand'),
      cell: (r) =>
        brandById.get(r.brand_id ?? '')?.name ?? <span className="text-text-muted">—</span>,
    },
    {
      id: 'actions',
      header: '',
      width: '90px',
      align: 'right',
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            aria-label={tCommon('actions.edit')}
            onClick={(e) => {
              e.stopPropagation();
              setProductMode({ kind: 'edit', product: r });
            }}
            className="rounded p-1 text-text-muted transition-colors hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={tCommon('actions.delete')}
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDelete({ kind: 'product', row: r });
            }}
            className="rounded p-1 text-text-muted transition-colors hover:bg-bg-surface-2 hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
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
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            aria-label={tCommon('actions.edit')}
            onClick={(e) => {
              e.stopPropagation();
              onEdit(r);
            }}
            className="rounded p-1 text-text-muted transition-colors hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={tCommon('actions.delete')}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(r);
            }}
            className="rounded p-1 text-text-muted transition-colors hover:bg-bg-surface-2 hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
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
      <PageHeader
        title={t('title')}
        subtitle={
          view === 'products'
            ? t('summary', {
                retail: formatCurrencyCAD(retailValue, locale === 'fr' ? 'fr' : 'en'),
                wholesale: formatCurrencyCAD(wholesaleValue, locale === 'fr' ? 'fr' : 'en'),
                low: lowInventoryCount,
              })
            : undefined
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

      <div className="p-6">
        {view === 'products' && (
          <DataTable
            columns={productColumns}
            data={products}
            getRowKey={(r) => r.id}
            emptyState={{ title: t('emptyTitle'), description: t('emptyHint') }}
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
