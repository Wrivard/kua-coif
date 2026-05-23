/**
 * Placeholder Supabase Database type.
 *
 * The migrations under `supabase/migrations/` define the real schema (26 tables
 * + enums). Once those migrations are applied to a Postgres instance (local or
 * cloud), regenerate this file:
 *
 *   npm run db:types:local    # local Docker instance (supabase start)
 *   npm run db:types:remote   # linked cloud project (supabase link first)
 *
 * Until then we expose an empty shape so the Supabase clients (lib/supabase/*)
 * keep compiling, and we declare every enum manually in `db/enums.ts` so the
 * app code can already type-check against the schema.
 */
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
