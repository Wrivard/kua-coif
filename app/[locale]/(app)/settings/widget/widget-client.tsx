'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useForm, useWatch, Controller, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  Loader2,
  Palette,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { widgetConfigSchema, type WidgetConfig } from '@/lib/business/widget-config';
import { upsertWidgetConfig } from './actions';

type Props = {
  locale: string;
  shopName: string;
  shopAlias: string | null;
  initial: WidgetConfig;
};

/**
 * Phase H+11 — theme presets.
 *
 * One-click combos applied to (accent_color, font_family, border_radius,
 * mode). The mode is included because some presets only read well in
 * one direction (e.g. pastel pink lands better on light, copper on
 * dark). The operator can still override any field after applying.
 */
type Preset = {
  id: 'kua' | 'noirOr' | 'rosePastel' | 'cuivre' | 'foret' | 'minimaliste';
  accent_color: string;
  font_family: WidgetConfig['font_family'];
  border_radius: WidgetConfig['border_radius'];
  mode: WidgetConfig['mode'];
};

const THEME_PRESETS: Preset[] = [
  {
    id: 'kua',
    accent_color: '#8b5cf6',
    font_family: 'system',
    border_radius: 'rounded',
    mode: 'dark',
  },
  {
    id: 'noirOr',
    accent_color: '#d4af37',
    font_family: 'system',
    border_radius: 'sharp',
    mode: 'dark',
  },
  {
    id: 'rosePastel',
    accent_color: '#ec4899',
    font_family: 'geist',
    border_radius: 'rounded',
    mode: 'light',
  },
  {
    id: 'cuivre',
    accent_color: '#b87333',
    font_family: 'system',
    border_radius: 'rounded',
    mode: 'dark',
  },
  {
    id: 'foret',
    accent_color: '#10b981',
    font_family: 'geist',
    border_radius: 'rounded',
    mode: 'dark',
  },
  {
    id: 'minimaliste',
    accent_color: '#525252',
    font_family: 'inter',
    border_radius: 'sharp',
    mode: 'light',
  },
];

export function WidgetClient({ locale, shopName, shopAlias, initial }: Props) {
  const t = useTranslations('pages.settings.widget');
  const { show } = useToast();

  // The preview iframe URL doesn't change on auto-save — the live
  // preview already syncs via postMessage. The version counter is
  // wired through `key={previewVersion}` so we *could* force-reload
  // by bumping it; we don't today but keeping the affordance avoids
  // a refactor when the failure-recovery story lands.
  const [previewVersion] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Normalize the `allowed_origins` array ↔ multiline textarea representation.
  const [originsText, setOriginsText] = useState(initial.allowed_origins.join('\n'));
  const [copied, setCopied] = useState(false);

  // Phase H+11 — auto-save status surfaced in the PageHeader actions slot.
  // The state machine: idle → saving (during the in-flight request) →
  // saved | error → (back to idle on next change).
  const [autoSaveState, setAutoSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    control,
    formState: { errors, isValid },
  } = useForm<WidgetConfig>({
    resolver: zodResolver(widgetConfigSchema) as unknown as Resolver<WidgetConfig>,
    defaultValues: initial,
    mode: 'onChange', // validate on every change so auto-save sees fresh errors
  });

  // ── Preview URL ────────────────────────────────────────────────────────
  const watchedLocale = watch('default_locale');
  const previewUrl = useMemo(() => {
    if (!shopAlias) return null;
    const previewLocale = watchedLocale || (locale === 'en' ? 'en' : 'fr');
    return `/${previewLocale}/embed/${encodeURIComponent(shopAlias)}?preview=1&v=${previewVersion}`;
  }, [shopAlias, locale, previewVersion, watchedLocale]);

  // ── Live preview broadcast ─────────────────────────────────────────────
  const liveConfig = useWatch({ control }) as WidgetConfig;
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
  }, [liveConfig]);

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

  // ── Auto-save (Phase H+11) ─────────────────────────────────────────────
  // Debounce 1500ms after the last form change. We skip the first render
  // (the initial values aren't a change) and refuse to save while the
  // form has validation errors — letting bad data hit the server would
  // surface as a "Save failed" message even though the issue is local.
  const isInitialMount = useRef(true);
  const triggerSave = useCallback(
    async (force = false) => {
      if (!force && !isValid) return;
      setAutoSaveState('saving');
      const origins = originsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const payload: WidgetConfig = { ...getValues(), allowed_origins: origins };
      try {
        const result = await upsertWidgetConfig(payload);
        if (result.ok) {
          setAutoSaveState('saved');
          setLastSavedAt(new Date());
        } else {
          setAutoSaveState('error');
          show({ variant: 'danger', title: t('toasts.saveError') });
        }
      } catch {
        setAutoSaveState('error');
        show({ variant: 'danger', title: t('toasts.saveError') });
      }
    },
    [getValues, isValid, originsText, show, t],
  );

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const timer = setTimeout(() => {
      void triggerSave(false);
    }, 1500);
    return () => clearTimeout(timer);
  }, [liveConfig, originsText, triggerSave]);

  // ── Theme preset application ──────────────────────────────────────────
  function applyPreset(preset: Preset) {
    setValue('accent_color', preset.accent_color, { shouldDirty: true, shouldValidate: true });
    setValue('font_family', preset.font_family, { shouldDirty: true });
    setValue('border_radius', preset.border_radius, { shouldDirty: true });
    setValue('mode', preset.mode, { shouldDirty: true });
  }

  // ── Snippet ────────────────────────────────────────────────────────────
  // Phase H+13 — three integration modes with distinct snippet shapes.
  //   - inline: data-kua-widget div that mounts the iframe in place.
  //   - floating-button: same div with data-kua-mode flagging widget.js
  //     to inject a fixed bottom-right "Book" button instead.
  //   - modal: salon's own button calls Kua.open() — no div needed.
  const watchedSnippetMode = watch('snippet_mode');
  const snippet = useMemo(() => {
    if (!shopAlias) return '';
    const origin =
      typeof window !== 'undefined' ? window.location.origin : 'https://kua-coif.vercel.app';
    const snippetLocale = watchedLocale || initial.default_locale;
    const scriptTag = `<script src="${origin}/widget.js" async></script>`;
    if (watchedSnippetMode === 'floating-button') {
      return [
        `<!-- Küa booking widget (floating button) -->`,
        `<div data-kua-widget="${shopAlias}" data-kua-locale="${snippetLocale}" data-kua-mode="floating-button"></div>`,
        scriptTag,
      ].join('\n');
    }
    if (watchedSnippetMode === 'modal') {
      const label = snippetLocale === 'en' ? 'Book now' : 'Réserver maintenant';
      return [
        `<!-- Küa booking widget (modal API) -->`,
        `<button onclick="Kua.open('${shopAlias}', { locale: '${snippetLocale}' })">${label}</button>`,
        scriptTag,
      ].join('\n');
    }
    return [
      `<!-- Küa booking widget -->`,
      `<div data-kua-widget="${shopAlias}" data-kua-locale="${snippetLocale}"></div>`,
      scriptTag,
    ].join('\n');
  }, [shopAlias, watchedLocale, initial.default_locale, watchedSnippetMode]);

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

  // Manual save handler kept around so `<form onSubmit>` doesn't lose
  // the legacy contract. Hitting Enter in an input now triggers an
  // immediate save (the explicit Save button is gone in favor of auto-
  // save, but Enter-to-save is still a useful affordance).
  function onSubmit(_values: WidgetConfig) {
    void triggerSave(true);
  }

  // Read the watched accent_color for the native color picker so the
  // swatch + hex input stay in sync. Default to the Küa purple when
  // the field is empty (so the picker doesn't show black on first load).
  const watchedAccent = watch('accent_color') || '#8b5cf6';

  // Empty allowed_origins → CSP wildcard. Surface a warning so the
  // operator knows their widget is embeddable anywhere.
  const allowedOriginsEmpty =
    originsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean).length === 0;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={shopAlias ? t('subtitle', { alias: shopAlias }) : t('subtitleNoAlias')}
        actions={
          <div className="flex items-center gap-3">
            <AutoSaveBadge state={autoSaveState} lastSavedAt={lastSavedAt} t={t} />
            {shopAlias ? (
              <a
                href={`/${locale}/embed/${shopAlias}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded border border-border bg-bg-surface px-3 py-2 text-xs font-medium text-text-primary hover:bg-bg-surface-2"
              >
                {t('openInTab')} <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_minmax(360px,520px)]">
        {/* ── Form column ────────────────────────────────────────────── */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
          {/* ── Identity ─────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.identity')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="display_name_fr">{t('fields.displayName')}</Label>
                  <Input
                    id="display_name_fr"
                    placeholder={shopName}
                    {...register('display_name_fr')}
                    invalid={Boolean(errors.display_name_fr)}
                  />
                </div>
                <div>
                  <Label htmlFor="display_name_en">{t('fields.displayNameEn')}</Label>
                  <Input
                    id="display_name_en"
                    placeholder={shopName}
                    {...register('display_name_en')}
                    invalid={Boolean(errors.display_name_en)}
                  />
                </div>
              </div>
              <p className="text-xs text-text-muted">{t('fields.displayNameHint')}</p>
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

          {/* ── Messages ─────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.messages')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="welcome_message_fr">{t('fields.welcomeMessage')}</Label>
                  <Textarea
                    id="welcome_message_fr"
                    rows={2}
                    maxLength={280}
                    {...register('welcome_message_fr')}
                  />
                </div>
                <div>
                  <Label htmlFor="welcome_message_en">{t('fields.welcomeMessageEn')}</Label>
                  <Textarea
                    id="welcome_message_en"
                    rows={2}
                    maxLength={280}
                    {...register('welcome_message_en')}
                  />
                </div>
              </div>
              <p className="text-xs text-text-muted">{t('fields.welcomeMessageHint')}</p>
            </CardBody>
          </Card>

          {/* ── Theme presets ────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <Palette className="h-4 w-4" />
                  {t('sections.presets')}
                </span>
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <p className="text-xs text-text-muted">{t('presets.intro')}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {THEME_PRESETS.map((p) => (
                  <PresetCard
                    key={p.id}
                    preset={p}
                    label={t(`presets.${p.id}`)}
                    onApply={() => applyPreset(p)}
                  />
                ))}
              </div>
            </CardBody>
          </Card>

          {/* ── Theme ────────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.theme')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div>
                  <Label htmlFor="mode">{t('fields.mode')}</Label>
                  <Select id="mode" {...register('mode')}>
                    <option value="dark">{t('options.modeDark')}</option>
                    <option value="light">{t('options.modeLight')}</option>
                    <option value="auto">{t('options.modeAuto')}</option>
                  </Select>
                  <p className="mt-1 text-xs text-text-muted">{t('fields.modeHint')}</p>
                </div>
                <div>
                  <Label htmlFor="accent_color">{t('fields.accentColor')}</Label>
                  {/* Phase H+11 — native color picker. Sits left of the
                      hex text input + syncs both ways. The picker is a
                      visible swatch (h-10 w-12) so the operator sees the
                      live color. */}
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      aria-label={t('fields.accentColor')}
                      value={watchedAccent}
                      onChange={(e) =>
                        setValue('accent_color', e.target.value, {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }
                      className="h-10 w-12 cursor-pointer rounded-lg border border-border bg-bg-surface-2 p-1"
                    />
                    <Input
                      id="accent_color"
                      type="text"
                      placeholder="#8b5cf6"
                      {...register('accent_color')}
                      invalid={Boolean(errors.accent_color)}
                    />
                  </div>
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

          {/* ── Steps ────────────────────────────────────────────────── */}
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
                  />
                )}
              />
              <p className="text-xs text-text-muted">{t('fields.stepsHint')}</p>
            </CardBody>
          </Card>

          {/* ── Behavior ─────────────────────────────────────────────── */}
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
                {/* Phase H+11 — empty origins = CSP wildcard `*` so the
                    widget can be iframed by literally anyone. Warn the
                    operator since silent "*" is a footgun. */}
                {allowedOriginsEmpty ? (
                  <div className="border-warning/30 bg-warning/10 mt-3 flex items-start gap-2 rounded-md border p-3 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <p>{t('fields.allowedOriginsWarning')}</p>
                  </div>
                ) : null}
              </div>
            </CardBody>
          </Card>

          {/* ── Post-booking ─────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.postBooking')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="post_booking_message_fr">{t('fields.postBookingMessage')}</Label>
                  <Textarea
                    id="post_booking_message_fr"
                    rows={2}
                    maxLength={280}
                    {...register('post_booking_message_fr')}
                  />
                </div>
                <div>
                  <Label htmlFor="post_booking_message_en">
                    {t('fields.postBookingMessageEn')}
                  </Label>
                  <Textarea
                    id="post_booking_message_en"
                    rows={2}
                    maxLength={280}
                    {...register('post_booking_message_en')}
                  />
                </div>
              </div>
              <p className="text-xs text-text-muted">{t('fields.postBookingMessageHint')}</p>

              <Controller
                control={control}
                name="redirect_enabled"
                render={({ field }) => (
                  <Toggle
                    checked={field.value}
                    onChange={field.onChange}
                    label={t('fields.redirectEnabled')}
                  />
                )}
              />
              {watch('redirect_enabled') ? (
                <div>
                  <Label htmlFor="redirect_url">{t('fields.redirectUrl')}</Label>
                  <Input
                    id="redirect_url"
                    type="url"
                    placeholder={t('fields.redirectUrlPlaceholder')}
                    {...register('redirect_url')}
                    invalid={Boolean(errors.redirect_url)}
                  />
                  <p className="mt-1 text-xs text-text-muted">{t('fields.redirectUrlHint')}</p>
                </div>
              ) : null}
            </CardBody>
          </Card>
        </form>

        {/* ── Preview + snippet column ──────────────────────────────── */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.snippet')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              {/* Phase H+13 — integration mode selector. Drives both the
                  snippet shape (3 templates) AND the runtime behaviour
                  of widget.js when the salon pastes the snippet. */}
              <div>
                <Label htmlFor="snippet_mode">{t('snippetMode.label')}</Label>
                <Select id="snippet_mode" {...register('snippet_mode')}>
                  <option value="inline">{t('snippetMode.inline')}</option>
                  <option value="floating-button">{t('snippetMode.floatingButton')}</option>
                  <option value="modal">{t('snippetMode.modal')}</option>
                </Select>
                <p className="mt-1 text-xs text-text-muted">
                  {watchedSnippetMode === 'floating-button'
                    ? t('snippetMode.floatingButtonHint')
                    : watchedSnippetMode === 'modal'
                      ? t('snippetMode.modalHint')
                      : t('snippetMode.inlineHint')}
                </p>
              </div>

              <div className="space-y-3">
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
                {shopAlias ? (
                  <a
                    href={`/${locale}/test-embed?slug=${encodeURIComponent(
                      shopAlias,
                    )}&mode=${watchedSnippetMode}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded border border-border bg-bg-surface-2 px-3 py-2 text-center text-xs font-medium text-text-primary hover:bg-bg-elevated"
                  >
                    {t('testEmbed.button')} <ExternalLink className="ml-1 inline h-3 w-3" />
                  </a>
                ) : null}
              </div>
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

// ────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────

function AutoSaveBadge({
  state,
  lastSavedAt,
  t,
}: {
  state: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: Date | null;
  t: ReturnType<typeof useTranslations>;
}) {
  if (state === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t('autosave.saving')}
      </span>
    );
  }
  if (state === 'saved' || (state === 'idle' && lastSavedAt)) {
    const time = lastSavedAt
      ? lastSavedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : '';
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-success">
        <Check className="h-3.5 w-3.5" />
        {t('autosave.saved')}
        {time ? <span className="text-text-muted">· {time}</span> : null}
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-danger">
        <CircleAlert className="h-3.5 w-3.5" />
        {t('autosave.error')}
      </span>
    );
  }
  return null;
}

function PresetCard({
  preset,
  label,
  onApply,
}: {
  preset: Preset;
  label: string;
  onApply: () => void;
}) {
  // Inline CSS so each card paints its own preview without leaking
  // styles into the document. The mini-card mimics the widget's surface
  // + accent button so the operator can compare at a glance.
  const surfaceBg = preset.mode === 'light' ? '#ffffff' : '#1b1b1b';
  const surfaceFg = preset.mode === 'light' ? '#1b1b1b' : '#f5f5f5';
  const subtext = preset.mode === 'light' ? '#6b7280' : '#a0a0a0';
  const radius =
    preset.border_radius === 'sharp' ? '0px' : preset.border_radius === 'pill' ? '999px' : '8px';
  const previewStyle: CSSProperties = {
    backgroundColor: surfaceBg,
    color: surfaceFg,
    borderRadius: radius === '999px' ? '12px' : radius, // card stays card-ish
  };
  const btnStyle: CSSProperties = {
    backgroundColor: preset.accent_color,
    borderRadius: radius,
    color: '#ffffff',
  };
  return (
    <button
      type="button"
      onClick={onApply}
      className={cn(
        'group flex flex-col items-stretch gap-2 rounded-lg border border-border bg-bg-surface-2 p-3 text-left',
        'transition-colors duration-150 hover:border-accent hover:bg-bg-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-focus',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-text-primary">{label}</span>
        <span
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: preset.accent_color }}
          aria-hidden
        />
      </div>
      <div className="rounded-md border border-border p-2 text-[10px]" style={previewStyle}>
        <div className="mb-1 font-semibold">Aa</div>
        <div className="mb-1.5 text-[9px]" style={{ color: subtext }}>
          Booking
        </div>
        <div className="px-2 py-1 text-center text-[10px] font-medium" style={btnStyle}>
          OK
        </div>
      </div>
    </button>
  );
}
