#!/usr/bin/env node
/**
 * Sentry → Markdown briefing for the daily auto-fix cron.
 *
 * Reads the Sentry API for unresolved issues matching the configured
 * filter, fetches the latest event for each (stack trace + tags +
 * breadcrumbs), and writes a structured markdown file that
 * `claude-code-action` consumes as its prompt context.
 *
 * Why a markdown briefing rather than letting Claude query Sentry
 * itself in the action:
 *   - The hosted Sentry MCP requires browser OAuth — unusable in a
 *     headless cron.
 *   - Pre-fetching keeps the agent's context budget under control
 *     (we cap the briefing at 5 issues × ~30 lines of stack each =
 *     a few hundred lines of context).
 *   - The script is the single place we can swap query filters or
 *     payload shape without touching the workflow YAML.
 *
 * Env vars (all required unless marked optional):
 *   - SENTRY_AUTH_TOKEN — user auth token with `event:read` + `org:read` scope
 *   - SENTRY_ORG          — slug, e.g. 'kua'
 *   - SENTRY_PROJECT      — slug, e.g. 'javascript-nextjs'
 *   - SENTRY_REGION_URL   — region base URL, e.g. 'https://us.sentry.io' (optional, defaults to US)
 *   - SENTRY_QUERY        — issue search filter (optional, defaults to is:unresolved firstSeen:-24h)
 *   - SENTRY_FETCH_LIMIT  — max issues per run (optional, defaults to 5)
 *   - OUTPUT_PATH         — file to write the briefing (optional, defaults to .sentry-briefing.md)
 *
 * Exit codes:
 *   - 0 with NO_ISSUES line on stdout when the query returned 0 → workflow skips Claude run
 *   - 0 with file written when there are issues
 *   - 1 on any API / FS error → workflow fails loudly
 */

import { writeFile } from 'node:fs/promises';

const ORG = process.env.SENTRY_ORG || 'kua';
const PROJECT = process.env.SENTRY_PROJECT || 'javascript-nextjs';
const TOKEN = process.env.SENTRY_AUTH_TOKEN;
const REGION_URL = (process.env.SENTRY_REGION_URL || 'https://us.sentry.io').replace(/\/$/, '');
const LIMIT = Number(process.env.SENTRY_FETCH_LIMIT ?? '5');
const QUERY = process.env.SENTRY_QUERY ?? 'is:unresolved firstSeen:-24h';
const OUTPUT = process.env.OUTPUT_PATH || '.sentry-briefing.md';

if (!TOKEN) {
  console.error('SENTRY_AUTH_TOKEN is missing.');
  process.exit(1);
}

const baseUrl = `${REGION_URL}/api/0`;

async function api(path) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Sentry API ${res.status} ${res.statusText} on ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function trimStr(s, max = 400) {
  if (typeof s !== 'string') return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

/**
 * Pull a sensible stack-trace summary out of the event payload.
 * Sentry events nest frames under `entries[type='exception']`. We grab
 * the deepest 8 frames (the closest to the throw site) and the error
 * type/message.
 */
function summarizeStack(event) {
  if (!event?.entries) return { type: null, value: null, frames: [] };
  const excEntry = event.entries.find((e) => e.type === 'exception');
  if (!excEntry?.data?.values?.length) return { type: null, value: null, frames: [] };
  const first = excEntry.data.values[0];
  const allFrames = first?.stacktrace?.frames ?? [];
  // Last frame in Sentry order = closest to the throw. Keep the
  // bottom 8 for the briefing.
  const frames = allFrames.slice(-8).map((f) => ({
    filename: f.filename || f.absPath || '<unknown>',
    function: f.function || '<anonymous>',
    lineNo: f.lineNo ?? null,
    colNo: f.colNo ?? null,
    contextLine: f.contextLine ? trimStr(f.contextLine.trim(), 200) : null,
  }));
  return {
    type: first?.type ?? null,
    value: first?.value ? trimStr(first.value, 400) : null,
    frames,
  };
}

function summarizeBreadcrumbs(event) {
  if (!event?.entries) return [];
  const bcEntry = event.entries.find((e) => e.type === 'breadcrumbs');
  if (!bcEntry?.data?.values?.length) return [];
  // Last 6 breadcrumbs before the error — usually enough to see the
  // route + action chain that triggered it.
  return bcEntry.data.values.slice(-6).map((b) => ({
    timestamp: b.timestamp,
    category: b.category ?? 'unknown',
    message: trimStr(b.message ?? '', 200),
    level: b.level ?? 'info',
  }));
}

function summarizeTags(event) {
  if (!Array.isArray(event?.tags)) return {};
  const out = {};
  for (const tag of event.tags) {
    if (tag.key && typeof tag.value !== 'undefined') {
      out[tag.key] = trimStr(String(tag.value), 100);
    }
  }
  return out;
}

function renderIssueSection(issue, event) {
  const stack = summarizeStack(event);
  const breadcrumbs = summarizeBreadcrumbs(event);
  const tags = summarizeTags(event);

  const lines = [];
  lines.push(`### Issue \`${issue.shortId || issue.id}\` — ${trimStr(issue.title, 120)}`);
  lines.push('');
  lines.push(`- **Level**: ${issue.level || 'unknown'}`);
  lines.push(`- **Times seen**: ${issue.count ?? '?'}`);
  lines.push(`- **Users affected**: ${issue.userCount ?? '?'}`);
  lines.push(`- **First seen**: ${issue.firstSeen ?? '?'}`);
  lines.push(`- **Last seen**: ${issue.lastSeen ?? '?'}`);
  if (issue.permalink) lines.push(`- **Sentry link**: ${issue.permalink}`);
  lines.push('');

  if (Object.keys(tags).length > 0) {
    lines.push('**Tags** (these mirror the ones I stamp via `captureException`):');
    lines.push('```');
    for (const [k, v] of Object.entries(tags)) lines.push(`${k}=${v}`);
    lines.push('```');
    lines.push('');
  }

  if (stack.type || stack.value) {
    lines.push(
      `**Exception**: \`${stack.type ?? '(no type)'}\` — ${stack.value ?? '(no message)'}`,
    );
    lines.push('');
  }

  if (stack.frames.length > 0) {
    lines.push('**Stack (last 8 frames, deepest = throw site)**:');
    lines.push('```');
    for (const f of stack.frames) {
      const loc = f.lineNo ? `:${f.lineNo}${f.colNo ? ':' + f.colNo : ''}` : '';
      lines.push(`${f.filename}${loc}  in ${f.function}`);
      if (f.contextLine) lines.push(`  → ${f.contextLine}`);
    }
    lines.push('```');
    lines.push('');
  }

  if (breadcrumbs.length > 0) {
    lines.push('**Last 6 breadcrumbs before the error**:');
    lines.push('```');
    for (const b of breadcrumbs) {
      const ts = b.timestamp ? new Date(b.timestamp * 1000).toISOString() : '?';
      lines.push(`[${ts}] [${b.level}] ${b.category}: ${b.message}`);
    }
    lines.push('```');
    lines.push('');
  }

  // Everything in this section is derived from the Sentry API (issue title,
  // exception message, stack-frame text, breadcrumbs, tag values) and is
  // UNTRUSTED — production errors routinely embed user-supplied strings from
  // the public booking surface. Fence the whole section so the workflow prompt
  // can flag it as data-not-instructions (see the SECURITY rule there) and the
  // agent never executes anything an attacker stuffed into an error payload.
  return ['<untrusted-sentry-data>', lines.join('\n'), '</untrusted-sentry-data>'].join('\n');
}

function renderHeader(count) {
  return [
    '# Sentry auto-fix briefing',
    '',
    `**Run timestamp**: ${new Date().toISOString()}`,
    `**Query**: \`${QUERY}\``,
    `**Issues fetched**: ${count} (cap: ${LIMIT})`,
    '',
    '## Your mission',
    '',
    `You are running in a GitHub Actions workflow. The repo is checked out at the working`,
    `directory. For each issue below:`,
    '',
    `1. **Diagnose** — read the stack trace + tags. The \`layer:\`, \`stage:\`, \`action:\` tags`,
    `   match exactly the ones stamped via \`captureException\` calls in the codebase, so a`,
    `   \`grep\` against them will point you at the call site.`,
    `2. **Decide if you can fix it** — only attempt issues you can confidently fix with a small,`,
    `   surgical change. If the issue is intermittent (network blip, third-party 5xx), or`,
    `   needs product judgment, SKIP it and note why at the bottom of the PR description.`,
    `3. **Fix it** — make the smallest change that resolves the root cause. Add a regression`,
    `   test when the affected code has a sibling test file.`,
    `4. **Open ONE PR per issue** — branch \`autofix/sentry-<shortId>\`. PR title prefixed with`,
    `   \`fix(autofix): \`. PR body MUST include:`,
    `   - The Sentry issue shortId + permalink (from the briefing).`,
    `   - A one-paragraph diagnosis ("root cause was X").`,
    `   - What you changed + why it's the minimal fix.`,
    `   - The label \`sentry-autofix\` (\`gh pr create --label sentry-autofix\`).`,
    `5. **Skip + log** if you can't fix it cleanly. Don't push a PR that isn't a real fix.`,
    '',
    `Run \`pnpm typecheck && pnpm lint && pnpm format:check && pnpm test\` before opening`,
    `the PR. If any gate fails, fix or skip — never open a failing PR.`,
    '',
    '---',
    '',
  ].join('\n');
}

async function main() {
  console.log(`Fetching Sentry issues: query="${QUERY}" limit=${LIMIT}`);
  const issues = await api(
    `/projects/${ORG}/${PROJECT}/issues/?query=${encodeURIComponent(QUERY)}&limit=${LIMIT}`,
  );
  console.log(`Got ${issues.length} issue(s).`);

  if (issues.length === 0) {
    // Marker output for the workflow to skip the Claude step.
    console.log('NO_ISSUES');
    await writeFile(
      OUTPUT,
      '# No issues to fix\n\nSentry returned 0 issues matching the filter. The daily cron will skip the Claude step.\n',
    );
    return;
  }

  const sections = [];
  for (const issue of issues) {
    try {
      const event = await api(`/issues/${issue.id}/events/latest/`);
      sections.push(renderIssueSection(issue, event));
    } catch (e) {
      console.warn(`Skipping issue ${issue.id}: ${e.message}`);
    }
  }

  if (sections.length === 0) {
    console.log('NO_ISSUES');
    await writeFile(
      OUTPUT,
      '# No usable issues\n\nFetched issues but none had a retrievable event. Nothing to fix.\n',
    );
    return;
  }

  const briefing = renderHeader(sections.length) + sections.join('\n\n---\n\n');
  await writeFile(OUTPUT, briefing);
  console.log(
    `Wrote ${OUTPUT} (${sections.length} issue briefing${sections.length === 1 ? '' : 's'}).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
