import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../types'

const requireDashboardAccessJwt = vi.fn()

vi.mock('../../lib/access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/access')>()
  return {
    ...actual,
    requireDashboardAccessJwt: (...args: unknown[]) => requireDashboardAccessJwt(...args),
  }
})

// Imported after the mock is registered.
const { meRoute } = await import('../me')

function appForEnv(env: Partial<Env>) {
  const app = new Hono<{ Bindings: Env }>()
  app.route('/me', meRoute)
  return (path: string, headers: Record<string, string> = {}) =>
    app.request(path, { headers }, env as Env)
}

const PROD_ENV: Partial<Env> = {
  ENVIRONMENT: 'production',
  CF_ACCESS_TEAM_NAME: 'sequencer-test',
  CF_ACCESS_AUD: 'aud',
}

beforeEach(() => {
  requireDashboardAccessJwt.mockReset()
})

describe('meRoute', () => {
  it('returns identity JSON for an authenticated request with no return path', async () => {
    requireDashboardAccessJwt.mockResolvedValue({ email: 'operator@example.com' })
    const res = await appForEnv(PROD_ENV)('/me', { 'Cf-Access-Jwt-Assertion': 'jwt' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      email: 'operator@example.com',
      authenticated: true,
    })
  })

  it('redirects an authenticated request to a safe relative return path', async () => {
    requireDashboardAccessJwt.mockResolvedValue({ email: 'operator@example.com' })
    const res = await appForEnv(PROD_ENV)('/me?return=%2Fsequences', {
      'Cf-Access-Jwt-Assertion': 'jwt',
    })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/sequences')
  })

  it('ignores a protocol-relative return path to prevent open redirects', async () => {
    requireDashboardAccessJwt.mockResolvedValue({ email: 'operator@example.com' })
    const res = await appForEnv(PROD_ENV)('/me?return=%2F%2Fevil.example', {
      'Cf-Access-Jwt-Assertion': 'jwt',
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      email: 'operator@example.com',
      authenticated: true,
    })
  })

  it('ignores an absolute-URL return path to prevent open redirects', async () => {
    requireDashboardAccessJwt.mockResolvedValue({ email: 'operator@example.com' })
    const res = await appForEnv(PROD_ENV)('/me?return=https%3A%2F%2Fevil.example', {
      'Cf-Access-Jwt-Assertion': 'jwt',
    })

    expect(res.status).toBe(200)
    expect((await res.json()).authenticated).toBe(true)
  })

  it('rejects a return path with control chars that browsers collapse to a cross-origin URL', async () => {
    requireDashboardAccessJwt.mockResolvedValue({ email: 'operator@example.com' })
    // `/%09/evil.example` decodes to `/<TAB>/evil.example`; browsers strip the tab
    // and follow `//evil.example`, an open redirect. The guard must reject it.
    const res = await appForEnv(PROD_ENV)('/me?return=%2F%09%2Fevil.example', {
      'Cf-Access-Jwt-Assertion': 'jwt',
    })

    expect(res.status).toBe(200)
    expect((await res.json()).authenticated).toBe(true)
  })

  it('does not redirect when the return path is not authenticated', async () => {
    const res = await appForEnv(PROD_ENV)('/me?return=%2Fsequences')

    expect(res.status).toBe(401)
    expect(requireDashboardAccessJwt).not.toHaveBeenCalled()
  })
})
