import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { getClientIp } from '@/lib/security/client-ip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/widget/event
 *
 * Phase H+14 — public widget analytics ingestion. The booking wizard
 * (mounted in /embed/[shopSlug]) posts one row per impression / step
 * view / booking complete / abandon. The settings page rolls these up
 * into the conversion-funnel card.
 *
 * Anti-abuse:
 *   - Rate limit per IP (60/min — well above the 4-5 events a real
 *     booking generates).
 *   - shopSlug must resolve to a real shop_id (rejects forged inserts).
 *   - Zod-validated event_type / source / step_kind enums (the DB
 *     check constraints are the second line of defence).
 *
 * Returns 204 No Content on success — we don't echo the row back.
 */
const eventSchema = z.object({
  shopSlug: z.string().min(1).max(100),
  eventType: z.enum(['impression', 'step_view', 'booking_complete', 'abandon']),
  stepKind: z.enum(['service', 'barber', 'slot', 'contact', 'done']).optional(),
  sessionId: z.string().min(8).max(128),
  source: z.enum(['inline', 'floating-button', 'modal', 'direct']),
  meta: z.record(z.string(), z.unknown()).optional(),
});

// Plan 038 (PERF-02) — module-level alias→shop_id cache, mirroring the
// middleware's embed-config cache (middleware.ts): per-instance, 60s TTL,
// best-effort (cold starts drop it). A real booking fires 4-5 events in
// under a minute, so this collapses the per-event `shops` lookup to one
// round-trip per slug per instance per minute. Misses (null) are cached
// too so a forged slug can't force a query per event; the size guard
// keeps a slug-spammer from growing the map unbounded.
type AliasCacheEntry = { id: string | null; expiresAt: number };
const aliasCache = new Map<string, AliasCacheEntry>();
const ALIAS_CACHE_TTL_MS = 60_000;
const ALIAS_CACHE_MAX_ENTRIES = 1000;

async function resolveShopId(shopSlug: string): Promise<string | null> {
  const now = Date.now();
  const hit = aliasCache.get(shopSlug);
  if (hit && hit.expiresAt > now) return hit.id;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServiceRoleClient() as any;
  const shopRes = await supabase.from('shops').select('id').eq('alias', shopSlug).limit(1);
  const shop = ((shopRes.data as Array<{ id: string }> | null) ?? [])[0];
  const id = shop?.id ?? null;

  if (aliasCache.size >= ALIAS_CACHE_MAX_ENTRIES) aliasCache.clear();
  aliasCache.set(shopSlug, { id, expiresAt: now + ALIAS_CACHE_TTL_MS });
  return id;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rl = await checkRateLimit(`widget-event:${ip}`, { max: 60, windowMs: 60 * 1000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  }

  let parsed;
  try {
    const body = (await req.json()) as unknown;
    parsed = eventSchema.safeParse(body);
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_PAYLOAD' }, { status: 400 });
  }

  const { shopSlug, eventType, stepKind, sessionId, source, meta } = parsed.data;

  // Resolve shop_id from the alias (60s-cached). We DON'T accept shop_id
  // directly in the payload — that would let anyone scribble events against
  // any shop. The alias→id lookup is the security boundary.
  const shopId = await resolveShopId(shopSlug);
  if (!shopId) {
    // Silent 204 — don't leak "this slug doesn't exist" through the
    // analytics endpoint. Scrapers fingerprinting valid shops should
    // use a different surface.
    return new NextResponse(null, { status: 204 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServiceRoleClient() as any;

  // Best-effort write. A failed insert is logged but doesn't block
  // the wizard's UX (analytics is a side-channel, never on the
  // critical path).
  const { error } = await supabase.from('widget_events').insert({
    shop_id: shopId,
    event_type: eventType,
    step_kind: stepKind ?? null,
    session_id: sessionId,
    source,
    meta: meta ?? {},
  });
  if (error) {
    return NextResponse.json({ error: 'INSERT_FAILED' }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
