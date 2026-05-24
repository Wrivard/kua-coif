import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/db/types';

/**
 * Server-only Supabase client that uses the SERVICE_ROLE key.
 *
 * **Bypasses RLS entirely.** Only call from server modules that you have
 * carefully audited:
 *
 *  - Public booking flow (/book/[shopSlug]) — needs to read shop / hours /
 *    services / barbers when the visitor has no auth session.
 *  - Webhook handlers (none yet).
 *  - Migration / seed scripts.
 *
 * Never expose this client (or its key) to a Client Component, Route Handler
 * accessible without proper guards, or any package that ships JS to the
 * browser. We assert at construction time that the key isn't a public anon
 * key by checking the env var name.
 */
export function createSupabaseServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      '[supabase] SUPABASE_SERVICE_ROLE_KEY (or URL) is missing — service-role client unavailable.',
    );
  }
  return createClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
