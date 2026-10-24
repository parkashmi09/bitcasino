import 'server-only'

import { cookies } from 'next/headers'

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

export async function readSessionToken(): Promise<string | null> {
  const jar = await cookies()
  const token = jar.get(serverConfig.cookieName)?.value

  if (!token) return null
  const payload = decodeToken(token)

  if (!payload || payload.exp * 1000 < Date.now()) return null

  return token
}

export async function writeSessionToken(token: string) {
  const jar = await cookies()

  jar.set(serverConfig.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: serverConfig.cookieMaxAgeSeconds
  })
}

export async function clearSessionToken() {
  const jar = await cookies()

  jar.set(serverConfig.cookieName, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
}
