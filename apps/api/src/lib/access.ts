import { createRemoteJWKSet, type JWTPayload, jwtVerify } from 'jose'
import type { Env } from '../types'

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>()
const DASHBOARD_ALLOWED_EMAILS = new Set(['operator@example.com'])

function normalizeTeamDomain(teamNameOrDomain: string): string {
  const value = teamNameOrDomain.trim().replace(/\/+$/, '')
  if (value.startsWith('https://')) return value
  if (value.endsWith('.cloudflareaccess.com')) return `https://${value}`
  return `https://${value}.cloudflareaccess.com`
}

function getJwks(issuer: string) {
  const cached = jwksByIssuer.get(issuer)
  if (cached) return cached

  const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
  jwksByIssuer.set(issuer, jwks)
  return jwks
}

export async function verifyAccessJwt(
  token: string,
  env: Pick<Env, 'CF_ACCESS_TEAM_NAME' | 'CF_ACCESS_AUD'>,
): Promise<{ email: string }> {
  const payload = await verifyAccessJwtPayload(token, env)

  if (typeof payload.email !== 'string' || payload.email.length === 0) {
    throw new Error('Cloudflare Access JWT is missing email claim')
  }

  return { email: payload.email }
}

export async function requireDashboardAccessJwt(
  token: string,
  env: Pick<Env, 'CF_ACCESS_TEAM_NAME' | 'CF_ACCESS_AUD'>,
): Promise<{ email: string }> {
  const identity = await verifyAccessJwt(token, env)
  if (!DASHBOARD_ALLOWED_EMAILS.has(identity.email.toLowerCase())) {
    throw new DashboardAccessForbiddenError(identity.email)
  }
  return identity
}

export class DashboardAccessForbiddenError extends Error {
  constructor(readonly email: string) {
    super('Dashboard Access user is not authorized')
    this.name = 'DashboardAccessForbiddenError'
  }
}

export async function verifyAccessJwtPayload(
  token: string,
  env: Pick<Env, 'CF_ACCESS_TEAM_NAME' | 'CF_ACCESS_AUD'>,
): Promise<JWTPayload> {
  if (!env.CF_ACCESS_TEAM_NAME || !env.CF_ACCESS_AUD) {
    throw new Error('Cloudflare Access JWT validation is not configured')
  }

  const issuer = normalizeTeamDomain(env.CF_ACCESS_TEAM_NAME)
  const { payload } = await jwtVerify(token, getJwks(issuer), {
    issuer,
    audience: env.CF_ACCESS_AUD,
    algorithms: ['RS256'],
  })

  return payload
}
