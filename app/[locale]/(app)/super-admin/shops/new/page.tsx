import { requireKuaAdmin } from '@/lib/auth/server';
import { CreateShopForm } from './create-shop-form';

export const dynamic = 'force-dynamic';

export default async function NewShopPage() {
  await requireKuaAdmin();
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold">Create a shop</h1>
      <p className="mb-6 text-sm text-text-secondary">
        Adds the shop to the platform and emails an invitation to the owner. The owner sets their
        password on first click and lands in their dashboard with the membership marked
        &laquo;&nbsp;confirmed&nbsp;&raquo;.
      </p>
      <CreateShopForm />
    </>
  );
}
