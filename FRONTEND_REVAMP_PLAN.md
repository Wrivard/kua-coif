Verified. `CardTitle` is `text-sm` (card.tsx:40), `CardHeader`/`CardBody` are both `px-6 py-6` (card.tsx:29,50), `PageHeader` title is `display-sm` with a static `border-b border-border` (page-header.tsx:27,35), the radius scale tops at `xl`/16px with **no `2xl`** (tailwind.config.ts:52-60), and `warm-*` shadows + `accent-glow` exist while `shadow-accent-md`/`shadow-modal` do not. Atmosphere/reveal tokens are absent. Everything in the critique checks out. Here is the final plan.

---

# kua-coiffure â€” Front-End Revamp Plan (Authoritative)

> **Direction:** bold Vercel / Linear / top-agency. The token foundation is already premium; the screens under-deploy it. This plan converts the existing *vocabulary* into a *lived language*. Boldness lands on **type, contrast, depth, and motion** â€” not on rationing the brand color. Data density and daily usability survive the beautification: dense admin grids stay scannable; the public/auth surfaces go boldest.
>
> **Canonical-tree note (binding):** all citations below are pinned against the real tree. The co-located feature files live at `app/[locale]/(app)/*` and `app/[locale]/book/[shopSlug]/*` â€” **not** `components/features/*`. Every grep/audit during execution MUST exclude `.oryon/**` and `.claude/worktrees/**` (mirror copies that inflate counts and hold stale lines). Verified ground truth: em-dashes = **40 `en.json` / 39 `fr.json` = 79** (not 118); `CardTitle` = `text-sm` (`components/ui/card.tsx:40`); `CardHeader`/`CardBody` = `px-6 py-6` (`card.tsx:29,50`); `PageHeader` title = `text-display-sm`, static bottom border (`components/ui/page-header.tsx:27,35`); radius scale tops at `xl`=16px, **no `2xl`** (`tailwind.config.ts:52-60`); `warm-{sm,md,lg}` + `accent-glow` exist, `shadow-accent-md`/`shadow-modal` do not (`tailwind.config.ts:73-86`).
>
> **DONE â€” do not redo, make the rest match:** Sidebar (`components/ui/sidebar.tsx`), DataTable (`components/ui/data-table.tsx`).

---

## 0. GLOBAL CONTRACTS (set in Step 0, enforced every step)

These are not a final-sweep cleanup. They are constraints every subsequent step obeys, with a per-step acceptance gate.

**C1 â€” One motion system.** **GSAP for all page-load reveals** (project already ships `gsap` + `@gsap/react`/`useGSAP`), wrapped in `gsap.matchMedia()` for `prefers-reduced-motion`. **CSS keyframes only** for always-present component transitions (toast / modal / dropdown / popover enter+exit). There is no CSS `.stagger-children` nth-child ladder â€” it is brittle and caps at 6; deleted from this plan.

**C2 â€” One radius contract.** Functional/small (buttons, inputs, chips, badges, menu rows): `rounded-md` (8px). Containers (cards, panels, table shells, drawers): `rounded-lg` (12px). Hero surfaces (booking/auth sheets, KPI band, loyalty hero): `rounded-xl` (16px). **No `rounded-2xl`** â€” it is not in the scale. Raw `rounded` (4px) is banned on interactive elements.

**C3 â€” One table primitive.** Every grid reuses `components/ui/data-table.tsx` (faint dividers, anchored header, airy rows, tabular numerics). **No hand-rolled `border-border-soft` row tables.** The bespoke Services/barber-settings/commissions/finance grids are migrated onto DataTable (extend DataTable to support reorder + a `density` prop; see C7). Zebra is not introduced â€” faint dividers are the single table language.

**C4 â€” One hero-surface definition.** A "hero surface" is the `.surface-hero` utility (Â§2.2) on a `rounded-xl` container at the `shadow-warm-md` tier (the warm tier is the app's elevated tier). Consumed identically by the Finances KPI band, booking/auth sheets, settings landing headers, the `/me` loyalty panel, and `EmptyState`. There is no separate `Card tone="hero"` concept and no competing shadow tier for heroes.

**C5 â€” Atmosphere is NEUTRAL, never accent.** The ambient wash is keyed off the warm-shadow espresso tone (or a near-black radial at ~2â€“3%) and the dot-grid â€” **never the purple accent.** A low-opacity purple radial on white is still "AI purple gradient on white"; it is banned. Purple is for **beats** (active/live/selected/now + one hero metric), never for **fields/washes**.

**C6 â€” Accent is systematic + one hero beat.** The accent appears on **every** active / live / selected / now / connected state (matching the sidebar), **plus exactly one loud hero beat per screen** (the lead metric, the primary CTA, the now-line). This is many coherent purple touchpoints with one dominant one â€” bold, not grey, not one-and-done.

**C7 â€” Two density tiers (density survives).** `comfortable` (CRUD lists, finance tables): generous `py-3.5`/`py-4` rows, larger controls. `compact` (settings matrices, commission grid, calendar lanes): tight `py-2`/`py-2.5`, standard controls. DataTable gets a `density` prop. The "airier rows" instinct applies only to `comfortable`. The toggle bump (Â§2.6) applies to `comfortable`; matrices keep the current toggle footprint.

**C8 â€” Dark + light shipped together.** Every new token ships BOTH `:root` and `:root[data-theme='dark']` values **in the same commit**. Every step's `npm run build` gate includes a dark-theme visual pass on the touched surface. No "mirrors later."

**C9 â€” Zero em-dashes in visible strings.** Enforced by CI (Step 1). Empty cells use the `<EmptyCell/>` primitive (Â§2.6), never a bare glyph.

**C10 â€” Nativeâ†’custom control swaps gate on no-regression.** Any replacement of native `<select>`/`type=date`/`type=time` MUST: be built on **Radix** (a11y inherited â€” keyboard nav, focus trap, `aria-activedescendant`, SR labels), support **type-ahead**, add **no click latency**. High-frequency native controls that are already fine (shop-hours `type=time` grid) keep native and get *styled chrome only*. This is the highest-risk item in the plan â€” treat it as such.

**Acceptance criteria are mandatory.** Every roadmap step states a one-line *visible step-change test* ("a stranger can read appointment status at a glance from 2m"). If the change is invisible at arm's length, it failed â€” the owner already rejected micro-polish.

---

## 1. REVAMP DESIGN PRINCIPLES

### 1.1 Type hierarchy â€” the #1 lever

Three on-screen tiers always present; never collapse to a flat 14px field.

| Role | Token / class | Rule |
|---|---|---|
| Page title | `.type-page-title` = `text-display-md` (30px); `hero` variant â†’ `text-display-lg/xl` for booking, auth, finances/settings landings | One per screen. Always paired with an eyebrow. |
| Section title | `.type-section-title` = `text-display-sm` (24px) | Real headings, not 14px `CardTitle`. |
| Eyebrow / overline | `.type-eyebrow` = `text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted` | Above every page/section title â†’ two-line lockup. |
| Hero metric | `.type-metric` = `font-mono tabular-nums tracking-tight` + display size | All lead KPIs, totals, balances. |
| Body / dense labels | `text-sm` / `text-xs uppercase` | Stays dense. Pro tool. |

- **DO** render every *meaningful* number (money, durations, counts, %, times) in `font-mono tabular-nums`.
- **DO** migrate the ~30 raw `text-2xl/3xl` heading uses to display tokens.
- **DO NOT** use `font-weight: 700` â€” system caps at 600 (baked into display tokens; Vercel rule).
- **DO NOT** leave a screen whose largest type is the 24px page title with everything else at 14px.
- **Scale contrast is the bold move:** a lead metric should *dwarf* its supporters (e.g. `display-xl` 48px lead vs `display-sm` 24px supporters), never four equal numbers.

### 1.2 Color / accent â€” systematic beats (see C6)
- Dominant neutrals; purple is systematic on state + one hero beat per screen.
- Accent = the active-state mechanism (left location bar / dot / fill), matching the sidebar.
- **No purple wash, no second saturated chrome color** (kill the green FAB).
- Status colors semantically distinct and consistent across all views (calendar Â§3.4).

### 1.3 Depth â€” layered shadow, not hairlines
Elevation ladder (enforced):
- Resting chrome / dividers â†’ `border-soft` (0.04) / `border-faint` (0.025) / `shadow-border`.
- Cards (real elevation only) â†’ `shadow-sm`.
- Dropdowns / popovers / menus â†’ `shadow-warm-md`.
- Drawers / toasts â†’ `shadow-warm-lg`.
- Modals â†’ `shadow-modal` (deepest; new token Â§2.1).
- `border-strong` reserved to anchor major section breaks + sticky table headers.
- **Per-row `border-b border-border` is banned** (use DataTable faint dividers).

### 1.4 Spacing / rhythm
- Page padding scales: `p-6 md:p-8 lg:p-10`. Kill the uniform `p-6` default.
- Group with space + a single faint divider, not boxes. Cards only when elevation communicates real hierarchy.
- Asymmetric rhythm: more space *above* a heading (`mt-10`) than below (`mt-4`).
- Settings/detail forms â†’ two-column row (label+description left ~280px, controls right), Linear/Vercel style.

### 1.5 Motion â€” choreography (see C1)
- Every screen: GSAP page-load reveal of **structural blocks only** (masthead â†’ toolbar â†’ stat strip â†’ table *container*), staggered 50â€“60ms, `power3.out`/`expo.out`. **Never per-row/per-cell.**
- Tactile `active:scale-[0.97]` on every button/row/trigger.
- Refined hover: perceptible lift + shadow step (not 0.5px); `shadow-accent-glow` on primary-action hover.
- All reveals inside `gsap.matchMedia()` honoring `prefers-reduced-motion`.
- Component transitions (toast/dropdown/modal) need **enter AND exit** â€” no instant unmount.

### 1.6 Atmosphere (see C4, C5)
- Promote radial-glow + dot-grid to reusable utilities (`.bg-texture-dots`, `.bg-hero-glow` â€” **neutral/warm, not accent**, Â§2.2).
- Deploy on anchor surfaces only: hero/KPI bands, empty-state panels, calendar canvas behind columns, settings/finances/auth/booking landing headers. Tables stay clean.

### 1.7 Copy hygiene (hard constraint, see C9)
- Zero em-dashes in visible strings (79 total). CI guard scoped to `messages/*.json`, excluding `.oryon/**` + `.claude/worktrees/**`.
- Empty cells â†’ `<EmptyCell/>` (localized "Aucun"/"None" for semantic cells; nothing rendered for numeric blanks). No bare middot.
- All visible strings via `next-intl` (fix hardcoded EN in `confirm-dialog.tsx`, reviews, detail drawer).

### 1.8 States (full set â€” see C contracts)
Every list/grid/form surface specifies all four: **empty**, **loading skeleton**, **error** (failed load/mutation/conflict, with retry), **success**. Error is a first-class surface, not polish â€” add an error variant to `EmptyState`, a `danger` toast with retry, and a form-level error-summary pattern.

---

## 2. FOUNDATION CHANGES (Steps 0â€“4 â€” the multiplier)

### 2.1 `globals.css` â€” new tokens (BOTH themes, same commit â€” C8)

```css
:root {
  /* Modal ambient â€” deepest surface in the app */
  --shadow-modal:
    rgba(0,0,0,0.10) 0 0 0 1px,
    rgba(0,0,0,0.12) 0 12px 24px,
    rgba(0,0,0,0.08) 0 28px 48px -16px;

  /* Accent BEAT elevation â€” the ONE hero beat per screen (C6).
     Used on the lead KPI panel / primary live surface, never as a field. */
  --shadow-accent-md:
    rgba(139,92,246,0.20) 0 0 0 1px,
    rgba(139,92,246,0.10) 0 4px 12px -2px,
    rgba(139,92,246,0.06) 0 12px 24px -8px;

  /* NEUTRAL/warm ambient â€” atmosphere (C5). Keyed off espresso warm tone. */
  --hero-glow: rgba(40,30,24,0.05);     /* warm near-black, light theme */
  --texture-dot: rgba(0,0,0,0.05);
}
:root[data-theme='dark'] {
  --shadow-modal:
    rgba(0,0,0,0.40) 0 0 0 1px,
    rgba(0,0,0,0.50) 0 12px 24px,
    rgba(0,0,0,0.40) 0 28px 48px -16px;
  --shadow-accent-md:
    rgba(139,92,246,0.30) 0 0 0 1px,
    rgba(139,92,246,0.18) 0 4px 12px -2px,
    rgba(139,92,246,0.10) 0 12px 24px -8px;
  --hero-glow: rgba(255,240,225,0.04);  /* warm light radial on near-black */
  --texture-dot: rgba(255,255,255,0.04);
}
```

### 2.2 `globals.css` â€” atmosphere + hero utilities (`@layer components`)

```css
@layer components {
  .bg-texture-dots {
    background-image: radial-gradient(var(--texture-dot) 0.75px, transparent 0.75px);
    background-size: 16px 16px;
  }
  /* NEUTRAL/warm radial â€” NO accent (C5) */
  .bg-hero-glow {
    background-image: radial-gradient(60% 60% at 50% 0%, var(--hero-glow) 0%, transparent 70%);
  }
  .surface-hero {            /* the single hero-surface (C4) */
    @apply relative rounded-xl bg-bg-surface shadow-warm-md overflow-hidden;
  }
}
```

### 2.3 `globals.css` â€” type conventions (`@layer components`)

```css
@layer components {
  .type-page-title    { @apply text-display-md text-text-primary; }
  .type-section-title { @apply text-display-sm text-text-primary; }
  .type-eyebrow       { @apply text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted; }
  .type-metric        { @apply font-mono tabular-nums tracking-tight; }
}
```

### 2.4 `globals.css` â€” component-transition keyframes only (C1)
- Keep/extend toast/modal/dropdown/popover enter **and exit** keyframes here. **No `.stagger-children`/`.animate-reveal`** (reveals are GSAP, Â§1.5). Body already sets `tabular-nums`; drop redundant per-cell `tabular-nums` opportunistically as files are touched.

### 2.5 `tailwind.config.ts`
- Register `shadow-modal` and `shadow-accent-md` in `boxShadow`.
- (Optional) expose `.bg-texture-dots` / `.bg-hero-glow` / `.surface-hero` via the existing plugin block alongside `shadow-border` for ergonomics.
- Do **not** add `rounded-2xl` (C2).

### 2.6 Shared primitive changes

**`card.tsx`** â€” `CardTitle` floor `text-sm` â†’ `text-base font-semibold tracking-tight` (`:40`); differentiate `CardHeader` `py-5` vs `CardBody` `py-6` for internal rhythm (`:29,50`); optional eyebrow slot. No hero variant (heroes use `.surface-hero`, C4).

**`page-header.tsx`** â€” title â†’ `.type-page-title` (display-md) with new `eyebrow` prop above (`:35`); `hero` variant â†’ display-lg; numeric subtitle â†’ `font-mono tabular-nums` (`:40`). Replace the static `border-b border-border` (`:27`) with a **CSS-only** sticky-shadow: a sentinel + `IntersectionObserver` toggling `shadow-sm` (no scroll-handler â€” C/Â§5 risk). Structure the actions slot: divider between secondary groups and the single primary CTA.

**`button.tsx`** â€” add `asChild` (Radix Slot) so export/download `<a>` share the Button recipe (kills the rogue `<a rounded-sm border>` toolbars on all four CRUD screens); danger hover â†’ darker red token + red-tinted glow ring; spinner scales with size.

**`<EmptyCell/>` (new, `components/ui/empty-cell.tsx`)** â€” renders `text-text-disabled` localized "Aucun"/"None" for semantic cells, `null` for numeric blanks. The single empty-cell vocabulary (C9). Replaces every visible `â€”` placeholder.

**Form primitives (`input.tsx`, `select.tsx`, `search-bar.tsx`, `money-input.tsx`, `percent-input.tsx`, `phone-input.tsx`)** â€” extract one shared `fieldBase` (rest/hover/focus/invalid) so all controls inherit identically. Resting edge: inputs inside cards fill `bg-bg-base` (read as cut-in wells against `bg-surface`); resting ring â†’ `shadow-border-strong`. **Add hover** (none today). Invalid â†’ faint `danger-subtle` wash + trailing alert icon, not only a ring. `$`/`%` glyphs in `font-mono text-text-secondary`; drop the hard internal hairline for a recessed `bg-surface` shoulder.

**`toggle.tsx`** â€” knob `bg-white` â†’ `bg-accent-fg` (theme-correct); `comfortable` size `h-7 w-12` with inner knob shadow; `compact` keeps current footprint (C7); real `disabled` variant (kills the hand-rolled disabled span in notifications).

**`checkbox.tsx` / `radio-group.tsx`** â€” hover ring on unchecked, `active:scale-95`, animate check/dot in with scale+opacity.

**`select.tsx` + `date-range-picker.tsx` + `time-range-select.tsx`** â€” highest structural win, **Radix-backed** (C10): replace native `<select>` and `type=date` with a Combobox/Select rendering a `bg-elevated` `shadow-warm-md` `rounded-md` panel, 6px option rows, `accent-subtle` active highlight, leading check on selected, **type-ahead**. `TimeRangeSelect` inherits. Remove the em-dash separator in `date-range-picker.tsx`. **Shop-hours `type=time` Ã—14 stays native, styled chrome only** (C10 / Â§5).

**`toast.tsx`** â€” tinted status surface (`bg-{kind}-subtle`), stronger colored rail, thin auto-dismiss progress bar, **exit transition**, icon in tinted halo, `shadow-warm-lg`. Add explicit `danger` variant with a **retry action slot** (error surface, Â§1.8).

**`modal.tsx` / `drawer.tsx`** â€” titles â†’ `text-xl`/display-sm; modal uses `shadow-modal`; GSAP staggered body reveal on open; `active:scale-[0.97]` on triggers.

**`tabs.tsx`** â€” underline â†’ `border-border-soft`; active indicator â†’ **accent bar + accent text**; active count pill â†’ `bg-accent-subtle text-accent`.

**`section-switcher.tsx`** â€” drop per-row hairlines; space + hover-fill; active row â†’ accent left-rail/check; `rounded` â†’ `rounded-md`; fade/scale enter+exit.

**`empty-state.tsx`** â€” title â†’ display-sm; larger halo + accent glow; optional `.bg-texture-dots` behind icon; add **`error`/`empty-with-error` variant** (icon, message, retry button) â€” Â§1.8. This is the single empty/error state used everywhere.

**`skeleton.tsx`** â€” ship a family: `Skeleton.Text` (line-count, shorter last line), `Skeleton.Circle`, `Skeleton.Row` (matches DataTable rhythm); `rounded` â†’ `rounded-md`.

**`confirm-dialog.tsx`** â€” remove hardcoded EN `'Confirm'/'Cancel'`; require translated labels; destructive variant leads with a danger-tinted icon halo.

**`fab-buttons.tsx`** â€” collapse the two saturated circles to ONE neutral-surface support pill (expand on hover); drop the green; `shadow-md` + `active:scale-95`; hidden where POS/support aren't real V1 actions.

---

## 3. PER-SURFACE SPECS

### 3.1 App shell / chrome
- **PageHeader masthead** (Â§2.6): eyebrow + display-md title, mono subtitles, IntersectionObserver sticky-shadow, structured actions.
- **Authenticated frame** (`app/[locale]/(app)/layout.tsx`): GSAP reveal of structural blocks on route entry; faint `.bg-hero-glow` (neutral) behind the masthead band; tables stay clean.
- **FabButtons**: single neutral support pill, no green.
- **Mobile chrome** (`components/ui/mobile-sidebar.tsx`): hamburger â†’ `shadow-border` + `shadow-md` + `active` press; drawer brand lockup scaled to match desktop sidebar confidence.

### 3.2 Form/container primitives
All in Â§2.6. Net: inputs read as carved wells with hover; Select/Date are Radix popovers with type-ahead; toggles/checkboxes tactile; toasts (incl. danger/retry), modals, empty/error states, and skeletons become signature moments on the warm-elevation ladder.

### 3.3 Core CRUD (Products, Services, Clients, Barbers â€” `density: comfortable`)
- **Products stat strip** (`app/[locale]/(app)/products-client.tsx`): replace the muted `<p>` sentence with a **hierarchical** stat row â€” **Retail Value as the lead** (`.type-metric` at display-md, larger), Wholesale/Count/Low as smaller `display-sm` supporters; **Low Inventory promoted to a danger beat ONLY when >0**. Not four equal cards (C6 / slop tell).
- **Type hierarchy**: section/group headings `text-base font-semibold`; money/inventory in `.type-metric`; remove the flat-14px wall.
- **Toolbars**: route Export/Download through Button `asChild` (kills rogue `<a>` links on all four screens); divider between secondary and primary.
- **Clients Aâ€“Z bar** (`clients-client.tsx`): 27 bordered chips â†’ ONE segmented control surface (`shadow-border`, `rounded-lg`), borderless mono/uppercase letter cells, active = solid accent pill + soft glow, letters with zero clients dimmed.
- **Services table** (`services-client.tsx`): migrate the bespoke table onto **DataTable** with native reorder (extend DataTable â€” C3); lifted/shadowed dragged row.
- **Form modals**: group fields under `.type-eyebrow` section labels (Identity / Pricing / Inventory / Taxes) with soft dividers; name field full-width and weightier; tax checkboxes â†’ `accent-subtle` chip multi-select.
- **Barbers roster cell** (`barbers-client.tsx`): 32â€“36px avatar with ring, stronger name weight, muted secondary line (role/personnel). Reads as a roster of people.
- GSAP page-load stagger: toolbar â†’ stat strip â†’ table container.

### 3.4 Appointments calendar (hero surface, lowest score â€” `density: compact`)
Files: `app/[locale]/(app)/appointments-calendar.tsx`, `appointment-detail-drawer.tsx`.
- **Block redesign**: stronger tinted surface + **solid 3â€“4px status spine**; client name first (13â€“14px/600 tight); time range in mono tabular secondary line; service muted; payment/source as a small badge (not a floating 12px icon); perceptible hover (scale + shadow step) + crisp `:active`.
- **Status semantics** (the `statusToColor` map, ~`:172-186`): each status its own identity, reused across side-by-side / week / list â€” booked (neutral/info outline), confirmed (info/accent filled spine), **arrived (success â€” in-chair, pops most)**, completed (muted/settled + check), no_show (warning), cancelled (ghosted/struck).
- **Type anchor**: active date â†’ display-sm/md with tracked-uppercase weekday above; barber lane headers larger with avatar + count chip ("3 today").
- **View unification**: side-by-side / week / list under one calendar shell â€” same `shadow-warm-*` family, radius, block vocabulary; list view keeps DataTable density but adopts the status spine/badge.
- **Detail drawer**: **kill native `confirm()`** (~`:103,:123`) â†’ `ConfirmDialog`; strong header (client name display scale + status pill + mono time range); space-grouped sections; amount as a confident figure; move all hardcoded EN strings to next-intl.
- **Create/edit modals**: client search â†’ Radix combobox; services â†’ selectable tiles summing into a prominent "Total: 45 min"; replace native date/time + native checkboxes with app primitives; rhythm groups (client/barber, date/time, services).
- **Now-line**: crisp accent line + labeled mono time pill on the axis edge (the one hero beat, C6).
- **Motion**: GSAP staggered column-then-block-container reveal; crossfade on view switch (`gsap.matchMedia`, <400ms).
- **States**: composed closed-day / no-barbers / empty-day with CTA; **grid skeleton** (columns + ghost blocks) on load/refresh; **error state** on availability/load failure with retry.

### 3.5 Settings (most "cheap" â€” needs a bold moment, not a reskin)
- **Landing-grade masthead**: Settings gets the `hero` PageHeader variant (display-lg + eyebrow + neutral glow) â€” the bold moment the screen lacked.
- **De-card**: each section â†’ SECTION-HEADER pattern (`.type-section-title` + muted description, fields grouped by space + one faint top divider), **two-column row** layout. Real Cards/`.surface-hero` reserved for genuine objects: **Stripe Connect, loyalty/live widget preview, stat panels** â€” at least one settings surface (Loyalty or Payment) carries a real hero/preview panel.
- **Dense grids** (`barber-settings-client.tsx`, `commissions-client.tsx` â€” `density: compact`, C3/C7): migrate onto DataTable language; anchored sticky `border-strong` header; group barber-settings' 13 columns under spanning sub-headers (Booking / Reminders / Cancellation); `.type-metric` for $/% cells; **accent left bar on the "Shop default" row**. Density preserved (compact tier).
- **Settings sub-sidebar** (`components/ui/settings-sidebar.tsx`): match the main sidebar â€” **accent location bar on active item** (not grey fill), tighter group separation, `.type-section-title` "Settings" anchor on top, faint surface tint (master/detail read).
- **Accent system**: accent for live/connected/active badges (Stripe active, Twilio connected, loyalty enabled) instead of generic green; accent on active nav + the one hero metric per panel.
- **Real controls**: build the named Radix `TimeRangeSelect` (C10); styled color-swatch for accent fields (kills native `type=color` in widget settings); real disabled `Toggle` variant (kills the hand-rolled disabled span in notifications). **Shop-hours `type=time` Ã—14 stays native, styled** (C10).
- **Reviews screen** (`reviews-client.tsx`): route all strings through next-intl; replace `â˜…/â˜†` glyphs with lucide `Star` (filled/outline, warning/accent tint); adopt card-section + divider language.
- **Empty/loading/error**: `EmptyState` everywhere a list/grid is empty (reviews, waiting-list, commissions); staggered skeletons; error variant on failed load.
- **Em-dash sweep**: replace visible `â€”` placeholders via `<EmptyCell/>` (reviews, audit-log, promo-codes, notifications).
- **Mobile (C7)**: 13-column barber-settings grid â†’ per-barber stacked cards under `md` (the spec already mandates "tableaux â†’ cartes empilÃ©es sous md").

### 3.6 Finances (score 4 â€” `density: comfortable`)
Files: `app/[locale]/(app)/finances/page.tsx`, `today/*`, `disputes/page.tsx`.
- **KPI hero band**: pull the four KPIs out of individual Cards into ONE `.surface-hero` panel split by vertical hairlines; **lead metric (today's/gross revenue) genuinely large â€” `display-xl` 48px+ `.type-metric` with a `shadow-accent-md` beat**; supporting KPIs deliberately smaller (`display-sm`); tiny mono delta/context line under each. Real focal point, not four equal numbers (C6).
- **Revenue visualization** (none today): inline horizontal share-of-revenue bars behind by-barber and by-category rows (`accent-subtle` fill, width âˆ revenue/max); payment-status as a single segmented stacked bar (paid/unpaid/refunded, status colors) + legend.
- **Tables**: migrate onto DataTable (C3) â€” soft dividers, single strong header, `py-4`, mono currency.
- **Section grammar**: `.type-eyebrow` + `text-base/lg` titles; drop per-section Card envelopes; reserve elevation for KPI band + the cash-drawer expected-total close-out figure (large display + success/accent).
- **Date range filter**: replace native `type=date` with the Radix date control; active range echoed as a bold mono pill.
- **Disputes**: hero summary band (open disputes, total $ at risk in display scale, count needing response) with warning/danger accent when non-zero; "needs response" rows promoted with a warning left rail + mono deadline countdown.
- **Motion**: GSAP staggered reveal (KPI band first, then sections); atmosphere on the KPI band only.
- **Mobile (C7)**: KPI band â†’ 2-col stack, drop vertical hairlines.

### 3.7 Public / booking (shop window â€” go boldest)
Files: `app/[locale]/book/[shopSlug]/booking-wizard.tsx`, customer token pages (`me`, `reschedule`, `review`, `receipt`).
- **Shared `CustomerShell` layout** (token pages have none): reuse the auth/booking recipe â€” canvas + `.bg-hero-glow` (neutral) + `.bg-texture-dots` + centered container + KÃ¼a "K" mark + GSAP reveal. Lifts the three worst customer screens to booking parity with near-zero per-page churn.
- **De-card token pages** (`me-client.tsx`): drop most Cards, group with space + dividers; promote ONE element per page â€” on `/me`, the **loyalty balance as a hero panel** (`.surface-hero`, display-md/lg mono dollar figure, soft accent glow). Remaining surfaces standardize on `shadow-warm-sm/md`.
- **Type**: booking opens with shop name at `display-lg`/`xl` + tracked-uppercase eyebrow ("RÃ‰SERVATION EN LIGNE"); step titles â†’ display-md; all prices/slot times/totals in `.type-metric`.
- **Booking progress**: anonymous dashes â†’ labeled stepper (Service Â· Pro Â· Heure Â· Infos) with active in accent + thin connecting track, or a `2/5` mono beat.
- **Tip selector**: rebuild to slot/date language â€” `rounded-lg`, `shadow-warm-sm`, `ease-out-quint`, hover lift, selected = `bg-accent text-accent-fg shadow-accent-glow`. It's a revenue moment; make it tactile.
- **Barber availability copy**: show real next-slot or a true detail (role/specialty) â€” no fabricated "available today" string.
- **Em-dash placeholders** on receipt/reschedule: hide the line when value absent, or `<EmptyCell/>`.

### 3.8 Auth
- One `AuthCard` recipe (`rounded-xl` + `shadow-warm-lg` + `bg-bg-surface`) applied to all four pages (login currently `rounded-xl/shadow-xl`, others `rounded-lg/shadow-lg` â€” inconsistent).
- Headings â†’ display-md + eyebrow; GSAP card fade+rise entrance.
- Normalize alerts to `rounded-lg` + status-subtle bg + warm shadow (currently bare 4px `rounded` on forgot/setup/reset).

### 3.9 Review submission page
- Replace `â˜…â˜…â˜…â˜…â˜…` text (`review-form-client.tsx`) with the existing `StarRating` (lucide `Star`, warning-gold fill).
- Success state â†’ booking flow's glowing-ring `CheckCircle` celebration.
- Interactive stars larger + tactile (scale + gold-fill cascade on hover, reduced-motion-safe).

---

## 4. PRIORITIZED EXECUTION ROADMAP

Ordered by visible impact. Each is ONE cohesive shippable commit. `npm run build` + typecheck + **dark-theme visual pass on touched surface** (C8) gate every step; commit at each end. Every step carries its **visible step-change test**.

**DONE â€” do not redo, make rest match:** âœ… Sidebar (`components/ui/sidebar.tsx`) Â· âœ… DataTable (`components/ui/data-table.tsx`).

**Step 0 â€” Foundation unlock + global contracts** *(multiplier; sets C1â€“C10)*
`feat(design): atmosphere/reveal foundation, hero+accent+modal tokens, type conventions`
globals.css: `--shadow-modal`, `--shadow-accent-md`, neutral `--hero-glow`/`--texture-dot` (both themes), `.bg-texture-dots`, `.bg-hero-glow`, `.surface-hero`, `.type-*`, component enter/exit keyframes. tailwind.config: register new shadows. Establish GSAP reveal helper. Document the radius/table/hero/density contracts. Drop redundant `tabular-nums` opportunistically.
*Test: a teammate can apply a hero band + reveal on a scratch page using only the new utilities, no inline CSS.*

**Step 1 â€” Copy hygiene + CI guard** *(constraint, cheap, blocks regressions)*
`fix(i18n): purge em-dashes from visible strings + EmptyCell + CI guard`
Sweep `messages/{fr,en}.json` (79 em-dashes); ship `<EmptyCell/>`; fix hardcoded EN in confirm-dialog/reviews/detail-drawer; CI regex guard scoped to `messages/*.json`, **excluding `.oryon/**` + `.claude/worktrees/**`**.
*Test: CI fails on a planted em-dash in `en.json`; passes on the mirror dirs.*

**Step 2 â€” Card + PageHeader masthead** *(touches 40+ screens at once)*
`feat(chrome): masthead PageHeader + Card type/rhythm`
PageHeader eyebrow + display-md + mono subtitle + IntersectionObserver sticky-shadow + structured actions + `hero` variant; CardTitle floor, header/body rhythm.
*Test: every page now opens with a two-line eyebrow+display masthead, visible from across the room.*

**Step 3 â€” Shell motion + atmosphere + FAB**
`feat(shell): GSAP page-load reveal, neutral ambient depth, single support FAB`
Wrap `(app)/layout.tsx` content in GSAP structural-block reveal (matchMedia); neutral glow band behind masthead; collapse FABs to one neutral pill; mobile chrome depth.
*Test: route changes reveal mastheadâ†’content in a visible staggered cascade; reduced-motion shows instant.*

**Step 4 â€” Form/container primitives pass** *(unlocks every form + overlay)*
`feat(ui): Radix Select/Date popovers, field hover/edge, tactile toggles, warm overlay ladder`
Radix Select/Combobox + date popover with type-ahead (TimeRangeSelect inherits; shop-hours `type=time` stays native styled); shared `fieldBase` with hover + carved edge + designed invalid; toggle/checkbox/radio tactility (two density tiers); toast (tinted + progress + exit + danger/retry), modal `shadow-modal`, tabs accent-active, section-switcher, empty-state (+error variant), skeleton family, Button `asChild` + danger hover.
*Test: open any dropdown â€” it's a designed warm popover with keyboard type-ahead; an invalid field shows a wash + icon, not a 1px ring.*

**Step 5 â€” Calendar revamp** *(most-seen, lowest score)*
`feat(calendar): bold status-spine blocks, unified views, drawer, now-line, motion`
Block redesign + status-spine semantics across all views; type anchor + lane headers; drawer (kill native confirm, restructure, i18n); modals â†’ primitives; accent now-line; GSAP reveal + grid skeleton; composed empty/error states.
*Test: a stranger reads each appointment's status at a glance from 2m; arrived clearly pops.*

**Step 6 â€” CRUD screens**
`feat(crud): hierarchical stat strip, type hierarchy, unified toolbars, segmented A-Z, roster cells`
Products lead-metric stat strip (Low = danger beat only when >0); type hierarchy + mono numerics; Button-as-link toolbars; Clients segmented Aâ€“Z; Services â†’ DataTable parity + reorder; structured form modals; Barbers roster cell; GSAP stagger.
*Test: Products opens with a dominant Retail Value figure, not four equal cards.*

**Step 7 â€” Settings revamp**
`feat(settings): hero masthead, de-card sections, DataTable grids, accent nav, real controls`
Settings hero masthead + at least one hero/preview panel; two-column section pattern; barber-settings/commissions onto DataTable (compact) + grouped headers + accent shop row + mobile card collapse; sub-sidebar accent-active; TimeRange/color/disabled-toggle controls; reviews i18n + Star; EmptyState/error/skeletons; em-dash placeholder sweep.
*Test: Settings lands with a bold masthead + a live preview panel; the matrices stay dense.*

**Step 8 â€” Finances revamp**
`feat(finances): KPI hero band w/ dominant lead metric, revenue bars, table parity, disputes summary`
KPI hero band with `display-xl` lead + `shadow-accent-md` beat + smaller supporters; share-of-revenue bars + payment stacked bar; tables â†’ DataTable + mono currency; section grammar; Radix date range; disputes summary band + urgency rails; reveal + atmosphere on KPI band; mobile collapse.
*Test: the money screen has one unmistakable big number; revenue split is readable as bars without reading digits.*

**Step 9 â€” Public booking + token-page shell**
`feat(booking): CustomerShell, bold display type, labeled stepper, tactile tips, loyalty hero`
Shared `CustomerShell` for me/reschedule/review/receipt; de-card + loyalty hero on `/me`; booking display-lg/xl hero + eyebrow; labeled stepper; tactile tip selector; real availability copy; em-dash fixes.
*Test: `/book/[shop]` and `/me` look like a premium consumer product, not the admin in disguise.*

**Step 10 â€” Auth + review-submission polish**
`feat(auth): unified AuthCard + display headings; review stars + celebration`
One AuthCard recipe + display-md headings + GSAP entrance + normalized alerts; StarRating on review page + glowing success celebration.
*Test: all four auth screens share one card recipe and a bold heading; review page uses real gold stars.*

**Step 11 â€” Loading skeleton coverage** *(perceived performance)*
`feat(perf): structure-matched route loading.tsx`
Per-route `loading.tsx` for calendar grid, big DataTables, finances KPI+tables, settings forms using the Skeleton family; fade-in on real content land.
*Test: every heavy route shows a structure-matched skeleton, never a blank flash.*

**Step 12 â€” Final parity audit** *(audit only â€” consistency was enforced per-step)*
`chore(design): cross-surface parity + a11y/motion/theme audit`
Verify radius/shadow/table/hero contracts held; confirm all reveals are reduced-motion-guarded and all Radix controls pass keyboard + SR criteria; verify light + dark on every revamped surface. **No new inconsistency-fixing work should be needed** â€” this is verification, not cleanup.
*Test: a side-by-side of all surfaces shows one coherent radius/shadow/type/motion language in both themes.*

---

**Net trajectory:** Steps 0â€“4 are pure leverage (tokens + primitives + chrome + contracts) and visibly lift the *entire* app before any screen work. Steps 5â€“10 are the per-surface step-changes the owner will feel as "a different, expensive product" â€” led by the calendar (most-seen) and the settings/finances hero moments (the screens called cheapest). Steps 11â€“12 lock in perceived performance and verify the contracts that were enforced all along. Every step honors the dense-admin constraint via the two density tiers: boldness lands on type, depth, motion, and hero beats while the matrices stay scannable; the public/auth surfaces go furthest. The two genuine slop risks the draft carried â€” the purple ambient wash and four-equal stat cards â€” are designed out at the contract level (C5, C6), not left to chance.