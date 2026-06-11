import type { BadgeVariant } from './badge';
import type { AppointmentStatus } from '@/db/enums';

/**
 * Plan 040 (CAL-10) — THE canonical appointment status → Badge variant map.
 *
 * Three per-surface copies had drifted (no_show read as "needs attention"
 * on the grid but as a muted nothing in the day's List view). This map is
 * the single source for BADGE rendering — list view, client fiche, and any
 * future status chip. Semantics mirror the calendar's block fills
 * (`statusToColor` in appointments-calendar.tsx, which stays the one
 * calendar-specific variant because it maps to FILL classes, not badges):
 *
 *   booked    → info     (tentative, cool blue)
 *   confirmed → accent   (a locked-in yes, brand beat)
 *   arrived   → success  (in the chair right now)
 *   completed → success  (done and settled)
 *   cancelled → default  (terminal, muted)
 *   no_show   → warning  (needs attention / follow-up)
 */
export const APPOINTMENT_STATUS_VARIANT: Record<AppointmentStatus, BadgeVariant> = {
  booked: 'info',
  confirmed: 'accent',
  arrived: 'success',
  completed: 'success',
  cancelled: 'default',
  no_show: 'warning',
};
