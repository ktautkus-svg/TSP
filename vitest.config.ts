import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    maxWorkers: 2,
    exclude: ['**/node_modules/**', '**/dist/**', '**/.runtime-logs/**', 'tsp-integration/**', 'tsp-premium-cockpit/**', 'firo-*/**', '*.worktrees/**'],
  },
});
