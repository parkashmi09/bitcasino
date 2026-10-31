import 'server-only'

import { cookies } from 'next/headers'

import { serverConfig } from '@/configs/site'
import { makeToken, tokenValid } from './token'

/** A signed, expiring cookie. No user table — the owner panel has one login, from .env.local. */
export async function isSignedIn() {
  const jar = await cookies()

  return tokenValid(jar.get(serverConfig.cookieName)?.value)
}

export async function writeSession() {
  const jar = await cookies()

  jar.set(serverConfig.cookieName, makeToken(serverConfig.cookieMaxAgeSeconds), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: serverConfig.cookieMaxAgeSeconds
  })
}

export async function clearSession() {
  const jar = await cookies()

  jar.set(serverConfig.cookieName, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
}
