# Sentry auto-fix cron — operator runbook

Daily GitHub Actions workflow that pulls yesterday's unresolved Sentry issues, runs Claude Code headless against them, and opens one PR per fix. The operator (you) reviews + merges. The whole loop runs on your Claude Pro/Max subscription via OAuth — **zero Anthropic API cost**.

Components:

| Piece                                           | What it does                                                                                                                                        |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/scripts/fetch-sentry-issues.mjs`       | Queries Sentry REST API, formats a markdown briefing.                                                                                               |
| `.github/workflows/sentry-autofix.yml`          | Daily cron at **09:00 UTC** (≈ 05:00 ET). Runs the script, feeds the briefing to `anthropics/claude-code-action@v1`, lets Claude open PRs via `gh`. |
| `app/admin/sentry-autofix/page.tsx`             | Read-only super-admin page listing PRs labeled `sentry-autofix`, with state badges + links to GitHub + Sentry.                                      |
| Manual review via the standard GitHub PR flow   | You stay in the loop — nothing reaches `main` without your merge click.                                                                             |

## Secrets to create (one-time)

All three live under repo **Settings → Secrets and variables → Actions**.

### 1. `CLAUDE_CODE_OAUTH_TOKEN`

The token that proves the action runs on YOUR Claude Pro/Max subscription. Generate it on your local machine:

```bash
claude setup-token
```

This opens a browser. After OAuth, the CLI prints a token — **copy it immediately, you won't see it again.** Paste it into the repo secret named exactly `CLAUDE_CODE_OAUTH_TOKEN`.

Validity: 1 year. Rotate before expiry by running `claude setup-token` again.

> ⚠️ Important: the workflow explicitly clears `ANTHROPIC_API_KEY` so even if it's set elsewhere it can't reroute the action through the paid API. Leave the OAuth path as the only auth surface.

### 2. `SENTRY_AUTH_TOKEN`

A Sentry user auth token with the scopes the script needs. Create one at:

> https://kua.sentry.io/settings/account/api/auth-tokens/

Scopes required:

- `event:read` — to list issues + fetch stack traces
- `org:read` — to resolve the org

You can REUSE the same token you used for source-map upload in the Vercel deploy, but a separate token with a narrower scope is cleaner (revoking the cron's token won't break deploys).

### 3. `KUA_GITHUB_TOKEN`

A fine-grained GitHub PAT that lets the admin page list PRs server-side. Create one at:

> https://github.com/settings/personal-access-tokens/new

Recommended fine-grained PAT settings:

- **Repository access**: only `Wrivard/kua-coif`
- **Permissions**:
  - Pull requests: **Read-only**
  - Metadata: **Read-only** (auto-granted)

This token is read-only — it can list PRs but can't push, merge, or close anything. Paste into the Vercel env var named `KUA_GITHUB_TOKEN`. Without it, the admin archive page renders a setup hint instead of crashing.

## Triggering a manual run (smoke test)

Once the secrets are in place:

1. **Actions tab** → **Sentry · daily auto-fix** workflow → **Run workflow** button → pick the branch and click **Run**.
2. Watch the steps:
   - `Fetch Sentry issues → briefing` should print `Got N issue(s).` or `NO_ISSUES`.
   - `Run Claude Code (subscription auth)` runs only when there ARE issues; otherwise it's skipped.
3. If a PR was opened, you'll see it in:
   - **GitHub Pull Requests** list (label: `sentry-autofix`)
   - **Küa admin** → **Auto-fix archive** page (`/admin/sentry-autofix`)
4. Briefing artifact is preserved 30 days under the run's **Artifacts** for debugging.

## Customizing scope

The workflow's `workflow_dispatch` inputs let you override on a per-run basis:

- `sentry_query` — any Sentry issue search string. Examples:
  - `is:unresolved firstSeen:-24h` (default)
  - `is:unresolved level:error times_seen:>10` (only repeat-offender errors)
  - `is:unresolved tags.layer:stripe-webhook` (only webhook bugs)
- `fetch_limit` — cap issues per run. Default 5. Bump to 10 if your team trusts the agent and wants more throughput, drop to 1–2 while you're still validating the loop.

For the scheduled cron, edit `.github/workflows/sentry-autofix.yml`:

- `cron: '0 9 * * *'` — change the time (UTC).
- `env: SENTRY_QUERY` and `SENTRY_FETCH_LIMIT` — change the defaults applied to scheduled runs.

## Failure modes + how to debug

| Symptom                                                       | Cause                                                                                                                 | Fix                                                                                              |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `SENTRY_AUTH_TOKEN secret is missing`                         | Secret not set                                                                                                        | Add it (above)                                                                                   |
| `Sentry API 401`                                              | Token expired or wrong scopes                                                                                         | Regenerate with `event:read` + `org:read`                                                        |
| `Claude action: rate limit`                                   | Subscription quota burned by concurrent interactive use                                                               | Wait or reduce `fetch_limit`. Quota resets daily.                                                |
| PR opened but CI red                                          | Agent skipped a gate or fix doesn't compile                                                                           | Treat it like a normal PR review — request changes or close. Sentry issue stays unresolved.      |
| Admin page shows "KUA_GITHUB_TOKEN not set"                   | The Vercel env var is missing                                                                                         | Add `KUA_GITHUB_TOKEN` to Vercel env (Production + Preview)                                      |
| Same issue opens a PR every day                               | Agent's fix didn't actually resolve the Sentry issue group                                                            | Either close the PR and resolve the Sentry issue manually, or improve the briefing's mission text |

## Loi 25 note

The cron runs in GitHub-hosted runners (US). The briefing it produces contains Sentry issue payloads — which have already been PII-scrubbed by the `beforeSend` hook (see `lib/observability/sentry-scrub.ts`). So no raw customer data flows through this pipeline; only error metadata + stack traces + hashed user IDs.
