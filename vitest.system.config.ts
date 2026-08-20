import { resolve } from 'node:path'
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
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
      {
        find: '@sequencer/shared',
        replacement: resolve(__dirname, 'packages/shared/src/index.ts'),
      },
    ],
  },
  test: {
    pool: '@cloudflare/vitest-pool-workers',
    poolOptions: {
      workers: async () => ({
        wrangler: { configPath: './apps/api/wrangler.toml' },
        miniflare: {
          bindings: {
            CF_ACCESS_TEAM_NAME: 'sequencer-system-test',
            CF_ACCESS_AUD: 'sequencer-system-test-aud',
            INSTANTLY_WEBHOOK_SECRET: 'system-instantly-secret',
            RESEND_API_KEY_CAMAUDIT: 'resend-system-test-key',
            RESEND_WEBHOOK_SECRET: 'whsec_c3lzdGVtLXJlc2VuZC1zZWNyZXQ=',
            UNSUBSCRIBE_SIGNING_SECRET: 'system-unsubscribe-signing-secret',
            TEST_MIGRATIONS: (await readD1Migrations('./packages/db/migrations')).map(
              (migration) => ({
                ...migration,
                queries: migration.queries.filter(
                  (query) => query.replace(/--.*$/gm, '').trim().length > 0,
                ),
              }),
            ),
          },
        },
      }),
    },
    include: ['apps/api/src/system-tests/**/*.test.ts'],
    testTimeout: 20_000,
  },
})
