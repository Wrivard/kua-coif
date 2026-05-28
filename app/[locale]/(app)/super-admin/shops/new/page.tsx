import { requireKuaAdmin } from '@/lib/auth/server';
import { PageHeader } from '@/components/ui/page-header';
import { SuperAdminNav } from '@/components/ui/super-admin-nav';
import { CreateShopForm } from './create-shop-form';

export const dynamic = 'force-dynamic';

export default async function NewShopPage() {
  await requireKuaAdmin();
  return (
    <>
      <PageHeader
        title="Create a shop"
        subtitle="Provisionne un nouveau salon + envoie l'invitation au owner"
      />
      <SuperAdminNav />
      <div className="max-w-3xl space-y-6 p-6">
        <p className="text-sm text-text-secondary">
          Adds the shop to the platform and emails an invitation to the owner. The owner sets their
          password on first click and lands in their dashboard with the membership marked
          &laquo;&nbsp;confirmed&nbsp;&raquo;.
        </p>
        <CreateShopForm />
      </div>
    </>
  );
}
