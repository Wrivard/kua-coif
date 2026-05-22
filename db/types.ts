// Placeholder Supabase Database type. Phase 2 will generate this from the
// real schema via `supabase gen types typescript`. Until then we expose an
// empty shape so the clients compile.
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
