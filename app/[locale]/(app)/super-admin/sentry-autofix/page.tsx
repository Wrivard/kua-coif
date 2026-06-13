import Link from 'next/link';
import { CheckCircle2, CircleAlert, ExternalLink, GitPullRequest, XCircle } from 'lucide-react';
import { requireKuaAdmin } from '@/lib/auth/server';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { SuperAdminNav } from '@/components/ui/super-admin-nav';
import { captureException } from '@/lib/observability';

/**
 * Phase H+2 — auto-fix archive.
 *
 * Lists the PRs the daily Sentry cron has opened, with their current
 * state (open / merged / closed) and a link back to the originating
 * Sentry issue when the branch name follows the `autofix/sentry-<shortId>`
 * convention. Read-only — the owner reviews + merges via the GitHub
 * UI itself.
 *
 * Data source: GitHub REST API. We query the repo's PRs filtered by the
 * `sentry-autofix` label. No new Postgres table — GitHub IS the source
 * of truth for PRs and Sentry IS the source of truth for issues, so we
 * just stitch them at render time.
 *
 * Auth: a fine-grained GitHub PAT stored as `KUA_GITHUB_TOKEN` env var.
 * Scope: read-only access to `Wrivard/kua-coif` → Pull Requests. When
 * the var is missing we render a setup hint instead of crashing.
 */
export const dynamic = 'force-dynamic';

const REPO_OWNER = 'Wrivard';
const REPO_NAME = 'kua-coif';
const LABEL = 'sentry-autofix';

type GhUser = { login: string; avatar_url: string };
type GhLabel = { name: string };
type GhPr = {
  number: number;
  title: string;
  html_url: string;
  state: 'open' | 'closed';
  draft: boolean;
  merged_at: string | null;
  closed_at: string | null;
  created_at: string;
  body: string | null;
  user: GhUser | null;
  labels: GhLabel[];
  head: { ref: string };
};

async function fetchAutofixPrs(): Promise<{ prs: GhPr[]; error?: string }> {
  const token = process.env.KUA_GITHUB_TOKEN;
  if (!token) {
    return {
      prs: [],
      error:
        'KUA_GITHUB_TOKEN env var not set — see the secrets runbook in .github/workflows/sentry-autofix.yml',
    };
  }
  try {
    // GitHub's PR search syntax via the Issues Search endpoint (PRs ARE
    // issues with `type:pr`) — labels are filterable inline and we can
    // pull 100 in one call. Cheaper than per-PR fetches.
    const q = `repo:${REPO_OWNER}/${REPO_NAME} type:pr label:${LABEL}`;
    const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=50&sort=created&order=desc`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      // 30s GitHub cache so a refresh storm doesn't hit the API limit
      // (5000/hour authenticated, generous but bounded).
      next: { revalidate: 30 },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      items: Array<GhPr & { pull_request?: { merged_at: string | null } }>;
    };
    // Search results don't expand `merged_at` on the PR object itself;
    // it lives under `pull_request`. Flatten so the renderer doesn't
    // care.
    const prs: GhPr[] = json.items.map((p) => ({
      ...p,
      merged_at: p.pull_request?.merged_at ?? p.merged_at ?? null,
    }));
    return { prs };
  } catch (e) {
    captureException(e, { tags: { layer: 'admin', page: 'sentry-autofix' } });
    // SECRET-01 — the raw API body is in the thrown Error → Sentry above; the
    // UI gets a generic message (no internal detail leaked).
    return { prs: [], error: 'Could not load autofix pull requests.' };
  }
}

function prState(pr: GhPr): { label: string; variant: 'success' | 'default' | 'danger' | 'info' } {
  if (pr.merged_at) return { label: 'Merged', variant: 'success' };
  if (pr.state === 'closed') return { label: 'Closed', variant: 'danger' };
  if (pr.draft) return { label: 'Draft', variant: 'default' };
  return { label: 'Open', variant: 'info' };
}

function sentryLinkFromBranch(branch: string): string | null {
  // Convention: branch name = `autofix/sentry-<shortId>` per the
  // cron's prompt rules. shortId looks like JAVASCRIPT-NEXTJS-A1.
  const match = branch.match(/^autofix\/sentry-(.+)$/i);
  if (!match) return null;
  const shortId = match[1];
  return `https://kua.sentry.io/issues/?query=${encodeURIComponent(shortId ?? '')}`;
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (days === 0) {
    const hours = Math.round(diffMs / (60 * 60 * 1000));
    if (hours <= 0) return 'just now';
    return `${hours}h ago`;
  }
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

export default async function SentryAutofixPage() {
  await requireKuaAdmin();
  const { prs, error } = await fetchAutofixPrs();

  // Stats — useful at a glance.
  const stats = prs.reduce(
    (acc, p) => {
      const s = prState(p).label;
      acc.total += 1;
      if (s === 'Merged') acc.merged += 1;
      else if (s === 'Open' || s === 'Draft') acc.open += 1;
      else acc.closed += 1;
      return acc;
    },
    { total: 0, merged: 0, open: 0, closed: 0 },
  );

  return (
    <>
      <PageHeader
        title="Sentry auto-fix archive"
        subtitle="Daily cron 09:00 UTC · PR review via GitHub"
      />
      <SuperAdminNav />
      <div className="space-y-6 p-6">
        <p className="max-w-3xl text-sm leading-relaxed text-text-secondary">
          Le cron quotidien pull les Sentry issues non-résolues d&apos;hier, lance Claude Code en
          mode headless, et ouvre une PR par fix. Tu reviews + merges via GitHub. Cette page est ta
          fenêtre read-only sur ce qui a été tenté et ce qui a shippé. Workflow :{' '}
          <Link
            href={`https://github.com/${REPO_OWNER}/${REPO_NAME}/actions/workflows/sentry-autofix.yml`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            sentry-autofix.yml
          </Link>
          .
        </p>

        {error ? (
          <Card>
            <CardHeader>
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <CircleAlert className="h-4 w-4 text-warning" />
                  GitHub fetch failed
                </span>
              </CardTitle>
            </CardHeader>
            <CardBody>
              <p className="text-sm text-text-secondary">{error}</p>
            </CardBody>
          </Card>
        ) : null}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Total" value={stats.total} />
          <Stat label="Merged" value={stats.merged} variant="success" />
          <Stat label="Open" value={stats.open} variant="info" />
          <Stat label="Closed (unmerged)" value={stats.closed} variant="danger" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent auto-fix PRs</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {prs.length === 0 && !error ? (
              <p className="text-sm text-text-secondary">
                No auto-fix PRs yet. The cron runs daily; check back tomorrow.
              </p>
            ) : (
              prs.map((pr) => {
                const state = prState(pr);
                const sentryLink = sentryLinkFromBranch(pr.head.ref);
                return (
                  <div
                    key={pr.number}
                    className="rounded-md border border-border bg-bg-surface-2 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={state.variant}>
                            {state.label === 'Merged' ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : state.label === 'Closed' ? (
                              <XCircle className="h-3 w-3" />
                            ) : (
                              <GitPullRequest className="h-3 w-3" />
                            )}
                            {state.label}
                          </Badge>
                          <Link
                            href={pr.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium text-text-primary hover:text-accent hover:underline"
                          >
                            #{pr.number} {pr.title}
                          </Link>
                        </div>
                        <p className="text-xs text-text-muted">
                          Branch <code className="font-mono">{pr.head.ref}</code> · opened{' '}
                          {formatRelative(pr.created_at)}
                          {pr.merged_at ? ` · merged ${formatRelative(pr.merged_at)}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {sentryLink ? (
                          <Link
                            href={sentryLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
                          >
                            <ExternalLink className="h-3 w-3" /> Sentry
                          </Link>
                        ) : null}
                        <Link
                          href={pr.html_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
                        >
                          <ExternalLink className="h-3 w-3" /> GitHub
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  variant = 'default',
}: {
  label: string;
  value: number;
  variant?: 'default' | 'success' | 'info' | 'danger';
}) {
  const color =
    variant === 'success'
      ? 'text-success'
      : variant === 'info'
        ? 'text-info'
        : variant === 'danger'
          ? 'text-danger'
          : 'text-text-primary';
  return (
    <Card>
      <CardBody className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{label}</p>
        <p className={`text-2xl font-semibold ${color}`}>{value}</p>
      </CardBody>
    </Card>
  );
}
