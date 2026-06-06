'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch, Controller, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  BarChart3,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { originPattern, widgetConfigSchema, type WidgetConfig } from '@/lib/business/widget-config';
import { upsertWidgetConfig } from './actions';

/**
 * Phase H+14 — funnel stats shape passed from the server page.
 * Computed over the last 30 days of widget_events for the active shop.
 */
export type FunnelStats = {
  impressions: number;
  bookings: number;
  conversionPct: number;
  bySource: Partial<
    Record<
      'inline' | 'floating-button' | 'modal' | 'direct',
      { impressions: number; bookings: number }
    >
  >;
};

type Props = {
  locale: string;
  shopName: string;
  shopAlias: string | null;
  initial: WidgetConfig;
  funnelStats: FunnelStats;
};

export function WidgetClient({ locale, shopName, shopAlias, initial, funnelStats }: Props) {
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
  // saved | error → (back to idle on next change). The 'invalid' state
  // is a local validation block (bad accent hex, malformed origin) — it
  // means "your latest edit did NOT save, fix the field" and is distinct
  // from 'error' (the server/network rejected an otherwise-valid save).
  const [autoSaveState, setAutoSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'error' | 'invalid'
  >('idle');
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
      const origins = originsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      // Refuse to save on local validation failure. RHF's `isValid`
      // covers the registered fields; `allowed_origins` lives in its
      // own state, so we validate each line here with the SAME regex
      // the server schema enforces (imported `originPattern`) — a
      // divergence would let the UI accept an origin the server then
      // rejects with a generic error. Either failure flips the badge
      // to 'invalid' rather than returning silently, so the operator
      // knows their latest edit didn't persist. Malformed origins
      // block even a forced (Enter-key) save since the server would
      // reject them outright.
      const originsInvalid = origins.some((line) => !originPattern.test(line));
      if (originsInvalid || (!force && !isValid)) {
        setAutoSaveState('invalid');
        return;
      }
      setAutoSaveState('saving');
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
  // swatch + hex input stay in sync. Default to the Küa sage when
  // the field is empty (so the picker doesn't show black on first load).
  const watchedAccent = watch('accent_color') || '#4f7d5e';

  // In-page integration test. Loads `/test-embed` (which itself pulls
  // widget.js + injects the real iframe) INSIDE the settings page so
  // the operator can verify the snippet without leaving — the floating-
  // button mode's `position:fixed` button is scoped to this iframe's
  // document, so it appears in the corner of the test frame, not the
  // whole admin page. Keyed on the snippet mode so switching modes
  // remounts the frame and re-runs widget.js with the new behavior.
  const testEmbedUrl = shopAlias
    ? `/${locale}/test-embed?slug=${encodeURIComponent(shopAlias)}&mode=${watchedSnippetMode}`
    : '';

  // Empty allowed_origins → CSP wildcard. Surface a warning so the
  // operator knows their widget is embeddable anywhere.
  const originsLines = originsText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowedOriginsEmpty = originsLines.length === 0;
  // Any non-empty line that fails the shared origin regex. Same rule
  // the server enforces, so "looks valid here" == "saves there".
  const originsHasError = originsLines.some((line) => !originPattern.test(line));

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
          {/* ── 1. Identity ──────────────────────────────────────────── */}
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
              <div>
                <Label htmlFor="default_locale">{t('fields.defaultLocale')}</Label>
                <Select id="default_locale" className="max-w-xs" {...register('default_locale')}>
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                </Select>
                <p className="mt-1 text-xs text-text-muted">{t('fields.defaultLocaleHint')}</p>
              </div>
            </CardBody>
          </Card>

          {/* ── 2. Theme ─────────────────────────────────────────────── */}
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
                  {/* Native color picker. Sits left of the hex text input +
                      syncs both ways. The picker is a visible swatch
                      (h-10 w-12) so the operator sees the live color. */}
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
                      placeholder="#4f7d5e"
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

          {/* ── 3. Messages ──────────────────────────────────────────── */}
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
            </CardBody>
          </Card>

          {/* ── 4. Steps ─────────────────────────────────────────────── */}
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

          {/* ── 5. After booking ─────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.postBooking')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
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

          {/* ── 6. Security ──────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.security')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div>
                <Label htmlFor="allowed_origins">{t('fields.allowedOrigins')}</Label>
                <Textarea
                  id="allowed_origins"
                  rows={3}
                  placeholder="https://salon-example.com&#10;https://*.example.com"
                  value={originsText}
                  onChange={(e) => setOriginsText(e.target.value)}
                  invalid={originsHasError}
                />
                <p className="mt-1 text-xs text-text-muted">{t('fields.allowedOriginsHint')}</p>
                {/* Phase H+14 — a malformed origin line is an error (red):
                    the server would reject the save, so block it client-
                    side and say why. Empty origins is only a warning
                    (amber): it's a valid-but-permissive "*" footgun. The
                    error supersedes the warning — they can't co-occur (a
                    bad line means the list isn't empty). */}
                {originsHasError ? (
                  <div className="border-danger/30 bg-danger/10 mt-3 flex items-start gap-2 rounded-md border p-3 text-xs text-danger">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <p>{t('fields.allowedOriginsError')}</p>
                  </div>
                ) : allowedOriginsEmpty ? (
                  <div className="border-warning/30 bg-warning/10 mt-3 flex items-start gap-2 rounded-md border p-3 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <p>{t('fields.allowedOriginsWarning')}</p>
                  </div>
                ) : null}
              </div>
            </CardBody>
          </Card>
        </form>

        {/* ── Preview + integration column ──────────────────────────── */}
        <div className="space-y-6">
          {/* ── 1. Live preview ──────────────────────────────────────── */}
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

          {/* ── 2. Integration code + in-page test ───────────────────── */}
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
              </div>

              {/* In-page integration test. Renders the real widget (via
                  /test-embed → widget.js) inside this frame so the
                  operator can try the exact snippet — including the
                  floating-button mode, whose fixed button stays scoped
                  to this iframe. A "full screen" link opens the same
                  test in a new tab for a true full-page check. */}
              {shopAlias ? (
                <div className="space-y-2 border-t border-border pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                      {t('testEmbed.button')}
                    </p>
                    <a
                      href={testEmbedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                    >
                      {t('testEmbed.openTab')} <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <p className="text-xs text-text-muted">{t('testEmbed.description')}</p>
                  <iframe
                    key={watchedSnippetMode}
                    src={testEmbedUrl}
                    title={t('testEmbed.button')}
                    className="h-[560px] w-full rounded-lg border border-border bg-bg-base"
                  />
                </div>
              ) : null}
            </CardBody>
          </Card>

          {/* ── 3. Stats ─────────────────────────────────────────────── */}
          {/* Phase H+14 — conversion funnel card. Shows the last 30
              days of widget activity for this shop. Source-broken-
              down so the operator can see which integration shape
              (inline vs floating vs modal) is pulling its weight. */}
          <FunnelCard stats={funnelStats} t={t} />
        </div>
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────

function FunnelCard({ stats, t }: { stats: FunnelStats; t: ReturnType<typeof useTranslations> }) {
  const hasData = stats.impressions > 0;
  const sourceEntries = Object.entries(stats.bySource) as Array<
    ['inline' | 'floating-button' | 'modal' | 'direct', { impressions: number; bookings: number }]
  >;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            {t('sections.analytics')}
          </span>
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-xs text-text-muted">{t('analytics.intro')}</p>
        {!hasData ? (
          <p className="text-sm text-text-secondary">{t('analytics.empty')}</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Stat label={t('analytics.impressions')} value={String(stats.impressions)} />
              <Stat label={t('analytics.bookings')} value={String(stats.bookings)} accent />
              <Stat
                label={t('analytics.conversion')}
                value={`${stats.conversionPct.toFixed(1)}%`}
              />
            </div>
            {sourceEntries.length > 1 ? (
              <div className="space-y-2 rounded-md border border-border bg-bg-surface-2 p-3 text-xs">
                <p className="font-semibold text-text-primary">{t('analytics.bySource')}</p>
                <table className="w-full">
                  <thead>
                    <tr className="text-[10px] uppercase text-text-muted">
                      <th className="text-left">{t('analytics.source')}</th>
                      <th className="text-right">{t('analytics.impressions')}</th>
                      <th className="text-right">{t('analytics.bookings')}</th>
                      <th className="text-right">{t('analytics.conversion')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceEntries.map(([source, agg]) => {
                      const pct = agg.impressions > 0 ? (agg.bookings / agg.impressions) * 100 : 0;
                      return (
                        <tr key={source} className="border-t border-border">
                          <td className="py-1 font-mono">{source}</td>
                          <td className="py-1 text-right tabular-nums">{agg.impressions}</td>
                          <td className="py-1 text-right tabular-nums text-accent">
                            {agg.bookings}
                          </td>
                          <td className="py-1 text-right tabular-nums">{pct.toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="space-y-1 rounded-md border border-border bg-bg-surface-2 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      <p className={cn('text-2xl font-semibold tabular-nums', accent && 'text-accent')}>{value}</p>
    </div>
  );
}

function AutoSaveBadge({
  state,
  lastSavedAt,
  t,
}: {
  state: 'idle' | 'saving' | 'saved' | 'error' | 'invalid';
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
  // 'invalid' is amber, not red — it's a "fix your input" local block,
  // not a failed server round-trip. Distinct color keeps the two apart
  // at a glance.
  if (state === 'invalid') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-warning">
        <AlertTriangle className="h-3.5 w-3.5" />
        {t('autosave.invalid')}
      </span>
    );
  }
  return null;
}
