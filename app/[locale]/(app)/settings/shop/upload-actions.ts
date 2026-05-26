'use server';

import { randomUUID } from 'node:crypto';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentShopId, requireRoleInCurrentShop, requireShopMember } from '@/lib/auth/server';
import { err, ok, type Result } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import { captureException } from '@/lib/observability';

/**
 * Loop 43 (Phase 120 from AUDIT_PHASE70) — server-side image upload.
 *
 * Path convention: `shops/<shop_id>/<purpose>/<uuid>.<ext>` so the
 * RLS write policy (set by `20260526040000_storage_shop_assets.sql`)
 * can prefix-match the caller's shop_id against the second segment
 * and block cross-shop writes even if a hand-crafted client tried.
 *
 * Why this isn't a `withAction({schema})` flow: we accept a
 * FormData rather than a Zod-validated payload — multipart upload
 * is what `<input type=file>` produces. Auth is enforced inline.
 *
 * V1 surfaces: shop logo (email branding). V1.1: barber avatars.
 * V1.5: service photos. The `purpose` discriminator stays open so
 * we don't need a migration per surface.
 */

// Loop 43 self-review — SVG dropped from the whitelist. The format
// can carry inline `<script>` or `<foreignObject>` payloads, so
// publicly serving an arbitrary owner-uploaded SVG is a self-XSS
// vector if any consumer (calendar preview, future widget, email
// client that does render SVG) treats it as inline markup. PNG /
// JPEG / WebP cover every real-world logo case. A future loop can
// re-enable SVG once we wire DOMPurify or a server-side sanitizer.
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB — the bucket caps at 5 MB
// for raw safety, but the server action returns INVALID_INPUT at 2
// MB so the upload doesn't waste bandwidth on rejected files.

type UploadResult = { url: string; path: string };

export async function uploadShopAsset(formData: FormData): Promise<Result<UploadResult>> {
  try {
    // Auth: manager+ for shop logo (changing shop branding). Lower
    // roles can use the helper for future surfaces by passing a
    // different `purpose` once we lock that down — for V1 we enforce
    // manager+ uniformly.
    const { user } = await requireShopMember();
    await requireRoleInCurrentShop('manager');
    if (!user) return err('UNAUTHENTICATED');

    const file = formData.get('file');
    const purpose = formData.get('purpose');
    if (!(file instanceof File)) return err('INVALID_INPUT', { field: 'file' });
    if (typeof purpose !== 'string' || !/^[a-z][a-z0-9_-]{0,30}$/.test(purpose)) {
      return err('INVALID_INPUT', { field: 'purpose' });
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return err('INVALID_INPUT', { field: 'file', reason: 'mime' });
    }
    if (file.size > MAX_BYTES) {
      return err('INVALID_INPUT', { field: 'file', reason: 'size' });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServerClient() as any;
    const shopId = await getCurrentShopId();
    if (!shopId) return err('FORBIDDEN');

    // Build path. UUID basename avoids collisions when re-uploading
    // and gives us a cheap content-addressed-ish naming so the same
    // logo uploaded twice doesn't overwrite (audit_log captures the
    // path each time).
    const ext = extensionFor(file.type);
    const filename = `${randomUUID()}.${ext}`;
    const path = `shops/${shopId}/${purpose}/${filename}`;

    // Upload via Supabase Storage. The RLS policy `shop-assets
    // shop-member write` runs against the caller's JWT and validates
    // the second path segment matches their shop_id.
    const { error: uploadError } = await sb.storage.from('shop-assets').upload(path, file, {
      contentType: file.type,
      upsert: false,
      cacheControl: '31536000, immutable',
    });
    if (uploadError) {
      captureException(uploadError, {
        tags: { layer: 'storage', purpose },
        extra: { path },
      });
      return err('UNEXPECTED');
    }

    // Resolve the public URL via Storage's helper rather than
    // building it by hand. The URL format is stable but going
    // through the SDK insulates us from future Supabase changes.
    const {
      data: { publicUrl },
    } = sb.storage.from('shop-assets').getPublicUrl(path);

    await logAuditAction({
      shopId,
      actorId: user.id,
      action: 'insert',
      entity: 'storage:shop-assets',
      entityId: path,
      diff: { purpose, mime: file.type, size_bytes: file.size },
    });

    return ok({ url: publicUrl as string, path });
  } catch (e) {
    captureException(e, { tags: { layer: 'storage', action: 'uploadShopAsset' } });
    return err('UNEXPECTED');
  }
}

function extensionFor(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    default:
      // Loop 43 self-review — the whitelist above rejects everything
      // else, so this branch is unreachable. Kept for type safety;
      // the `bin` placeholder is intentionally non-renderable so a
      // bypass attempt that lands here writes a dead file.
      return 'bin';
  }
}
