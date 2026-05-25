import { redirect } from 'next/navigation';

// /admin → /admin/shops (the only section that ships in Phase 22). Future
// sections (billing, support tickets, feature flags) land as siblings.
export default function AdminIndex() {
  redirect('/admin/shops');
}
