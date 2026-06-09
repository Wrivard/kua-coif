import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/db/types';

// @supabase/ssr@0.5.2's `createServerClient<Database>` return type is stale
// against the installed @supabase/supabase-js (2.106.2, the peer it actually
// runs on), which makes typed `.insert()/.update()` infer `never[]`. The
// runtime object IS a supabase-js SupabaseClient<Database>, so we re-assert
// the correct type here — a type-only fix, no runtime change — which restores
// write-time type safety to every caller without an SSR major upgrade.
export function createSupabaseServerClient(): SupabaseClient<Database> {
  const cookieStore = cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Called from a Server Component — cookie mutation isn't allowed there.
            // The middleware refresh flow handles session updates.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {
            // See get() comment above.
          }
        },
      },
    },
    // Double-assert: @supabase/ssr@0.5.2 declares the legacy 3-arg
    // SupabaseClient generic while the installed supabase-js (2.106.2) uses
    // the 4-arg one, so the structural types don't overlap. The runtime
    // object is a real supabase-js client (ssr calls the peer createClient),
    // so this only corrects the type — no behavior change.
  ) as unknown as SupabaseClient<Database>;
}
