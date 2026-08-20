import type { Context } from 'hono'
import type { Env } from '../types'
import { verifyAccessJwtPayload } from './access'
import { ClientProductAuthError, requireClientProductSlug } from './client-product'

export interface ProductApiClientContext {
  productSlug: string
  clientId: string
}

export async function getProductApiClientId(
  c: Context<{ Bindings: Env }>,
): Promise<string | Response> {
  const token = c.req.header('Cf-Access-Jwt-Assertion')
  if (token) {
    try {
      const payload = await verifyAccessJwtPayload(token, c.env)
      const clientId = getServiceTokenSubject(payload)
      if (!clientId) {
        return c.json({ error: 'not_authenticated' }, 401)
      }
      return clientId
    } catch (error) {
      const status = error instanceof Error && error.message.includes('not configured') ? 503 : 401
      return c.json({ error: 'not_authenticated' }, status)
    }
  }

  return c.json({ error: 'not_authenticated' }, 401)
}

export async function requireProductApiClient(
  c: Context<{ Bindings: Env }>,
): Promise<string | Response> {
  const client = await requireProductApiClientContext(c)
  if (client instanceof Response) return client
  return client.productSlug
}

export async function requireProductApiClientContext(
  c: Context<{ Bindings: Env }>,
): Promise<ProductApiClientContext | Response> {
  const clientId = await getProductApiClientId(c)
  if (clientId instanceof Response) return clientId

  try {
    return {
      clientId,
      productSlug: await requireClientProductSlug(c.env, clientId),
    }
  } catch (error) {
    if (error instanceof ClientProductAuthError) {
      return c.json({ error: 'not_authenticated' }, 401)
    }
    throw error
  }
}

function getServiceTokenSubject(payload: Record<string, unknown>): string | null {
  if (typeof payload.common_name === 'string' && isAccessClientId(payload.common_name)) {
    return payload.common_name
  }

  if (typeof payload.service_token_id === 'string' && isAccessClientId(payload.service_token_id)) {
    return payload.service_token_id
  }

  return null
}

function isAccessClientId(value: string): boolean {
  return value.trim().length > '.access'.length && value.endsWith('.access')
}
