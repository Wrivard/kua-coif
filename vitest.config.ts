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
