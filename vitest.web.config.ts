import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Web-scoped Vitest config (mirrors the vitest.system.config.ts pattern of a
// dedicated config per test scope). The shared root vitest.config.ts runs the
// whole monorepo in the node environment without a coverage gate; this config
// runs ONLY the apps/web suite and enforces the per-file coverage gate so the
// gate cannot accidentally apply to api/package code that is not yet at target.
//
// Interaction tests opt into jsdom per-file via a `// @vitest-environment jsdom`
// docblock plus `import '../test/interaction-setup'`; everything else runs in
// node (most web tests render via react-dom/server's renderToStaticMarkup).
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@sequencer\/emails\/templates\/(.*)$/,
        replacement: resolve(__dirname, 'packages/emails/src/templates/$1.tsx'),
      },
      { find: '@sequencer/db', replacement: resolve(__dirname, 'packages/db/src/index.ts') },
      {
        find: '@sequencer/emails',
        replacement: resolve(__dirname, 'packages/emails/src/index.ts'),
      },
      { find: '@sequencer/sdk', replacement: resolve(__dirname, 'packages/sdk/src/index.ts') },
      {
        find: '@sequencer/shared',
        replacement: resolve(__dirname, 'packages/shared/src/index.ts'),
      },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 15_000,
    include: ['apps/web/**/*.{test,spec}.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      'dist',
      '.wrangler',
      '.claude/**',
      '.clone/**',
      '.worktrees/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['apps/web/src/**'],
      // Files with no runtime logic to gate:
      //  - main.tsx        bootstrap entry point (ReactDOM.createRoot)
      //  - App.tsx         declarative route table (no branching logic)
      //  - lib/types.ts    type-only module, no runtime
      //  - test/**         test-only helpers/setup
      exclude: [
        'apps/web/src/main.tsx',
        'apps/web/src/App.tsx',
        'apps/web/src/lib/types.ts',
        'apps/web/src/test/**',
        '**/*.d.ts',
        '**/*.{test,spec}.{ts,tsx}',
      ],
      thresholds: {
        perFile: true,
        statements: 95,
        branches: 95,
        functions: 90,
        lines: 95,
      },
    },
  },
})
