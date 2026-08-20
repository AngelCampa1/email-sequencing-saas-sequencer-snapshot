import { Hono } from 'hono'
import { DashboardAccessForbiddenError, requireDashboardAccessJwt } from '../lib/access'
import type { Env } from '../types'

export const meRoute = new Hono<{ Bindings: Env }>()

// Only accept same-origin, path-only redirect targets. This lets the SPA send a
// top-level navigation to `/me?return=/sequences` to trigger the Cloudflare Access
// login (Access 302s a missing session to its cross-origin login page, which a
// credentialed fetch cannot follow) and then bounce back into the app after sign-in.
// Reject anything that could leave the origin to avoid an open redirect.
function safeReturnPath(raw: string | undefined): string | null {
  if (!raw) return null
  if (!raw.startsWith('/')) return null
  // Control chars (tab/newline/CR) are stripped by browsers before following a
  // Location header, so `/<TAB>/host` would collapse to `//host` - a cross-origin
  // redirect. Reject any path containing C0 control characters outright.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars is the intent
  if (/[\u0000-\u001f]/.test(raw)) return null
  // `//host` and `/\host` are browser-interpreted as protocol-relative URLs.
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null
  return raw
}

meRoute.get('/', async (c) => {
  const token = c.req.header('Cf-Access-Jwt-Assertion')
  if (!token) {
    // Dev-only bypass: wrangler dev --local has no real CF Access JWT in front of it.
    // Production sets ENVIRONMENT="production"; this branch is unreachable there.
    if (c.env.ENVIRONMENT === 'development') {
      return c.json({ email: 'operator@example.com', authenticated: true })
    }
    return c.json({ error: 'Not authenticated' }, 401)
  }

  try {
    const { email } = await requireDashboardAccessJwt(token, c.env)
    const returnPath = safeReturnPath(c.req.query('return'))
    if (returnPath) return c.redirect(returnPath)
    return c.json({ email, authenticated: true })
  } catch (error) {
    if (error instanceof DashboardAccessForbiddenError) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    const status = error instanceof Error && error.message.includes('not configured') ? 503 : 401
    return c.json({ error: 'Not authenticated' }, status)
  }
})
