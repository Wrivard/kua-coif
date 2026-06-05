'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import type { ServiceCategoryRow, ServiceRow } from '@/db/rows';
import {
  createServiceCategory,
  deleteServiceCategory,
  renameServiceCategory,
} from './actions';

type Props = {
  categories: ServiceCategoryRow[];
  services: ServiceRow[];
  onClose: () => void;
};

/**
 * Service category management — list / add / rename / delete. Mirrors the
 * product taxonomy modal but adds an inline rename row and a delete guard:
 * the server returns CONFLICT when a category still has services, surfaced
 * here as a danger toast.
 */
export function CategoryManagementModal({ categories, services, onClose }: Props) {
  const t = useTranslations('pages.services.categories');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  const [newName, setNewName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<ServiceCategoryRow | null>(null);

  // Count of services per category so the UI can show why a delete is blocked.
  const countByCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of services) {
      if (!s.category_id) continue;
      m.set(s.category_id, (m.get(s.category_id) ?? 0) + 1);
    }
    return m;
  }, [services]);

  function onAdd() {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      const result = await createServiceCategory({ name });
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.created') });
        setNewName('');
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  function onRename() {
    const name = editName.trim();
    if (!editId || !name) return;
    startTransition(async () => {
      const result = await renameServiceCategory({ id: editId, name });
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.renamed') });
        setEditId(null);
        setEditName('');
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  function onDelete(category: ServiceCategoryRow) {
    startTransition(async () => {
      const result = await deleteServiceCategory({ id: category.id });
      setConfirmDelete(null);
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.deleted', { name: category.name }) });
      } else if (result.errorCode === 'CONFLICT') {
        show({ variant: 'danger', title: t('toasts.deleteBlocked', { name: category.name }) });
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={t('title')}
        description={t('description')}
        size="md"
        footer={
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            {tCommon('actions.close')}
          </Button>
        }
      >
        {/* Add row */}
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              aria-label={t('addLabel')}
              placeholder={t('addPlaceholder')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onAdd();
                }
              }}
            />
          </div>
          <Button onClick={onAdd} disabled={isPending || newName.trim().length === 0} size="md">
            <Plus className="h-4 w-4" /> {tCommon('actions.add')}
          </Button>
        </div>

        {/* List */}
        <ul className="mt-4 divide-y divide-border-soft rounded-lg bg-bg-surface shadow-sm">
          {categories.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-text-muted">{t('empty')}</li>
          ) : (
            categories.map((category) => {
              const count = countByCategory.get(category.id) ?? 0;
              const isEditing = editId === category.id;
              return (
                <li key={category.id} className="flex items-center gap-2 px-3 py-2.5">
                  {isEditing ? (
                    <>
                      <Input
                        aria-label={t('renameLabel')}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            onRename();
                          } else if (e.key === 'Escape') {
                            setEditId(null);
                          }
                        }}
                        className="flex-1"
                      />
                      <button
                        type="button"
                        aria-label={tCommon('actions.save')}
                        onClick={onRename}
                        disabled={isPending || editName.trim().length === 0}
                        className="rounded-md p-1.5 text-text-muted transition-colors duration-150 ease-out-quint hover:bg-bg-surface-2 hover:text-success focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={tCommon('actions.cancel')}
                        onClick={() => setEditId(null)}
                        className="rounded-md p-1.5 text-text-muted transition-colors duration-150 ease-out-quint hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 truncate text-sm font-medium text-text-primary">
                        {category.name}
                      </span>
                      <span className="shrink-0 text-xs text-text-muted">
                        {t('serviceCount', { count })}
                      </span>
                      <button
                        type="button"
                        aria-label={tCommon('actions.edit')}
                        onClick={() => {
                          setEditId(category.id);
                          setEditName(category.name);
                        }}
                        className="rounded-md p-1.5 text-text-muted transition-colors duration-150 ease-out-quint hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={tCommon('actions.delete')}
                        onClick={() => setConfirmDelete(category)}
                        className="rounded-md p-1.5 text-text-muted transition-colors duration-150 ease-out-quint hover:bg-bg-surface-2 hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </li>
              );
            })
          )}
        </ul>
      </Modal>

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
