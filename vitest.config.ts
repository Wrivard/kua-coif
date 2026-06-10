import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
  test: {
    // TZ policy (plan 016): tests must pass under ANY runtime timezone — no
    // test may depend on the machine's local TZ. CI proves this by running the
    // suite twice: a TZ=America/Toronto leg (reproducible shop-tz math) AND a
    // TZ=UTC leg (catches the prod-serverless runtime-TZ class). Use the shop
    // timezone helpers in lib/business/timezone for any wall-clock conversion;
    // never `new Date()`-local arithmetic in a test's assertions.
    environment: 'jsdom',
    globals: true,
    include: ['**/*.test.{ts,tsx}'],
    // Business rules and pure utils live next to their tests; UI tests can
    // come later. We keep this list narrow so a `npm test` stays fast.
    exclude: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/build/**',
      '**/.oryon/**',
      // Workflow agents run in isolated git worktrees under .claude/worktrees/;
      // each is a full repo copy, so without this exclude `npm test` would glob
      // and re-run every test file N times (once per worktree).
      '**/.claude/**',
    ],
  },
});
