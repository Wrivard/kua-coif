# Archive — historical snapshots

These files are **frozen at their dates** and are **not** current state. They
captured the codebase at a moment in time (audits, a design pivot, an executed
revamp plan) and are kept for provenance — many code comments still cite
"Phase N from AUDIT_PHASE70" and the like. Do **not** treat anything here as how
the system works today.

For the live, operational picture, read the root docs instead:

- **`CLAUDE.md`** — current-state agent brief + non-negotiable conventions.
- **`README.md`** — stack, local setup, first-login recipe.
- **`DEPLOY.md`** — deploy + disaster-recovery + secrets.
- **`DECISIONS.md`** — standing product/architecture decisions.
- **`plans/README.md`** — the living tracker for in-flight work.

## Contents

| File | What it was |
|---|---|
| `SPEC-original.md` | The original build spec (formerly `CLAUDE.md`). Its **ANNEXE — Partie 2 (SEED exact)** is still the authoritative reference for seed **values** (`supabase/seed.sql`). Everything else is superseded. |
| `AUDIT.md` | Early production-readiness audit (priorities P0/P1/P2). |
| `AUDIT_PHASE37.md` … `AUDIT_PHASE70.md` | Per-loop audit snapshots (baseline → loop 9). They cross-reference each other; all live in this folder. |
| `PHASES.md` | The phase/loop build ledger, relocated from `README.md`. |
| `FRONTEND_REVAMP_PLAN.md` | Frontend revamp plan — executed. |
| `vercel_DESIGN.md` | Input to the (completed) Vercel-style design pivot. |
