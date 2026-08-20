import { ApiError } from './api-error'

export type AuthState =
  | { kind: 'loading' }
  | { kind: 'ok' }
  | { kind: 'denied' }
  | { kind: 'login' }
  | { kind: 'config-error'; message: string }

export interface AuthStateInput {
  isLoading: boolean
  error: unknown
  /** import.meta.env.DEV — dev builds tolerate a missing local API. */
  isDev: boolean
  /** True once we've already bounced the user through Access login this session. */
  alreadyTriedLogin: boolean
}

/**
 * Decide what the dashboard shell should render based on the `/me` auth check.
 *
 * The important case: when the Cloudflare Access session is missing or expired,
 * Access answers the `/me` request with a cross-origin 302 to its login page. A
 * credentialed `fetch` cannot follow that redirect, so it rejects with a network
 * `TypeError` ("Failed to fetch") — an error with no HTTP status. We treat that as
 * "needs login" and send the user through Access, instead of showing a dead-end
 * error. The `alreadyTriedLogin` guard stops a redirect loop if login still fails.
 */
export function resolveAuthState(input: AuthStateInput): AuthState {
  if (input.isLoading) return { kind: 'loading' }
  if (!input.error) return { kind: 'ok' }

  const status = input.error instanceof ApiError ? input.error.status : undefined

  if (status === 401 || status === 403) return { kind: 'denied' }

  // In dev there is no Access in front of the worker; a 404 means the route just
  // isn't mounted locally, which should not block the shell.
  if (input.isDev && status === 404) return { kind: 'ok' }

  // No HTTP status => the fetch itself failed at the network layer, which in
  // production is the Access cross-origin login redirect. Send the user to sign in.
  if (status === undefined && !input.alreadyTriedLogin) return { kind: 'login' }

  const message = input.error instanceof Error ? input.error.message : 'Unexpected error'
  return { kind: 'config-error', message }
}

/**
 * Build a same-origin Access login entry point. A top-level navigation to the
 * Access-protected `/me` triggers the login page; `return` bounces the browser
 * back to where the user was once the session is established.
 */
export function accessLoginUrl(currentPath: string): string {
  return `/me?return=${encodeURIComponent(currentPath)}`
}
