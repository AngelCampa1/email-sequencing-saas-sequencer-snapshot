import { writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildTokenSqlOutput } from '../commands/token-sql.js'
import { LIVE_PRODUCTS } from '../lib/readiness.js'

describe('seq token-sql command helpers', () => {
  it('refuses to write placeholder token SQL to a file by default', () => {
    expect(() =>
      buildTokenSqlOutput({
        out: 'dist/product-api-tokens.sql',
        allowPlaceholders: false,
      }),
    ).toThrow(
      'Refusing to write placeholder seq_api_tokens SQL to a file; pass --access-token-file or --allow-placeholders',
    )
  })

  it('still allows placeholder token SQL for stdout and explicit template files', () => {
    expect(buildTokenSqlOutput({})).toContain("'<access_client_id_for_floriva_web>'")
    expect(
      buildTokenSqlOutput({
        out: 'dist/product-api-tokens.sql',
        allowPlaceholders: true,
      }),
    ).toContain("'<access_client_id_for_floriva_web>'")
  })

  it('writes real token SQL from a filled Access service-token template', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'seq-token-sql-'))
    try {
      const tokenFile = join(dir, 'access-service-tokens.json')
      const template = Object.fromEntries(
        LIVE_PRODUCTS.map((product, index) => [
          product.slug,
          { access_client_id: `${String(index + 1).padStart(32, '0')}.access` },
        ]),
      )
      writeFileSync(tokenFile, JSON.stringify(template))

      const sql = buildTokenSqlOutput({
        out: 'dist/product-api-tokens.sql',
        accessTokenFile: tokenFile,
      })

      const lastLiveTokenId = `${String(LIVE_PRODUCTS.length).padStart(32, '0')}.access`
      expect(sql).toContain(`'${lastLiveTokenId}'`)
      expect(sql).not.toContain('<access_client_id_for_')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
