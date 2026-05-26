'use client';

import { useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import { Loader2, Trash2, Upload } from 'lucide-react';
import { Button } from './button';
import { uploadShopAsset } from '@/app/[locale]/(app)/settings/shop/upload-actions';

/**
 * Loop 43 (Phase 120) — generic image upload field.
 *
 * Renders a 64×64 thumbnail when `value` is set, with a hover overlay
 * exposing replace + clear controls; empty state shows a dashed
 * dropzone-style button. Files go through the `uploadShopAsset`
 * server action (manager+ RBAC, 2 MB cap, image MIME whitelist) and
 * the resolved public URL is handed back to the parent via
 * `onChange`. The parent typically writes it to the corresponding
 * URL column on save (we don't write the URL ourselves — staying a
 * controlled component keeps the form-modal pattern intact).
 *
 * `purpose` becomes the third path segment in Storage, e.g.
 * `shops/<id>/logo/<uuid>.png`. Caller picks a slug that matches the
 * surface (`logo`, `avatar`, `service`).
 */
type Props = {
  value: string | null;
  onChange: (url: string | null) => void;
  /** Path segment in storage — keeps surfaces filed under
   *  `shops/<id>/<purpose>/...`. Slug-format only. */
  purpose: string;
  /** Override the visible size of the thumbnail (px). Default 64. */
  size?: number;
  /** Localized strings — caller passes pre-translated copy so the
   *  component stays a pure UI primitive. */
  labels: {
    upload: string;
    replace: string;
    remove: string;
    invalidType: string;
    tooLarge: string;
    failed: string;
  };
};

export function ImageUpload({ value, onChange, purpose, size = 64, labels }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function onPick() {
    inputRef.current?.click();
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    // Client-side guard mirrors the server-side whitelist (SVG
    // intentionally excluded — see upload-actions.ts comment on the
    // self-XSS rationale).
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setError(labels.invalidType);
      e.target.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError(labels.tooLarge);
      e.target.value = '';
      return;
    }
    const formData = new FormData();
    formData.set('file', file);
    formData.set('purpose', purpose);
    startTransition(async () => {
      const result = await uploadShopAsset(formData);
      if (result.ok) {
        onChange(result.data.url);
      } else {
        setError(labels.failed);
      }
      // Reset the input so picking the same file twice re-triggers
      // change (otherwise browsers debounce identical files).
      if (inputRef.current) inputRef.current.value = '';
    });
  }

  return (
    <div className="flex items-start gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={onFileChange}
        className="sr-only"
        aria-hidden
      />

      {value ? (
        <div
          className="relative shrink-0 overflow-hidden rounded-lg bg-bg-surface shadow-sm"
          style={{ width: size, height: size }}
        >
          <Image
            src={value}
            alt=""
            width={size}
            height={size}
            unoptimized
            className="h-full w-full object-cover"
          />
          {isPending ? (
            <div className="absolute inset-0 flex items-center justify-center bg-bg-overlay">
              <Loader2 className="h-4 w-4 animate-spin text-text-primary" aria-hidden />
            </div>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={onPick}
          disabled={isPending}
          className="flex shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-bg-surface text-[10px] font-medium text-text-muted transition-colors hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          style={{ width: size, height: size }}
          aria-label={labels.upload}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="h-4 w-4" aria-hidden />
          )}
        </button>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={onPick} disabled={isPending}>
            <Upload className="h-3.5 w-3.5" />
            {value ? labels.replace : labels.upload}
          </Button>
          {value ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                onChange(null);
                setError(null);
              }}
              disabled={isPending}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {labels.remove}
            </Button>
          ) : null}
        </div>
        {error ? <p className="text-[11px] text-danger">{error}</p> : null}
      </div>
    </div>
  );
}
