import { describe, expect, it } from 'vitest'
import { ApiError } from './api-error'
import { accessLoginUrl, resolveAuthState } from './auth-state'

const base = { isDev: false, alreadyTriedLogin: false }

describe('resolveAuthState', () => {
  it('reports loading while the check is in flight', () => {
    expect(resolveAuthState({ ...base, isLoading: true, error: null })).toEqual({ kind: 'loading' })
  })

  it('reports ok when there is no error', () => {
    expect(resolveAuthState({ ...base, isLoading: false, error: null })).toEqual({ kind: 'ok' })
  })

  it('reports denied for a 401', () => {
    const error = new ApiError('Not authenticated', 401)
    expect(resolveAuthState({ ...base, isLoading: false, error })).toEqual({ kind: 'denied' })
  })

  it('reports denied for a 403', () => {
    const error = new ApiError('Forbidden', 403)
    expect(resolveAuthState({ ...base, isLoading: false, error })).toEqual({ kind: 'denied' })
  })

  it('sends the user to login on a network error (Access cross-origin redirect)', () => {
    const error = new TypeError('Failed to fetch')
    expect(resolveAuthState({ ...base, isLoading: false, error })).toEqual({ kind: 'login' })
  })

  it('does not loop: a network error after a login attempt becomes a config error', () => {
    const error = new TypeError('Failed to fetch')
    expect(resolveAuthState({ ...base, isLoading: false, error, alreadyTriedLogin: true })).toEqual(
      { kind: 'config-error', message: 'Failed to fetch' },
    )
  })

  it('treats a dev-only 404 as ok', () => {
    const error = new ApiError('Not Found', 404)
    expect(resolveAuthState({ ...base, isDev: true, isLoading: false, error })).toEqual({
      kind: 'ok',
    })
  })

  it('shows a config error for an unexpected status like 503', () => {
    const error = new ApiError('Not authenticated', 503)
    expect(resolveAuthState({ ...base, isLoading: false, error })).toEqual({
      kind: 'config-error',
      message: 'Not authenticated',
    })
  })

  it('falls back to a generic message when the error is not an Error instance', () => {
    // A non-Error rejection (e.g. a thrown string) has no status and no
    // `.message`; after a prior login attempt it lands on the config-error path.
    expect(
      resolveAuthState({ ...base, isLoading: false, error: 'boom', alreadyTriedLogin: true }),
    ).toEqual({ kind: 'config-error', message: 'Unexpected error' })
  })
})

describe('accessLoginUrl', () => {
  it('builds a same-origin /me login entry that returns to the current path', () => {
    expect(accessLoginUrl('/sequences?product=grantpipe')).toBe(
      '/me?return=%2Fsequences%3Fproduct%3Dgrantpipe',
    )
  })
})
