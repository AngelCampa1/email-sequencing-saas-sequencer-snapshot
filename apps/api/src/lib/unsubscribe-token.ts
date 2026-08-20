const encoder = new TextEncoder()

interface SignedUnsubscribeUrlInput {
  baseUrl: string
  email: string
  product: string
  secret: string
}

export async function buildSignedUnsubscribeUrl(input: SignedUnsubscribeUrlInput): Promise<string> {
  const email = normalizeUnsubscribeEmail(input.email)
  const product = normalizeUnsubscribeProduct(input.product)
  if (!email || !product) {
    throw new Error('Cannot sign invalid unsubscribe identity')
  }

  const url = new URL(input.baseUrl)
  url.search = ''
  url.searchParams.set('email', email)
  url.searchParams.set('product', product)
  url.searchParams.set(
    'sig',
    await signUnsubscribeIdentity({ email, product, secret: input.secret }),
  )
  return url.toString()
}

export async function verifyUnsubscribeSignature(input: {
  email: string
  product: string
  signature: string | null | undefined
  secret: string | null | undefined
}): Promise<boolean> {
  if (!input.secret || !input.signature) return false

  const email = normalizeUnsubscribeEmail(input.email)
  const product = normalizeUnsubscribeProduct(input.product)
  if (!email || !product) return false

  const expected = await signUnsubscribeIdentity({ email, product, secret: input.secret })
  return timingSafeEqual(input.signature, expected)
}

export function normalizeUnsubscribeEmail(value: string): string | null {
  const email = value.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return email
}

export function normalizeUnsubscribeProduct(value: string): string | null {
  const product = value.trim().toLowerCase()
  return product.length > 0 ? product : null
}

async function signUnsubscribeIdentity(input: {
  email: string
  product: string
  secret: string
}): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(input.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${input.product}\n${input.email}`),
  )
  return base64Url(signature)
}

function base64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)
  const length = Math.max(aBytes.length, bBytes.length)
  let diff = aBytes.length ^ bBytes.length
  for (let i = 0; i < length; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0)
  }
  return diff === 0
}
