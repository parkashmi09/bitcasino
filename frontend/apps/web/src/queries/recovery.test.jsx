import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useRequestResetCode, useVerifyResetCode, useResetPassword } from './recovery';
import { ENDPOINTS } from '@/lib/endpoints';
import { tokenStore } from '@/auth/tokenStore';

/**
 * Password recovery, and the four things about it that are easy to get wrong.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 1. ALL THREE CALLS MUST BE UNAUTHENTICATED
 *
 * A player who has forgotten their password has no token. If these went out
 * with `auth: true`, `api.js` would attach whatever access token is in memory
 * and — worse — attempt a REFRESH on the 401, which for a signed-out visitor
 * means a failed refresh and `tokenStore.clear()` firing in the middle of the
 * flow. The tests below stage a token deliberately and assert none of it
 * reaches the wire.
 *
 * 2. THE PURPOSE IS PART OF THE CREDENTIAL
 *
 * `reset-2fa`, `login` and `change-email` codes go to the same inbox and live
 * in the same table. Without `purpose` in the request, a code issued to turn
 * off two-factor would also reset a password — the more valuable of the two.
 * The backend confines it; this layer has to actually send it.
 *
 * 3. THE CODE IS SENT AGAIN AT STEP THREE, AND THAT IS NOT REDUNDANCY
 *
 * The proof left by step two is keyed on the ADDRESS. This route is
 * unauthenticated, so without re-checking the code, any caller naming that
 * address could set the password during the five minutes after a victim
 * verified their own. A well-meaning simplification that dropped `code` from
 * this body would leave the flow working perfectly and silently exploitable.
 *
 * 4. NOTHING RETRIES
 *
 * Step one emails a real inbox; step two spends one of three attempts. An
 * automatic retry on either is actively harmful — two codes where one was
 * wanted, or one guess costing two attempts.
 * ═════════════════════════════════════════════════════════════════════════
 */

const envelope = (data) =>
  new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const refusal = (status, code, message, details) =>
  new Response(JSON.stringify({ success: false, error: { code, message, details } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** Capture one request and answer it. */
function stub(response) {
  const seen = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    seen.push({ url: String(url), init });
    return Promise.resolve(typeof response === 'function' ? response() : response);
  });
  return seen;
}

const bodyOf = (call) => JSON.parse(call.init.body);

/** Headers, whatever shape `api.js` built them in. */
const headerOf = (call, name) => {
  const headers = call.init.headers;
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : null;
};

beforeEach(() => {
  /* A token IS staged, deliberately. The point of the assertions below is
     that having one in memory changes nothing about these three calls — a
     visitor can reach `/forgot-password` with a stale session in the tab. */
  tokenStore.set({ accessToken: 'a-stale-access-token', refreshToken: 'r' });
});

afterEach(() => {
  tokenStore.clear();
  vi.restoreAllMocks();
});

describe('step one — requesting a code', () => {
  it('posts the address and the purpose, and nothing else', async () => {
    const seen = stub(envelope({ requested: true }));

    const { result } = renderHook(() => useRequestResetCode(), { wrapper: wrapper() });
    await result.current.mutateAsync('player@example.test');

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toContain(ENDPOINTS.emailOtp);
    expect(seen[0].init.method).toBe('POST');
    // `.strict()` on the backend: an extra key is a 422, not a silent drop.
    expect(bodyOf(seen[0])).toEqual({
      email: 'player@example.test',
      purpose: 'reset-password',
    });
  });

  it('SENDS NO AUTHORIZATION HEADER even with a token in memory', async () => {
    const seen = stub(envelope({ requested: true }));

    const { result } = renderHook(() => useRequestResetCode(), { wrapper: wrapper() });
    await result.current.mutateAsync('player@example.test');

    expect(headerOf(seen[0], 'authorization')).toBeFalsy();
  });

  it('does not retry — every attempt is an email to a real inbox', async () => {
    const seen = stub(() => refusal(502, 'EMAIL_SEND_FAILED', 'The message could not be sent'));

    const { result } = renderHook(() => useRequestResetCode(), { wrapper: wrapper() });
    await expect(result.current.mutateAsync('player@example.test')).rejects.toThrow();

    expect(seen).toHaveLength(1);
  });

  it('surfaces the cooldown with the seconds the server named', async () => {
    /* The one refusal in this flow that is safe to be specific about — a
       caller only reaches it by having asked for a code themselves a moment
       ago. Without the number the player just presses the button again. */
    stub(
      refusal(429, 'EMAIL_OTP_COOLDOWN', 'A code was sent recently', {
        retryAfterSeconds: 87,
      }),
    );

    const { result } = renderHook(() => useRequestResetCode(), { wrapper: wrapper() });

    await expect(result.current.mutateAsync('player@example.test')).rejects.toMatchObject({
      code: 'EMAIL_OTP_COOLDOWN',
      details: { retryAfterSeconds: 87 },
    });
  });
});

describe('step two — verifying the code', () => {
  it('posts the address, the purpose AND the code', async () => {
    const seen = stub(envelope({ verified: true }));

    const { result } = renderHook(() => useVerifyResetCode(), { wrapper: wrapper() });
    await result.current.mutateAsync({ email: 'player@example.test', code: '123456' });

    expect(seen[0].url).toContain(ENDPOINTS.emailOtpVerify);
    expect(bodyOf(seen[0])).toEqual({
      email: 'player@example.test',
      purpose: 'reset-password',
      code: '123456',
    });
  });

  it('does not retry — a retried wrong code spends two of three attempts', async () => {
    const seen = stub(() => refusal(400, 'EMAIL_OTP_INVALID', 'That code is not valid'));

    const { result } = renderHook(() => useVerifyResetCode(), { wrapper: wrapper() });
    await expect(
      result.current.mutateAsync({ email: 'player@example.test', code: '000000' }),
    ).rejects.toThrow();

    expect(seen).toHaveLength(1);
  });

  it('sends no authorization header', async () => {
    const seen = stub(envelope({ verified: true }));

    const { result } = renderHook(() => useVerifyResetCode(), { wrapper: wrapper() });
    await result.current.mutateAsync({ email: 'player@example.test', code: '123456' });

    expect(headerOf(seen[0], 'authorization')).toBeFalsy();
  });
});

describe('step three — setting the password', () => {
  it('SENDS THE CODE AGAIN, which is what makes the proof non-bearer', async () => {
    /**
     * The security property of this route, asserted rather than trusted to a
     * comment. The proof row is keyed on the address alone; re-sending the
     * code is what stops it being a credential anyone naming that address can
     * spend during the five-minute window.
     */
    const seen = stub(envelope({ reset: true, revokedSessions: 2 }));

    const { result } = renderHook(() => useResetPassword(), { wrapper: wrapper() });
    await result.current.mutateAsync({
      email: 'player@example.test',
      code: '123456',
      newPassword: 'a-brand-new-passphrase',
    });

    expect(seen[0].url).toContain(ENDPOINTS.resetPassword);
    expect(bodyOf(seen[0])).toEqual({
      email: 'player@example.test',
      code: '123456',
      newPassword: 'a-brand-new-passphrase',
    });
  });

  it('sends no authorization header — the caller has no session by definition', async () => {
    const seen = stub(envelope({ reset: true, revokedSessions: 0 }));

    const { result } = renderHook(() => useResetPassword(), { wrapper: wrapper() });
    await result.current.mutateAsync({
      email: 'player@example.test',
      code: '123456',
      newPassword: 'a-brand-new-passphrase',
    });

    expect(headerOf(seen[0], 'authorization')).toBeFalsy();
  });

  it('answers the revoked-session count and NO session', async () => {
    /* The route deliberately mints nothing: every session on the account was
       just revoked, and handing back a fresh one would re-open the door it
       closed. A caller that expected tokens here would sign the player in
       from a flow whose whole premise is that identity is unproven. */
    stub(envelope({ reset: true, revokedSessions: 3 }));

    const { result } = renderHook(() => useResetPassword(), { wrapper: wrapper() });
    const answer = await result.current.mutateAsync({
      email: 'player@example.test',
      code: '123456',
      newPassword: 'a-brand-new-passphrase',
    });

    expect(answer).toEqual({ reset: true, revokedSessions: 3 });
    expect(answer.accessToken).toBeUndefined();
    expect(answer.refreshToken).toBeUndefined();
  });

  it('surfaces a stale proof as EMAIL_OTP_INVALID for the page to act on', async () => {
    /* At this step that code means the five-minute proof window closed, not
       that the code is wrong — it was checked a moment ago and has not been
       retyped. The page sends the player back to step one on it. */
    stub(refusal(400, 'EMAIL_OTP_INVALID', 'That code is not valid'));

    const { result } = renderHook(() => useResetPassword(), { wrapper: wrapper() });

    await expect(
      result.current.mutateAsync({
        email: 'player@example.test',
        code: '123456',
        newPassword: 'a-brand-new-passphrase',
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_OTP_INVALID' });
  });

  it('surfaces password reuse under its own code', async () => {
    stub(
      refusal(422, 'AUTH_PASSWORD_REUSED', 'The new password must be different from the current one'),
    );

    const { result } = renderHook(() => useResetPassword(), { wrapper: wrapper() });

    await expect(
      result.current.mutateAsync({
        email: 'player@example.test',
        code: '123456',
        newPassword: 'the-same-one-as-before',
      }),
    ).rejects.toMatchObject({ code: 'AUTH_PASSWORD_REUSED' });
  });
});
