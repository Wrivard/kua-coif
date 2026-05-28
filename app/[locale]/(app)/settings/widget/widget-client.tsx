'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useForm, useWatch, Controller, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import { widgetConfigSchema, type WidgetConfig } from '@/lib/business/widget-config';
import { upsertWidgetConfig } from './actions';

type Props = {
  locale: string;
  shopName: string;
  shopAlias: string | null;
  initial: WidgetConfig;
};

export function WidgetClient({ locale, shopName, shopAlias, initial }: Props) {
  const t = useTranslations('pages.settings.widget');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  // The preview iframe URL changes whenever we save (cache-buster `?v=`),
  // forcing a full reload of the embed page. Between saves, the iframe
  // updates LIVE via postMessage → PreviewListener (Loop 66) so the
  // operator sees theme/accent/font/radius changes the moment they edit
  // the form.
  const [previewVersion, setPreviewVersion] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Normalize the `allowed_origins` array ↔ multiline textarea representation.
  // RHF doesn't natively handle "array → string → array", so we keep a local
  // textarea state and reconcile it on submit.
  const [originsText, setOriginsText] = useState(initial.allowed_origins.join('\n'));
  const [copied, setCopied] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    control,
    formState: { errors },
  } = useForm<WidgetConfig>({
    // The schema declares zod `.default(...)` on most fields, which makes the
    // inferred **input** type wider (optionals) than the **output** type that
    // `useForm<WidgetConfig>` expects. The resolver runs the schema at runtime
    // and produces values that DO satisfy `WidgetConfig`, so the cast is safe.
    resolver: zodResolver(widgetConfigSchema) as unknown as Resolver<WidgetConfig>,
    defaultValues: initial,
  });

  // ── Preview URL ────────────────────────────────────────────────────────
  // We point the preview iframe at the LIVE embed route (same origin → CSP
  // allows it). After Save the cache-buster forces a refetch so the new
  // config is applied. `?preview=1` opts the embed page into mounting
  // the PreviewListener (Loop 66) so postMessage updates take effect.
  // The form's `default_locale` field is always populated (zod default), so
  // `watch` returns a non-empty value once the form mounts. We fall back to
  // the page locale during the very first render only.
  const watchedLocale = watch('default_locale');
  const previewUrl = useMemo(() => {
    if (!shopAlias) return null;
    const previewLocale = watchedLocale || (locale === 'en' ? 'en' : 'fr');
    return `/${previewLocale}/embed/${encodeURIComponent(shopAlias)}?preview=1&v=${previewVersion}`;
    // We don't include the form values in this URL — initial paint reflects
    // what is saved in the DB; live edits arrive via postMessage. That
    // keeps "saved state" and "preview state" distinguishable.
  }, [shopAlias, locale, previewVersion, watchedLocale]);

  // ── Live preview broadcast (Loop 66) ──────────────────────────────────
  // Subscribe to every field via useWatch (re-renders on each change),
  // debounce 200ms, then postMessage the current config to the iframe.
  // The PreviewListener inside the embed page applies it to the DOM.
  //
  // 200ms matches the typical typing-debounce sweet spot — fast enough
  // to feel live, slow enough to coalesce a flurry of color-picker
  // changes into one paint. Each post is cheap (same-origin, no
  // serialization beyond the structured-clone overhead).
  const liveConfig = useWatch({ control }) as WidgetConfig;
  // Keep a stable ref to the latest config so the `ready` listener
  // below can read it without becoming a dep (which would re-subscribe
  // the listener on every keystroke).
  const liveConfigRef = useRef(liveConfig);
  liveConfigRef.current = liveConfig;

  useEffect(() => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    const timer = setTimeout(() => {
      target.postMessage(
        { type: 'kua-widget-preview', config: liveConfig },
        window.location.origin,
      );
    }, 200);
    return () => clearTimeout(timer);
    // useWatch returns a NEW object reference each render so this effect
    // fires once per change. JSON.stringify dep would also work but
    // would re-iterate the same object every render.
  }, [liveConfig]);

  // Loop 66 SR — listen for the iframe's `ready` ping. The iframe sends
  // it once on PreviewListener mount, which may land AFTER the first
  // 200ms debounced broadcast above (if hydration is slow). Without
  // this immediate-rebroadcast, the operator would see a brief lag
  // on their first edit. Subsequent edits debounce normally.
  useEffect(() => {
    function onReady(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: unknown } | undefined;
      if (!data || data.type !== 'kua-widget-preview-ready') return;
      const target = iframeRef.current?.contentWindow;
      if (!target) return;
      target.postMessage(
        { type: 'kua-widget-preview', config: liveConfigRef.current },
        window.location.origin,
      );
    }
    window.addEventListener('message', onReady);
    return () => window.removeEventListener('message', onReady);
  }, []);

  // ── Snippet for copy ───────────────────────────────────────────────────
  const snippet = useMemo(() => {
    if (!shopAlias) return '';
    const origin =
      typeof window !== 'undefined' ? window.location.origin : 'https://kua-coif.vercel.app';
    return [
      `<div data-kua-widget="${shopAlias}" data-kua-locale="${initial.default_locale}"></div>`,
      `<script src="${origin}/widget.js" async></script>`,
    ].join('\n');
  }, [shopAlias, initial.default_locale]);

  function copySnippet() {
    if (!snippet) return;
    navigator.clipboard
      .writeText(snippet)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => show({ variant: 'danger', title: t('toasts.copyFailed') }));
  }

  function onSubmit(values: WidgetConfig) {
    // Parse the textarea back to an array of trimmed, non-empty origins.
    const origins = originsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const payload: WidgetConfig = { ...values, allowed_origins: origins };

    startTransition(async () => {
      const result = await upsertWidgetConfig(payload);
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.saved') });
        setPreviewVersion((v) => v + 1); // refresh preview iframe
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={shopAlias ? t('subtitle', { alias: shopAlias }) : t('subtitleNoAlias')}
        actions={
          shopAlias ? (
            <a
              href={`/${locale}/embed/${shopAlias}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded border border-border bg-bg-surface px-3 py-2 text-xs font-medium text-text-primary hover:bg-bg-surface-2"
            >
              {t('openInTab')} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null
        }
      />

      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_minmax(360px,520px)]">
        {/* ── Form column ────────────────────────────────────────────── */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.identity')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div>
                <Label htmlFor="display_name">{t('fields.displayName')}</Label>
                <Input
                  id="display_name"
                  placeholder={shopName}
                  {...register('display_name')}
                  invalid={Boolean(errors.display_name)}
                />
                <p className="mt-1 text-xs text-text-muted">{t('fields.displayNameHint')}</p>
              </div>
              <Controller
                control={control}
                name="show_address"
                render={({ field }) => (
                  <Toggle
                    checked={field.value}
                    onChange={field.onChange}
                    label={t('fields.showAddress')}
                  />
                )}
              />
              <Controller
                control={control}
                name="show_phone"
                render={({ field }) => (
                  <Toggle
                    checked={field.value}
                    onChange={field.onChange}
                    label={t('fields.showPhone')}
                  />
                )}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('sections.theme')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div>
                  <Label htmlFor="mode">{t('fields.mode')}</Label>
                  {/* Loop 65 — light + auto unlocked. The embed page
                   *  now forces `data-theme` from this value via an
                   *  inline script, so all three modes work
                   *  end-to-end. `auto` defers to the customer's OS
                   *  `prefers-color-scheme`. */}
                  <Select id="mode" {...register('mode')}>
                    <option value="dark">{t('options.modeDark')}</option>
                    <option value="light">{t('options.modeLight')}</option>
                    <option value="auto">{t('options.modeAuto')}</option>
                  </Select>
                  <p className="mt-1 text-xs text-text-muted">{t('fields.modeHint')}</p>
                </div>
                <div>
                  <Label htmlFor="accent_color">{t('fields.accentColor')}</Label>
                  <Input
                    id="accent_color"
                    type="text"
                    placeholder="#8b5cf6"
                    {...register('accent_color')}
                    invalid={Boolean(errors.accent_color)}
                  />
                  {errors.accent_color ? (
                    <p className="mt-1 text-xs text-danger">{t('errors.accentColor')}</p>
                  ) : (
                    <p className="mt-1 text-xs text-text-muted">{t('fields.accentColorHint')}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="font_family">{t('fields.font')}</Label>
                  <Select id="font_family" {...register('font_family')}>
                    <option value="system">System</option>
                    <option value="geist">Geist</option>
                    <option value="inter">Inter</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="border_radius">{t('fields.borderRadius')}</Label>
                  <Select id="border_radius" {...register('border_radius')}>
                    <option value="sharp">{t('options.radiusSharp')}</option>
                    <option value="rounded">{t('options.radiusRounded')}</option>
                    <option value="pill">{t('options.radiusPill')}</option>
                  </Select>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('sections.steps')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <Controller
                control={control}
                name="show_professional_first"
                render={({ field }) => (
                  <Toggle
                    checked={field.value}
                    onChange={field.onChange}
                    label={t('fields.proFirst')}
                  />
                )}
              />
              <Controller
                control={control}
                name="allow_multi_service"
                render={({ field }) => (
                  <Toggle
                    checked={field.value}
                    onChange={field.onChange}
                    label={t('fields.multiService')}
                  />
                )}
              />
              <Controller
                control={control}
                name="show_tip_step"
                render={({ field }) => (
                  <Toggle
                    checked={field.value}
                    onChange={field.onChange}
                    label={t('fields.tipStep')}
                    disabled
                  />
                )}
              />
              <Controller
                control={control}
                name="show_promo_code"
                render={({ field }) => (
                  <Toggle
                    checked={field.value}
                    onChange={field.onChange}
                    label={t('fields.promoCode')}
                    disabled
                  />
                )}
              />
              <p className="text-xs text-text-muted">{t('fields.stepsHint')}</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('sections.behavior')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div>
                <Label htmlFor="default_locale">{t('fields.defaultLocale')}</Label>
                <Select id="default_locale" className="max-w-xs" {...register('default_locale')}>
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="allowed_origins">{t('fields.allowedOrigins')}</Label>
                <Textarea
                  id="allowed_origins"
                  rows={3}
                  placeholder="https://salon-example.com&#10;https://*.example.com"
                  value={originsText}
                  onChange={(e) => setOriginsText(e.target.value)}
                />
                <p className="mt-1 text-xs text-text-muted">{t('fields.allowedOriginsHint')}</p>
              </div>
            </CardBody>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" loading={isPending}>
              {tCommon('actions.save')}
            </Button>
          </div>
        </form>

        {/* ── Preview + snippet column ──────────────────────────────── */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.snippet')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <p className="text-xs text-text-muted">{t('snippet.instructions')}</p>
              <pre className="overflow-x-auto rounded border border-border bg-bg-base p-3 text-[11px] leading-relaxed text-text-secondary">
                {snippet || t('snippet.noAlias')}
              </pre>
              <Button
                type="button"
                variant="secondary"
                onClick={copySnippet}
                disabled={!snippet}
                className="w-full"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" /> {t('snippet.copied')}
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" /> {t('snippet.copy')}
                  </>
                )}
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('sections.preview')}</CardTitle>
            </CardHeader>
            <CardBody>
              {previewUrl ? (
                <iframe
                  ref={iframeRef}
                  key={previewVersion}
                  src={previewUrl}
                  title="Widget preview"
                  className="h-[640px] w-full rounded border border-border bg-bg-base"
                />
              ) : (
                <p className="text-sm text-text-muted">{t('preview.noAlias')}</p>
              )}
              <p className="mt-2 text-xs text-text-muted">{t('preview.note')}</p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
