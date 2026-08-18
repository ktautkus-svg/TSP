// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-*/**',
      'build-server/**',
      'public/**',
      '.expo/**',
      'tsp-integration/**',
      'tsp-premium-cockpit/**',
      'experiments/**',
    ],
  },
  {
    rules: {
      // These rules caught real defects during the 2026-08 audit: a context
      // provider handing a fresh object to the whole app on every render,
      // StyleSheet.create() re-run inside render, and a hook called after an
      // early return.
      //
      // rules-of-hooks violations are always bugs, so they fail the run.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-console': ['warn', { allow: ['error'] }],
    },
  },
  {
    // The gateway and the production server are plain Node processes: structured
    // stdout/stderr logging is how they report, not a leftover debug statement.
    files: ['gateway/**/*.ts', 'server/**/*.ts', 'scripts/**/*.{ts,mjs}', 'tests/**/*.ts'],
    languageOptions: { globals: { Buffer: 'readonly', process: 'readonly', __dirname: 'readonly' } },
    rules: { 'no-console': 'off' },
  },
]);
