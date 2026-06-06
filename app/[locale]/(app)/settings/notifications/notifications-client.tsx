'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyCell } from '@/components/ui/empty-cell';
import { Input, Label } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { SectionMasthead } from '@/components/ui/section-masthead';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import {
  clearSenderConfig,
  clearTwilioConfig,
  testSmtpConnection,
  testTwilioConfig,
  toggleAutomation,
  upsertSenderConfig,
  upsertSlackWebhook,
  upsertTwilioConfig,
  type AutomationRow,
  type SenderConfigSnapshot,
  type TwilioConfigSnapshot,
} from './actions';

type Props = {
  locale: string;
  state: {
    config: SenderConfigSnapshot;
    /**
     * Loop 56 — snapshot of the Twilio creds on file. `hasAuthToken`
     * is a boolean for the same write-only reasoning as `hasPassword`
     * on the SMTP config; the ciphertext never reaches the browser.
     */
    twilio: TwilioConfigSnapshot;
    /**
     * Loop 33 — boolean snapshot ("is a webhook URL on file") rather
     * than the URL itself. The URL is a bearer credential; we never
     * round-trip it to the browser. Form starts blank, owner re-enters
     * if they want to change it, "Disconnect" clears the column.
     */
    slackWebhookConfigured: boolean;
    automations: AutomationRow[];
    encryptionReady: boolean;
  };
};

const AUTOMATION_ORDER: AutomationRow['kind'][] = [
  'booking_confirmation',
  'reminder_24h',
  'reminder_1h',
  'cancellation',
  'waitlist_open',
  'birthday',
];

export function NotificationsClient({ state }: Props) {
  const t = useTranslations('pages.settings.notifications');
  const tNav = useTranslations('pages.settings.nav');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [saving, startSave] = useTransition();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { kind: 'idle' } | { kind: 'ok' } | { kind: 'error'; message?: string }
  >({ kind: 'idle' });

  // Local form state — controlled. The password field starts empty (write-
  // only: we never expose the existing ciphertext).
  const [form, setForm] = useState({
    fromEmail: state.config.fromEmail,
    fromName: state.config.fromName,
    smtpHost: state.config.smtpHost,
    smtpPort: state.config.smtpPort ?? 587,
    smtpUser: state.config.smtpUser,
    smtpPassword: '',
  });
  const [hasPassword, setHasPassword] = useState(state.config.hasPassword);
  // Loop 33 — Slack webhook input. Starts blank (write-only).
  const [slackUrl, setSlackUrl] = useState('');
  const [slackConfigured, setSlackConfigured] = useState(state.slackWebhookConfigured);

  // Loop 56 — Twilio form. Auth token is write-only (same pattern as
  // SMTP password). The test-recipient field is local-only; we don't
  // persist it because it's the operator's personal phone, not shop data.
  const [twilioForm, setTwilioForm] = useState({
    accountSid: state.twilio.accountSid,
    authToken: '',
    fromNumber: state.twilio.fromNumber,
    testTo: '',
  });
  const [hasAuthToken, setHasAuthToken] = useState(state.twilio.hasAuthToken);
  const [testingTwilio, setTestingTwilio] = useState(false);
  const [twilioTestResult, setTwilioTestResult] = useState<
    { kind: 'idle' } | { kind: 'ok'; sid: string } | { kind: 'error'; message?: string }
  >({ kind: 'idle' });
  // A shop is "Twilio-configured enough to actually send" only when all
  // three persisted pieces are present. We drive both the Connected badge
  // and the SMS-toggle gating off this.
  const twilioConfigured =
    Boolean(state.twilio.accountSid) && Boolean(state.twilio.fromNumber) && hasAuthToken;

  function onSaveSlack(action: 'save' | 'clear') {
    startSave(async () => {
      const url = action === 'clear' ? '' : slackUrl.trim();
      const result = await upsertSlackWebhook({ slack_webhook_url: url });
      if (result.ok) {
        show({
          variant: 'success',
          title: action === 'clear' ? t('toasts.slackCleared') : t('toasts.slackSaved'),
        });
        setSlackConfigured(url !== '');
        setSlackUrl('');
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  function setField<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function onSaveConfig() {
    if (!state.encryptionReady && form.smtpPassword) {
      show({ variant: 'danger', title: t('errors.encryptionMissing') });
      return;
    }
    startSave(async () => {
      const result = await upsertSenderConfig({
        from_email: form.fromEmail,
        from_name: form.fromName,
        smtp_host: form.smtpHost,
        smtp_port: form.smtpPort || null,
        smtp_user: form.smtpUser,
        smtp_password: form.smtpPassword,
      });
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.configSaved') });
        if (form.smtpPassword) setHasPassword(true);
        // Clear the password input — the form is write-only from now on.
        setField('smtpPassword', '');
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  function onDisconnect() {
    if (!confirm(t('confirmDisconnect'))) return;
    startSave(async () => {
      const result = await clearSenderConfig({});
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.disconnected') });
        setForm({
          fromEmail: '',
          fromName: '',
          smtpHost: '',
          smtpPort: 587,
          smtpUser: '',
          smtpPassword: '',
        });
        setHasPassword(false);
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  async function onTestConnection() {
    if (
      !form.fromEmail ||
      !form.smtpHost ||
      !form.smtpUser ||
      !form.smtpPassword ||
      !form.smtpPort
    ) {
      setTestResult({ kind: 'error', message: t('errors.testFieldsRequired') });
      return;
    }
    setTesting(true);
    setTestResult({ kind: 'idle' });
    const res = await testSmtpConnection({
      from_email: form.fromEmail,
      from_name: form.fromName,
      smtp_host: form.smtpHost,
      smtp_port: form.smtpPort,
      smtp_user: form.smtpUser,
      smtp_password: form.smtpPassword,
    });
    setTesting(false);
    if (res.ok) {
      setTestResult({ kind: 'ok' });
    } else {
      setTestResult({ kind: 'error', message: res.message });
    }
  }

  function onToggle(row: AutomationRow, next: boolean) {
    startSave(async () => {
      const result = await toggleAutomation({ id: row.id, enabled: next });
      if (!result.ok) {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  // ── Loop 56 — Twilio handlers ─────────────────────────────────────
  function setTwilioField<K extends keyof typeof twilioForm>(k: K, v: (typeof twilioForm)[K]) {
    setTwilioForm((f) => ({ ...f, [k]: v }));
  }

  function onSaveTwilio() {
    if (!state.encryptionReady && twilioForm.authToken) {
      show({ variant: 'danger', title: t('errors.encryptionMissing') });
      return;
    }
    startSave(async () => {
      const result = await upsertTwilioConfig({
        twilio_account_sid: twilioForm.accountSid,
        twilio_auth_token: twilioForm.authToken,
        twilio_from_number: twilioForm.fromNumber,
      });
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.twilioSaved') });
        if (twilioForm.authToken) setHasAuthToken(true);
        // Clear the auth token input — write-only from now on.
        setTwilioField('authToken', '');
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  function onDisconnectTwilio() {
    if (!confirm(t('twilio.confirmDisconnect'))) return;
    startSave(async () => {
      const result = await clearTwilioConfig({});
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.twilioCleared') });
        setTwilioForm({ accountSid: '', authToken: '', fromNumber: '', testTo: '' });
        setHasAuthToken(false);
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  async function onTestTwilio() {
    if (
      !twilioForm.accountSid ||
      !twilioForm.authToken ||
      !twilioForm.fromNumber ||
      !twilioForm.testTo
    ) {
      setTwilioTestResult({ kind: 'error', message: t('testTwilio.fieldsRequired') });
      return;
    }
    setTestingTwilio(true);
    setTwilioTestResult({ kind: 'idle' });
    const res = await testTwilioConfig({
      twilio_account_sid: twilioForm.accountSid,
      twilio_auth_token: twilioForm.authToken,
      twilio_from_number: twilioForm.fromNumber,
      test_to_number: twilioForm.testTo,
    });
    setTestingTwilio(false);
    if (res.ok) {
      setTwilioTestResult({ kind: 'ok', sid: res.sid });
    } else {
      setTwilioTestResult({ kind: 'error', message: res.message });
    }
  }

  // Index the email automations by kind for O(1) lookup in the matrix
  // render.
  const emailAutomations = AUTOMATION_ORDER.map(
    (kind) => state.automations.find((a) => a.kind === kind && a.channel === 'email')!,
  ).filter(Boolean);
  // Loop 56 — SMS automations now toggleable (Twilio pipeline shipped
  // in Loops 53-55). Rows that aren't seeded for a given (shop,kind)
  // render as a dash, same as the email column.
  const smsAutomations = AUTOMATION_ORDER.map(
    (kind) => state.automations.find((a) => a.kind === kind && a.channel === 'sms')!,
  ).filter(Boolean);

  return (
    <>
      <PageHeader eyebrow={tNav('title')} title={t('title')} subtitle={t('subtitle')} />

      <div className="space-y-8 p-6">
        {/* ── Sender config — the page's single hero beat ───────────── */}
        <section className="surface-hero space-y-5 p-6">
          <SectionMasthead title={t('sender.title')} />
          <p className="text-sm text-text-secondary">{t('sender.description')}</p>

          {!state.encryptionReady ? (
            <div className="border-warning/40 bg-warning/10 flex items-start gap-2 rounded-md border px-3 py-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{t('errors.encryptionMissing')}</span>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <Label htmlFor="from_name">{t('sender.fromName')}</Label>
              <Input
                id="from_name"
                value={form.fromName}
                onChange={(e) => setField('fromName', e.target.value)}
                placeholder="Salon Axum"
                autoComplete="organization"
              />
            </div>
            <div>
              <Label htmlFor="from_email" required>
                {t('sender.fromEmail')}
              </Label>
              <Input
                id="from_email"
                type="email"
                value={form.fromEmail}
                onChange={(e) => setField('fromEmail', e.target.value)}
                placeholder="noreply@salonaxum.com"
                autoComplete="email"
              />
            </div>
            <div>
              <Label htmlFor="smtp_host" required>
                {t('sender.smtpHost')}
              </Label>
              <Input
                id="smtp_host"
                value={form.smtpHost}
                onChange={(e) => setField('smtpHost', e.target.value)}
                placeholder="smtp.gmail.com"
              />
              <p className="mt-1 text-xs text-text-muted">{t('sender.smtpHostHint')}</p>
            </div>
            <div>
              <Label htmlFor="smtp_port" required>
                {t('sender.smtpPort')}
              </Label>
              <Input
                id="smtp_port"
                type="number"
                min={1}
                max={65535}
                value={form.smtpPort}
                onChange={(e) => setField('smtpPort', Number(e.target.value || 0))}
              />
            </div>
            <div>
              <Label htmlFor="smtp_user" required>
                {t('sender.smtpUser')}
              </Label>
              <Input
                id="smtp_user"
                value={form.smtpUser}
                onChange={(e) => setField('smtpUser', e.target.value)}
                placeholder="noreply@salonaxum.com"
                autoComplete="username"
              />
            </div>
            <div>
              <Label htmlFor="smtp_password" required={!hasPassword}>
                {t('sender.smtpPassword')}
              </Label>
              <Input
                id="smtp_password"
                type="password"
                value={form.smtpPassword}
                onChange={(e) => setField('smtpPassword', e.target.value)}
                placeholder={hasPassword ? t('sender.passwordKept') : ''}
                autoComplete="new-password"
              />
              <p className="mt-1 text-xs text-text-muted">{t('sender.smtpPasswordHint')}</p>
            </div>
          </div>

          {testResult.kind === 'ok' ? (
            <div className="border-success/40 bg-success/10 flex items-center gap-2 rounded-md border px-3 py-2 text-xs text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> {t('test.success')}
            </div>
          ) : null}
          {testResult.kind === 'error' ? (
            <div className="border-danger/40 bg-danger/10 rounded-md border px-3 py-2 text-xs text-danger">
              <p className="font-medium">{t('test.failure')}</p>
              {testResult.message ? <p className="mt-1 font-mono">{testResult.message}</p> : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={onTestConnection}
                loading={testing}
                disabled={saving}
              >
                <Send className="h-4 w-4" /> {t('test.button')}
              </Button>
              {hasPassword ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onDisconnect}
                  disabled={saving || testing}
                >
                  {t('sender.disconnect')}
                </Button>
              ) : null}
            </div>
            <Button type="button" onClick={onSaveConfig} loading={saving}>
              {tCommon('actions.save')}
            </Button>
          </div>
        </section>

        {/* ── Loop 56 (P100 slice 4) — Twilio SMS credentials ─────── */}
        <section className="border-t border-border pt-8">
          <SectionMasthead
            title={t('twilio.title')}
            actions={
              twilioConfigured ? (
                <span className="bg-success/15 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-success">
                  <CheckCircle2 className="h-3 w-3" /> {t('twilio.connected')}
                </span>
              ) : null
            }
          />
          <div className="mt-6 space-y-5">
            <p className="text-sm text-text-secondary">{t('twilio.description')}</p>

            {!state.encryptionReady ? (
              <div className="border-warning/40 bg-warning/10 flex items-start gap-2 rounded-md border px-3 py-2 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{t('errors.encryptionMissing')}</span>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <Label htmlFor="twilio_account_sid" required>
                  {t('twilio.accountSid')}
                </Label>
                <Input
                  id="twilio_account_sid"
                  value={twilioForm.accountSid}
                  onChange={(e) => setTwilioField('accountSid', e.target.value.trim())}
                  placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  autoComplete="off"
                />
                <p className="mt-1 text-xs text-text-muted">{t('twilio.accountSidHint')}</p>
              </div>
              <div>
                <Label htmlFor="twilio_auth_token" required={!hasAuthToken}>
                  {t('twilio.authToken')}
                </Label>
                <Input
                  id="twilio_auth_token"
                  type="password"
                  value={twilioForm.authToken}
                  onChange={(e) => setTwilioField('authToken', e.target.value)}
                  placeholder={hasAuthToken ? t('twilio.authTokenKept') : ''}
                  autoComplete="new-password"
                />
                <p className="mt-1 text-xs text-text-muted">{t('twilio.authTokenHint')}</p>
              </div>
              <div>
                <Label htmlFor="twilio_from_number" required>
                  {t('twilio.fromNumber')}
                </Label>
                <Input
                  id="twilio_from_number"
                  value={twilioForm.fromNumber}
                  onChange={(e) => setTwilioField('fromNumber', e.target.value.trim())}
                  placeholder="+15145551212"
                  inputMode="tel"
                  autoComplete="off"
                />
                <p className="mt-1 text-xs text-text-muted">{t('twilio.fromNumberHint')}</p>
              </div>
              <div>
                <Label htmlFor="twilio_test_to">{t('twilio.testRecipient')}</Label>
                <Input
                  id="twilio_test_to"
                  value={twilioForm.testTo}
                  onChange={(e) => setTwilioField('testTo', e.target.value.trim())}
                  placeholder="+15145551212"
                  inputMode="tel"
                  autoComplete="off"
                />
                <p className="mt-1 text-xs text-text-muted">{t('twilio.testRecipientHint')}</p>
              </div>
            </div>

            {twilioTestResult.kind === 'ok' ? (
              <div className="border-success/40 bg-success/10 flex items-start gap-2 rounded-md border px-3 py-2 text-xs text-success">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{t('testTwilio.success', { sid: twilioTestResult.sid })}</span>
              </div>
            ) : null}
            {twilioTestResult.kind === 'error' ? (
              <div className="border-danger/40 bg-danger/10 rounded-md border px-3 py-2 text-xs text-danger">
                <p className="font-medium">{t('testTwilio.failure')}</p>
                {twilioTestResult.message ? (
                  <p className="mt-1 font-mono">{twilioTestResult.message}</p>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onTestTwilio}
                  loading={testingTwilio}
                  disabled={saving}
                >
                  <Send className="h-4 w-4" /> {t('testTwilio.button')}
                </Button>
                {twilioConfigured ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={onDisconnectTwilio}
                    disabled={saving || testingTwilio}
                  >
                    {t('twilio.disconnect')}
                  </Button>
                ) : null}
              </div>
              <Button type="button" onClick={onSaveTwilio} loading={saving}>
                {tCommon('actions.save')}
              </Button>
            </div>
          </div>
        </section>

        {/* ── Loop 33 (P90) — Slack webhook for owner notifications ── */}
        <section className="border-t border-border pt-8">
          <SectionMasthead
            title={t('slack.title')}
            actions={
              slackConfigured ? (
                <span className="bg-success/15 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-success">
                  <CheckCircle2 className="h-3 w-3" /> {t('slack.connected')}
                </span>
              ) : null
            }
          />
          <div className="mt-6 space-y-4">
            <p className="text-sm text-text-secondary">{t('slack.description')}</p>
            <div>
              <Label htmlFor="slack_webhook_url">{t('slack.urlLabel')}</Label>
              <Input
                id="slack_webhook_url"
                type="url"
                inputMode="url"
                placeholder="https://hooks.slack.com/services/T0000/B0000/XXXX"
                value={slackUrl}
                onChange={(e) => setSlackUrl(e.target.value)}
                autoComplete="off"
              />
              <p className="mt-1 text-[11px] text-text-muted">{t('slack.urlHint')}</p>
            </div>
            <div className="flex items-center justify-end gap-3">
              {slackConfigured ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onSaveSlack('clear')}
                  disabled={saving}
                >
                  {t('slack.disconnect')}
                </Button>
              ) : null}
              <Button
                type="button"
                onClick={() => onSaveSlack('save')}
                loading={saving}
                disabled={!slackUrl.trim()}
              >
                {tCommon('actions.save')}
              </Button>
            </div>
          </div>
        </section>

        {/* ── Automations ───────────────────────────────────────────── */}
        <section className="border-t border-border pt-8">
          <SectionMasthead title={t('automations.title')} />
          <div className="mt-6">
            <p className="mb-4 text-sm text-text-secondary">{t('automations.description')}</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="type-eyebrow border-b border-border">
                  <th className="py-3 text-left">{t('automations.columns.kind')}</th>
                  <th className="w-24 py-3 text-center">{t('automations.columns.email')}</th>
                  <th className="w-32 py-3 text-center">{t('automations.columns.sms')}</th>
                </tr>
              </thead>
              <tbody>
                {AUTOMATION_ORDER.map((kind) => {
                  const emailRow = emailAutomations.find((a) => a.kind === kind);
                  // Loop 56 — SMS row is now controllable, gated on the
                  // shop having Twilio creds saved. Without creds the
                  // toggle visually disables and surfaces the tooltip
                  // pointing the owner at the Twilio section above.
                  const smsRow = smsAutomations.find((a) => a.kind === kind);
                  return (
                    <tr key={kind} className="border-b border-border last:border-b-0">
                      <td className="py-3">
                        <p className="font-medium">{t(`automations.kinds.${kind}.label`)}</p>
                        <p className="mt-0.5 text-xs text-text-muted">
                          {t(`automations.kinds.${kind}.hint`)}
                        </p>
                      </td>
                      <td className="py-3 text-center">
                        {emailRow ? (
                          <Toggle
                            checked={emailRow.enabled}
                            onChange={(v) => onToggle(emailRow, v)}
                            disabled={saving}
                          />
                        ) : (
                          <EmptyCell />
                        )}
                      </td>
                      <td className="py-3 text-center">
                        {smsRow ? (
                          twilioConfigured ? (
                            <Toggle
                              checked={smsRow.enabled}
                              onChange={(v) => onToggle(smsRow, v)}
                              disabled={saving}
                            />
                          ) : (
                            <span className="inline-flex" title={t('automations.smsTooltip')}>
                              <Toggle checked={smsRow.enabled} onChange={() => {}} disabled />
                            </span>
                          )
                        ) : (
                          <EmptyCell />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
