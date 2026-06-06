import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ExternalLink, ShieldAlert } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentShop, requireShopMember, requireRoleInCurrentShop } from '@/lib/auth/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { formatCurrencyCAD } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * `/finances/disputes` — read-only Stripe chargeback (dispute) list.
 *
 * The ingest half of this feature lives in the Stripe webhook
 * (`app/api/webhooks/stripe/route.ts` → `persistDispute()`), which
 * upserts `disputes` rows on `charge.dispute.created/updated/closed`.
 * This page is the durable, in-app record an owner pulls up to see at
 * a glance which chargebacks still need a response and by when.
 *
 * Deliberately read-only (manager+): responding to / submitting
 * evidence for a dispute on a destination charge requires Stripe's
 * `dispute_management` embedded component + platform liability
 * handling, which this app has not integrated. We deep-link each row
 * to the Stripe dashboard instead, where the owner acts.
 *
 * Pattern mirrors `/finances/today`: server-rendered, hand-typed row
 * (db/types.ts has no `disputes` type yet — regenerating it is a
 * separate chore), raw `<table>` inside `Card` in the finances
 * grammar, all strings via next-intl.
 */
export default async function DisputesPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  await requireShopMember({ locale });
  await requireRoleInCurrentShop('manager');

  const [t, shop] = await Promise.all([
    getTranslations({ locale, namespace: 'pages.finances.disputes' }),
    getCurrentShop(),
  ]);
  const timezone = shop?.timezone ?? 'America/Toronto';
  const intlLocale = locale === 'fr' ? 'fr-CA' : 'en-CA';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServerClient() as any;

  // RLS already scopes `disputes_select` to member shops; the explicit
  // `.eq('shop_id', shop.id)` adds current-shop scoping for multi-shop
  // members (defense-in-depth, matches the spirit of getCurrentShop()).
  const res = await supabase
    .from('disputes')
    .select(
      'id, appointment_id, stripe_dispute_id, stripe_charge_id, stripe_payment_intent_id, amount_cents, currency, reason, status, evidence_due_by, created_at',
    )
    .eq('shop_id', shop?.id)
    .order('created_at', { ascending: false });

  type DisputeRow = {
    id: string;
    appointment_id: string | null;
    stripe_dispute_id: string;
    stripe_charge_id: string;
    stripe_payment_intent_id: string | null;
    amount_cents: number;
    currency: string;
    reason: string;
    status: string;
    evidence_due_by: string | null;
    created_at: string;
  };

  const disputes = (res.data as DisputeRow[] | null) ?? [];

  // "Needs response" = needs_response | warning_needs_response — the
  // states where the shop's clock is running. Surfaced as a small
  // count badge above the table so the owner clocks it instantly.
  const needsResponse = disputes.filter(
    (d) => d.status === 'needs_response' || d.status === 'warning_needs_response',
  ).length;

  const fmtCAD = (cents: number) => formatCurrencyCAD(cents / 100, locale === 'fr' ? 'fr' : 'en');

  const dateFmt = new Intl.DateTimeFormat(intlLocale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: timezone,
  });
  const formatDate = (iso: string) => dateFmt.format(new Date(iso));

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('tableTitle')}</CardTitle>
            {needsResponse > 0 ? (
              <Badge variant="warning" dot>
                {t('needsResponse', { count: needsResponse })}
              </Badge>
            ) : (
              <Badge variant="default">{disputes.length}</Badge>
            )}
          </CardHeader>
          <CardBody>
            {disputes.length === 0 ? (
              <EmptyState
                icon={<ShieldAlert className="h-6 w-6" />}
                title={t('empty.title')}
                description={t('empty.description')}
                className="border-0 bg-transparent shadow-none"
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="px-3 py-3 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                        {t('columns.opened')}
                      </th>
                      <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tabular-nums tracking-wide text-text-muted">
                        {t('columns.amount')}
                      </th>
                      <th className="px-3 py-3 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                        {t('columns.reason')}
                      </th>
                      <th className="px-3 py-3 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                        {t('columns.status')}
                      </th>
                      <th className="px-3 py-3 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                        {t('columns.evidenceDue')}
                      </th>
                      <th className="px-3 py-3 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                        {t('columns.appointment')}
                      </th>
                      <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tabular-nums tracking-wide text-text-muted">
                        {t('columns.link')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {disputes.map((d) => {
                      const reasonLabel = safeT(t, `reasons.${d.reason}`, d.reason);
                      const statusLabel = safeT(t, `statuses.${d.status}`, d.status);
                      return (
                        <tr key={d.id} className="border-b border-border last:border-b-0">
                          <td className="px-3 py-3 text-text-secondary">
                            {formatDate(d.created_at)}
                          </td>
                          <td className="px-3 py-3 text-right font-semibold tabular-nums text-text-primary">
                            {fmtCAD(d.amount_cents)}
                            {d.currency !== 'cad' ? (
                              <span className="ml-1 text-[11px] uppercase text-text-muted">
                                {d.currency}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-3 text-text-primary">{reasonLabel}</td>
                          <td className="px-3 py-3">
                            <Badge variant={statusTone(d.status)} dot>
                              {statusLabel}
                            </Badge>
                          </td>
                          <td
                            className={`px-3 py-3 ${evidenceDueClass(d.evidence_due_by, d.status)}`}
                          >
                            {d.evidence_due_by
                              ? formatDate(d.evidence_due_by)
                              : t('evidenceDue.none')}
                          </td>
                          <td className="px-3 py-3">
                            {/* The calendar drawer opens from client-side
                                state (clicking a block), not a URL param,
                                so there's no working deep-link to a single
                                appointment. Surface whether one is attached
                                — the actionable affordance is the Stripe
                                link in the next column. */}
                            {d.appointment_id ? (
                              <span className="text-text-secondary">{t('appointment.linked')}</span>
                            ) : (
                              <span className="text-text-muted">{t('appointment.none')}</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            <a
                              href={`https://dashboard.stripe.com/disputes/${d.stripe_dispute_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-accent transition-colors duration-150 ease-out-quint hover:text-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                            >
                              {t('link.stripe')}
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

/**
 * Map a Stripe dispute `status` to a Badge tone. Inline (not a `lib/`
 * module) to stay surgical — mirrors the local-helper convention of
 * the sibling finances pages. The fallback (`default`) covers any
 * future enum Stripe adds before we map it.
 */
function statusTone(status: string): BadgeVariant {
  switch (status) {
    case 'needs_response':
    case 'warning_needs_response':
      return 'warning';
    case 'under_review':
    case 'warning_under_review':
      return 'info';
    case 'won':
      return 'success';
    case 'lost':
      return 'danger';
    case 'charge_refunded':
    case 'warning_closed':
    default:
      return 'default';
  }
}

/**
 * Urgency coloring for the evidence-due cell. Danger once the deadline
 * is past, warning when it's within 72h and the dispute still needs a
 * response, muted otherwise. A resolved dispute (won/lost/refunded)
 * carries no urgency even if a stale due date lingers on the row.
 */
function evidenceDueClass(evidenceDueBy: string | null, status: string): string {
  if (!evidenceDueBy) return 'text-text-muted';
  const needsAction = status === 'needs_response' || status === 'warning_needs_response';
  if (!needsAction) return 'text-text-secondary';
  const due = new Date(evidenceDueBy).getTime();
  const now = Date.now();
  if (due < now) return 'font-semibold text-danger';
  if (due - now < 72 * 60 * 60 * 1000) return 'font-semibold text-warning';
  return 'text-text-secondary';
}

/**
 * next-intl throws on a missing key in dev, but reason/status come from
 * a Stripe enum that may drift ahead of our maps. Fall back to the raw
 * value instead of crashing the page on an unmapped future enum.
 */
function safeT(t: (key: string) => string, key: string, fallback: string): string {
  try {
    const value = t(key);
    // On a miss next-intl returns the dotted key path (which ends with
    // the key we passed) instead of a label; treat that as a miss too.
    return value && !value.endsWith(key) ? value : fallback;
  } catch {
    return fallback;
  }
}
