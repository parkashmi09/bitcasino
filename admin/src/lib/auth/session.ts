import 'server-only'

import { cookies, headers } from 'next/headers'

import { serverConfig } from '@/configs/site'

/** The staff token's payload, as the platform signs it. Not verified here — the gateway verifies on every call. */
export type StaffTokenPayload = {
  sub: string
  type: 'admin'
  roleId: number
  roleName: string
  level: number
  permissions: string[]
  executiveId?: number | null
  iat: number
  exp: number

  /** Whitelabel preview: a read-only session (backend refuses every write). */
  ro?: boolean
}

export function decodeToken(token: string): StaffTokenPayload | null {
  try {
    const [, payload] = token.split('.')

    if (!payload) return null
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')

    return JSON.parse(json) as StaffTokenPayload
  } catch {
    return null
  }
}

export async function readSessionToken(name = serverConfig.cookieName): Promise<string | null> {
  const jar = await cookies()
  const token = jar.get(name)?.value

  if (!token) return null
  const payload = decodeToken(token)

  if (!payload || payload.exp * 1000 < Date.now()) return null

  return token
}

export async function writeSessionToken(token: string, name = serverConfig.cookieName) {
  const jar = await cookies()

  // Secure over https only (Apache sends X-Forwarded-Proto), so a plain-http local run can sign in.
  const secure = (await headers()).get('x-forwarded-proto') === 'https'

  jar.set(name, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: serverConfig.cookieMaxAgeSeconds
  })
}

export async function clearSessionToken(name = serverConfig.cookieName) {
  const jar = await cookies()

  jar.set(name, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
}
