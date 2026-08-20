import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

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
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      'dist',
      '.wrangler',
      '.claude/**',
      '.clone/**',
      '.worktrees/**',
      'apps/api/src/system-tests/**',
    ],
  },
})
