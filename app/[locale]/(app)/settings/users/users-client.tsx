'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Mail, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { FieldHint, Input, Label } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { SHOP_MEMBER_STATUSES, USER_ROLES, type ShopMemberStatus, type UserRole } from '@/db/enums';
import { inviteUser, removeMember, updateMember } from './actions';
import { inviteUserSchema, type InviteUserInput } from './schema';

export type MemberView = {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  status: ShopMemberStatus;
  created_at: string;
};

type Mode = { kind: 'closed' } | { kind: 'invite' } | { kind: 'edit'; member: MemberView };

export function UsersClient({ members }: { members: MemberView[] }) {
  const t = useTranslations('pages.settings.users');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [mode, setMode] = useState<Mode>({ kind: 'closed' });
  const [confirmRemove, setConfirmRemove] = useState<MemberView | null>(null);
  const [isPending, startTransition] = useTransition();

  function onRemove(m: MemberView) {
    startTransition(async () => {
      const result = await removeMember({ member_id: m.id });
      setConfirmRemove(null);
      if (result.ok) show({ variant: 'success', title: t('toasts.removed') });
      else show({ variant: 'danger', title: tErr(result.errorCode) });
    });
  }

  const columns: ReadonlyArray<ColumnDef<MemberView>> = [
    {
      id: 'user',
      header: t('columns.user'),
      cell: (m) => (
        <div>
          <p className="font-medium text-text-primary">{m.full_name ?? m.email}</p>
          {m.full_name ? <p className="text-xs text-text-muted">{m.email}</p> : null}
        </div>
      ),
      sortable: true,
      sortValue: (m) => (m.full_name ?? m.email).toLowerCase(),
    },
    {
      id: 'role',
      header: t('columns.role'),
      cell: (m) => (
        <Badge variant={m.role === 'owner' ? 'accent' : 'default'}>{t(`roles.${m.role}`)}</Badge>
      ),
      width: '120px',
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (m) => (
        <Badge
          variant={
            m.status === 'confirmed' ? 'success' : m.status === 'deleted' ? 'danger' : 'default'
          }
        >
          {t(`statuses.${m.status}`)}
        </Badge>
      ),
      width: '130px',
    },
    {
      id: 'actions',
      header: '',
      width: '90px',
      align: 'right',
      cell: (m) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            aria-label={tCommon('actions.edit')}
            onClick={(e) => {
              e.stopPropagation();
              setMode({ kind: 'edit', member: m });
            }}
            className="rounded p-1 text-text-muted hover:bg-bg-surface-2 hover:text-text-primary"
          >
            <Pencil className="h-4 w-4" />
          </button>
          {m.status !== 'deleted' && (
            <button
              type="button"
              aria-label={t('remove')}
              onClick={(e) => {
                e.stopPropagation();
                setConfirmRemove(m);
              }}
              className="rounded p-1 text-text-muted hover:bg-bg-surface-2 hover:text-danger"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          <Button onClick={() => setMode({ kind: 'invite' })} size="sm">
            <Plus className="h-4 w-4" /> {t('inviteUser')}
          </Button>
        }
      />

      <div className="p-6">
        <DataTable
          columns={columns}
          data={members}
          getRowKey={(m) => m.id}
          emptyState={{ title: t('emptyTitle'), description: t('emptyHint') }}
        />
      </div>

      {mode.kind === 'invite' && <InviteModal onClose={() => setMode({ kind: 'closed' })} />}
      {mode.kind === 'edit' && (
        <EditMemberModal member={mode.member} onClose={() => setMode({ kind: 'closed' })} />
      )}

      <ConfirmDialog
        open={confirmRemove !== null}
        title={t('confirmRemove.title')}
        description={
          confirmRemove
            ? t('confirmRemove.description', {
                name: confirmRemove.full_name ?? confirmRemove.email,
              })
            : ''
        }
        destructive
        loading={isPending}
        confirmLabel={t('remove')}
        cancelLabel={tCommon('actions.cancel')}
        onConfirm={() => confirmRemove && onRemove(confirmRemove)}
        onCancel={() => setConfirmRemove(null)}
      />
    </>
  );
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations('pages.settings.users');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<InviteUserInput>({
    resolver: zodResolver(inviteUserSchema),
    defaultValues: { email: '', role: 'barber' },
  });

  function onSubmit(values: InviteUserInput) {
    startTransition(async () => {
      const result = await inviteUser(values);
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.invited') });
        onClose();
      } else if (result.errorCode === 'NOT_FOUND') {
        // No profile with that email yet — V1 limitation.
        show({
          variant: 'warning',
          title: t('toasts.invitePending'),
          description: t('toasts.invitePendingHint'),
        });
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('inviteModal.title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            {tCommon('actions.cancel')}
          </Button>
          <Button onClick={handleSubmit(onSubmit)} loading={isPending}>
            <Mail className="h-4 w-4" /> {t('inviteModal.send')}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div>
          <Label htmlFor="email" required>
            {t('inviteModal.email')}
          </Label>
          <Input id="email" type="email" invalid={Boolean(errors.email)} {...register('email')} />
          {errors.email ? (
            <FieldHint error>{tErr('field.email' as 'field.NAME_REQUIRED')}</FieldHint>
          ) : null}
        </div>
        <div>
          <Label htmlFor="role">{t('inviteModal.role')}</Label>
          <Select id="role" {...register('role')}>
            {USER_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </Select>
        </div>
        <p className="text-xs text-text-muted">{t('inviteModal.v1Note')}</p>
      </form>
    </Modal>
  );
}

function EditMemberModal({ member, onClose }: { member: MemberView; onClose: () => void }) {
  const t = useTranslations('pages.settings.users');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  const [role, setRole] = useState<UserRole>(member.role);
  const [status, setStatus] = useState<ShopMemberStatus>(member.status);

  function onSubmit() {
    startTransition(async () => {
      const result = await updateMember({ member_id: member.id, role, status });
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.updated') });
        onClose();
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('editModal.title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            {tCommon('actions.cancel')}
          </Button>
          <Button onClick={onSubmit} loading={isPending}>
            {tCommon('actions.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-text-muted">{t('columns.user')}</p>
          <p className="font-medium">{member.full_name ?? member.email}</p>
          {member.full_name ? <p className="text-xs text-text-muted">{member.email}</p> : null}
        </div>
        <div>
          <Label htmlFor="role">{t('editModal.role')}</Label>
          <Select id="role" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {USER_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="status">{t('editModal.status')}</Label>
          <Select
            id="status"
            value={status}
            onChange={(e) => setStatus(e.target.value as ShopMemberStatus)}
          >
            {SHOP_MEMBER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </Modal>
  );
}
