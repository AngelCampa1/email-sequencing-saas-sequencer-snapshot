import { api_tokens, createDb, products } from '@sequencer/db'
import { ProductSlugSchema } from '@sequencer/shared'
import { and, eq, isNull } from 'drizzle-orm'
import type { Env } from '../types'

/**
 * Resolve the product slug associated with the calling CF Access Service Token.
 * Returns null when no active api_tokens row is configured for that client ID.
 */
export async function resolveClientProductSlug(
  env: Env,
  clientId: string | undefined,
): Promise<string | null> {
  if (!clientId) return null
  const db = createDb(env.DB)
  const [row] = await db
    .select({ slug: products.slug })
    .from(api_tokens)
    .innerJoin(products, eq(products.id, api_tokens.product_id))
    .where(and(eq(api_tokens.access_service_token_id, clientId), isNull(api_tokens.revoked_at)))
    .limit(1)
  const parsed = ProductSlugSchema.safeParse(row?.slug)
  return parsed.success ? parsed.data : null
}

export async function requireClientProductSlug(
  env: Env,
  clientId: string | undefined,
): Promise<string> {
  if (!clientId) {
    throw new ClientProductAuthError('missing_client_id')
  }

  const slug = await resolveClientProductSlug(env, clientId)
  if (!slug) {
    throw new ClientProductAuthError('unknown_client_id')
  }

  return slug
}

export class ClientProductAuthError extends Error {
  constructor(public readonly code: 'missing_client_id' | 'unknown_client_id') {
    super(code)
  }
}
