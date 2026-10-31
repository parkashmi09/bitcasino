import { createHmac, timingSafeEqual } from 'node:crypto'

import { SESSION_COOKIE } from '@/configs/site'

export { SESSION_COOKIE }

/**
 * Session token `owner.<exp>.<hmac>` (contract §1). Pure — no next/headers — so the
 * proxy and the route handlers verify it the same way.
 */
const secret = () => process.env.OWNER_SESSION_SECRET ?? ''

function sign(payload: string) {
  return createHmac('sha256', secret()).update(payload).digest('hex')
}

/** Constant-time string compare; unequal lengths still burn one compare. */
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)

  if (x.length !== y.length) {
    timingSafeEqual(x, x)

    return false
  }

  return timingSafeEqual(x, y)
}

export function makeToken(maxAgeSeconds: number) {
  const payload = `owner.${Date.now() + maxAgeSeconds * 1000}`

  return `${payload}.${sign(payload)}`
}

export function tokenValid(token: string | undefined) {
  if (!token || !secret()) return false
  const idx = token.lastIndexOf('.')

  if (idx < 0) return false
  const payload = token.slice(0, idx)
  const [subject, exp] = payload.split('.')

  if (subject !== 'owner' || !safeEqual(token.slice(idx + 1), sign(payload))) return false

  return Number.isFinite(Number(exp)) && Number(exp) > Date.now()
}
