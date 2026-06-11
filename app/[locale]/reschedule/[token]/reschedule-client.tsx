'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  addDays,
  combineShopDateTime,
  formatHeaderDate,
  formatShopTime,
  shopIsoDate,
} from '@/lib/business/timezone';
import { reschedulePublicAppointment } from './actions';

/**
 * Customer-facing reschedule UI — date strip + slot grid + Confirm.
 * Slots come from the same public availability API the booking wizard
 * uses; the action enforces the same checkAvailability() rules.
 */
export function RescheduleClient({
  locale,
  token,
  isTerminal,
  appointment,
  shop,
}: {
  locale: string;
  token: string;
  isTerminal: boolean;
  appointment: {
    id: string;
    startAt: string;
    endAt: string;
    durationMin: number;
    barberId: string;
    barberName: string;
    clientName: string | null;
  };
  shop: { slug: string; name: string; timezone: string };
}) {
  const isFr = locale === 'fr';
  const { show } = useToast();
  const today = useMemo(() => shopIsoDate(new Date(), shop.timezone), [shop.timezone]);
  const [date, setDate] = useState<string>(today);
  const [startTime, setStartTime] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  // Plan 037 (CORRECTNESS-03) — a failed fetch is NOT "no slots". Mirrors
  // plan 035's booking-wizard hardening so the two error states stay in sync.
  const [slotError, setSlotError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Load slots for the picked date.
  useEffect(() => {
    if (isTerminal || done) return;
    setSlots(null);
    setStartTime(null);
    setSlotError(false);
    setLoadingSlots(true);
    const ctl = new AbortController();
    // Slot fetch keyed to the SAME barber the appointment was booked
    // with — `barber=any` would surface slots from other barbers and
    // the server-side reschedule action would then refuse them (it
    // preserves the original barber). Self-review fix from Loop 13
    // double-check pass.
    fetch(
      `/api/book/${shop.slug}/slots?date=${date}&barber=${appointment.barberId}&duration=${appointment.durationMin}`,
      { signal: ctl.signal },
    )
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: { slots?: string[] }) => setSlots(data.slots ?? []))
      .catch(() => {
        // Aborts (fast date-switching, unmount) are silent — not a failure.
        if (ctl.signal.aborted) return;
        setSlotError(true);
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoadingSlots(false);
      });
    return () => ctl.abort();
  }, [
    date,
    shop.slug,
    appointment.durationMin,
    appointment.barberId,
    isTerminal,
    done,
    retryNonce,
  ]);

  // 14-day strip starting today.
  const days = useMemo(() => {
    const refDay = new Date(`${today}T12:00:00Z`);
    return Array.from({ length: 14 }, (_, i) => {
      const d = addDays(refDay, i);
      return shopIsoDate(d, shop.timezone);
    });
  }, [today, shop.timezone]);

  function submit() {
    if (!startTime) return;
    startTransition(async () => {
      const result = await reschedulePublicAppointment({
        token,
        new_date: date,
        new_start_time: startTime,
        // Plan 037 — the confirmation email ships in the page's language.
        locale: isFr ? 'fr' : 'en',
      });
      if (result.ok) {
        setDone(true);
        show({
          variant: 'success',
          title: isFr ? 'Rendez-vous déplacé !' : 'Appointment rescheduled!',
        });
      } else {
        show({
          variant: 'danger',
          title:
            result.errorCode === 'CONFLICT'
              ? isFr
                ? 'Ce créneau n’est plus disponible.'
                : 'This slot is no longer available.'
              : isFr
                ? 'Impossible de déplacer le rendez-vous.'
                : 'Could not reschedule.',
        });
      }
    });
  }

  if (isTerminal) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Card>
          <CardBody className="space-y-2 text-center">
            <p className="text-xl font-semibold tracking-tight text-text-primary">
              {isFr ? 'Rendez-vous non modifiable' : 'Appointment can no longer be changed'}
            </p>
            <p className="text-sm text-text-secondary">
              {isFr
                ? `Contacte ${shop.name} pour toute modification.`
                : `Contact ${shop.name} for any change.`}
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (done) {
    // Plan 037 (CORRECTNESS-05) — format the new slot like the
    // current-appointment line ("17 juin · 14:30"), not raw ISO. date +
    // startTime are shop-local; combineShopDateTime maps them to the right
    // instant regardless of the visitor's browser timezone.
    const newInstant = startTime ? combineShopDateTime(date, startTime, shop.timezone) : null;
    const formattedNew = newInstant
      ? `${formatHeaderDate(newInstant, isFr ? 'fr' : 'en', shop.timezone)} · ${formatShopTime(
          newInstant.toISOString(),
          shop.timezone,
          'HH:mm',
        )}`
      : '';
    return (
      <div className="mx-auto max-w-lg p-6">
        <Card>
          <CardBody className="space-y-3 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
            <p className="text-xl font-semibold tracking-tight text-text-primary">
              {isFr ? 'C’est fait !' : 'Done!'}
            </p>
            <p className="text-sm text-text-secondary">
              {isFr
                ? `Tu recevras une confirmation par courriel pour le nouveau créneau (${formattedNew}).`
                : `You'll receive an email confirmation for the new slot (${formattedNew}).`}
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  const formattedCurrent = `${formatHeaderDate(
    new Date(appointment.startAt),
    isFr ? 'fr' : 'en',
    shop.timezone,
  )} · ${formatShopTime(appointment.startAt, shop.timezone, 'HH:mm')}`;

  return (
    <div className="mx-auto max-w-lg space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>{isFr ? 'Déplacer ton rendez-vous' : 'Reschedule your appointment'}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="space-y-1 text-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              {isFr ? 'Rendez-vous actuel' : 'Current appointment'}
            </p>
            <p className="text-text-primary">{formattedCurrent}</p>
            <p className="text-xs text-text-muted">
              {isFr ? 'Avec' : 'With'} {appointment.barberName} · {appointment.durationMin} min
            </p>
          </div>

          {/* Date strip — 14 days. */}
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              {isFr ? 'Nouvelle date' : 'New date'}
            </p>
            <div className="-mx-2 flex gap-2 overflow-x-auto px-2 pb-2">
              {days.map((d) => {
                const active = d === date;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDate(d)}
                    className={cn(
                      'flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-lg border shadow-sm transition-all duration-150 ease-out-quint focus:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                      active
                        ? 'border-accent bg-accent text-accent-fg shadow-accent-glow'
                        : 'border-border bg-bg-base text-text-primary hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md',
                    )}
                  >
                    <span className="text-[10px] font-medium uppercase tracking-wide">
                      {new Date(`${d}T12:00:00Z`).toLocaleDateString(isFr ? 'fr-CA' : 'en-CA', {
                        weekday: 'short',
                        timeZone: shop.timezone,
                      })}
                    </span>
                    <span className="text-lg font-semibold tracking-tight">
                      {new Date(`${d}T12:00:00Z`).toLocaleDateString(isFr ? 'fr-CA' : 'en-CA', {
                        day: 'numeric',
                        timeZone: shop.timezone,
                      })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Slot grid */}
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              {isFr ? 'Nouvelle heure' : 'New time'}
            </p>
            {loadingSlots ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 rounded-lg" />
                ))}
              </div>
            ) : slotError ? (
              // Plan 037 (CORRECTNESS-03) — a fetch failure offers a retry
              // instead of masquerading as "no slots".
              <div className="space-y-3">
                <p className="rounded-lg border border-border bg-bg-base p-4 text-center text-sm text-text-muted shadow-sm">
                  {isFr
                    ? 'Impossible de charger les disponibilités.'
                    : "Couldn't load availability."}
                </p>
                <div className="flex justify-center">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setRetryNonce((n) => n + 1)}
                  >
                    {isFr ? 'Réessayer' : 'Try again'}
                  </Button>
                </div>
              </div>
            ) : slots && slots.length > 0 ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slots.map((time) => {
                  const active = startTime === time;
                  return (
                    <button
                      key={time}
                      type="button"
                      onClick={() => setStartTime(time)}
                      className={cn(
                        'h-10 rounded-lg border text-sm font-medium shadow-sm transition-all duration-150 ease-out-quint focus:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                        active
                          ? 'border-accent bg-accent text-accent-fg shadow-accent-glow'
                          : 'border-border bg-bg-base text-text-primary hover:-translate-y-0.5 hover:border-accent/40 hover:bg-bg-surface-2 hover:shadow-md',
                      )}
                    >
                      {time}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-lg border border-border bg-bg-base p-4 text-center text-sm text-text-muted shadow-sm">
                {isFr
                  ? 'Aucun créneau disponible pour cette date.'
                  : 'No slots available for this date.'}
              </p>
            )}
          </div>

          <div className="flex justify-end pt-2">
            <Button onClick={submit} loading={isPending} disabled={!startTime}>
              {isFr ? 'Confirmer' : 'Confirm'}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
