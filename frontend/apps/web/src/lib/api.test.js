import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from './api';
import { tokenStore } from '@/auth/tokenStore';

/**
 * The single-flight refresh, and the envelope handling around it.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THE CONCURRENCY TEST IS THE IMPORTANT ONE
 *
 * Refresh tokens ROTATE, and the backend answers a replayed one with
 * `AUTH_REFRESH_TOKEN_REUSED` by revoking **every session the account has**.
 * So a client that fires two refreshes for one expiry is one timing change
 * away from signing a player out of every device they own.
 *
 * `refreshInFlight` alone does not prevent that: it is cleared in a
 * `.finally()` the instant the exchange settles, and ten requests that 401ed
 * together resolve milliseconds apart — the later ones find the latch already
 * released. Measured against the running platform, ten concurrent reads
 * produced TWO refreshes. `send()` now compares the access token it sent
 * against the one in the store before deciding to refresh.
 * ═════════════════════════════════════════════════════════════════════════
 */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const envelope = (data) => json({ success: true, data });
const refusal = (code, status) =>
  json({ success: false, error: { code, message: 'nope', details: {} } }, status);

beforeEach(() => {
  tokenStore.clear();
});

afterEach(() => {
  tokenStore.clear();
  vi.restoreAllMocks();
});

describe('single-flight refresh', () => {
  it('exchanges the refresh token exactly once for ten concurrent 401s', async () => {
    tokenStore.set({ accessToken: 'expired-token', refreshToken: 'refresh-1' });

    const urls = [];
    let refreshed = false;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      urls.push(String(url));

      if (String(url).includes('/auth/refresh')) {
        refreshed = true;
        return envelope({ accessToken: 'fresh-token', refreshToken: 'refresh-2' });
      }

      // The protected read: 401 until the refresh lands, 200 after.
      return refreshed ? envelope({ INR: '10000.00000000' }) : refusal('AUTH_TOKEN_EXPIRED', 401);
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => api('/api/v1/user/wallet/balances')),
    );

    const refreshCalls = urls.filter((u) => u.includes('/auth/refresh')).length;

    // The assertion this file exists for. Two would rotate the chain twice;
    // ten would look like a replay and revoke every session.
    expect(refreshCalls).toBe(1);

    expect(results).toHaveLength(10);
    expect(results.every((r) => r.INR === '10000.00000000')).toBe(true);
    expect(tokenStore.getAccess()).toBe('fresh-token');
  });

  it('retries with the new token rather than refreshing again', async () => {
    // A request whose 401 comes back AFTER somebody else's refresh landed must
    // notice the token changed and just retry. Refreshing again is the bug.
    tokenStore.set({ accessToken: 'expired-token', refreshToken: 'refresh-1' });

    const sent = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('/auth/refresh')) {
        return envelope({ accessToken: 'fresh-token', refreshToken: 'refresh-2' });
      }
      sent.push(init?.headers?.authorization);
      return sent.length === 1
        ? refusal('AUTH_TOKEN_EXPIRED', 401)
        : envelope({ INR: '1.00000000' });
    });

    await api('/api/v1/user/wallet/balances');

    expect(sent[0]).toBe('Bearer expired-token');
    expect(sent[1]).toBe('Bearer fresh-token');
  });

  it('does not retry when there is no refresh token to spend', async () => {
    tokenStore.set({ accessToken: 'expired-token', refreshToken: null });

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => refusal('AUTH_TOKEN_EXPIRED', 401));

    await expect(api('/api/v1/user/wallet/balances')).rejects.toThrow(ApiError);
    // One attempt, no refresh — there is nothing to exchange.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears the session when the refresh itself is refused', async () => {
    // A rotated-token replay, a revoked session, or an expired chain. Anything
    // else we tried would 401 again.
    tokenStore.set({ accessToken: 'expired-token', refreshToken: 'refresh-1' });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      String(url).includes('/auth/refresh')
        ? refusal('AUTH_REFRESH_TOKEN_REUSED', 401)
        : refusal('AUTH_TOKEN_EXPIRED', 401),
    );

    await expect(api('/api/v1/user/wallet/balances')).rejects.toThrow(ApiError);
    expect(tokenStore.hasSession()).toBe(false);
  });

  it('leaves a stored session alone when the refresh cannot reach the server', async () => {
    // A network blip is not proof the session died — clearing it here would
    // sign a player out because their wifi dropped for a second.
    tokenStore.set({ accessToken: 'expired-token', refreshToken: 'refresh-1' });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/auth/refresh')) throw new TypeError('Failed to fetch');
      return refusal('AUTH_TOKEN_EXPIRED', 401);
    });

    await expect(api('/api/v1/user/wallet/balances')).rejects.toThrow(ApiError);
    expect(tokenStore.getRefresh()).toBe('refresh-1');
  });
});

describe('envelope handling', () => {
  it('unwraps data and never hands back the envelope', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => envelope({ INR: '5' }));
    await expect(api('/x', { auth: false })).resolves.toEqual({ INR: '5' });
  });

  it('returns null for a 204 without parsing a zero-byte body', async () => {
    // `response.json()` on 204 throws "Unexpected end of JSON input".
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 204 }));
    await expect(api('/x', { auth: false })).resolves.toBeNull();
  });

  it('names an unenveloped 5xx as the gateway being down, not "Request failed"', async () => {
    // In development this is the Vite proxy answering for a gateway that is
    // not running. Reading `error.message` off it yields nothing useful.
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('Bad Gateway', { status: 502 }),
    );

    await expect(api('/x', { auth: false })).rejects.toMatchObject({
      code: 'GATEWAY_UNAVAILABLE',
    });
  });

  it('rejects a 200 that is not the envelope', async () => {
    // A dev-server fallback serving index.html. Returning it as data would
    // render an empty list instead of an error.
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('<!doctype html>', { status: 200 }),
    );

    await expect(api('/x', { auth: false })).rejects.toMatchObject({
      code: 'MALFORMED_RESPONSE',
    });
  });

  it('carries the request id a bug report quotes', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'no', details: { requestId: 'req-9' } } },
        422,
      ),
    );

    await expect(api('/x', { auth: false })).rejects.toMatchObject({ requestId: 'req-9' });
  });
});
