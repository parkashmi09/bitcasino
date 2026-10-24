import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useSubmitKyc, useTransactionHistory, useBeginTwoFactor } from './account';
import { tokenStore } from '@/auth/tokenStore';

/**
 * The account layer's two silent failure modes.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 1. THE MULTIPART CONTENT-TYPE
 *
 * `POST /user/kyc/submit` is the only multipart route this app calls. A
 * multipart body is `multipart/form-data; boundary=…` and only the browser
 * knows the boundary it generated, so `api.js` must send a `FormData` body
 * with NO content-type header at all.
 *
 * Getting it wrong does not look like a header bug. Measured against the
 * running service on 2026-09-09, the same body answers
 * `500 INTERNAL_ERROR "Something went wrong"` with a hand-set content-type
 * and `201 {id, status: 'Pending'}` without one. A 500 with no field detail
 * reads as a broken endpoint, so somebody debugging it goes looking at the
 * route rather than at the transport. Hence the test.
 *
 * 2. THE COMBINED HISTORY IS NOT A LIST
 *
 * `GET /user/history` answers `{deposits: {count, rows}, withdrawals: {…}}`,
 * not a flat array and not `meta.pagination`. A caller that treats it as a
 * list gets `undefined.length` — or worse, renders an empty table that looks
 * exactly like a player with no transactions.
 * ═════════════════════════════════════════════════════════════════════════
 */

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'authenticated', user: { id: 1 } }),
}));

const envelope = (data) =>
  new Response(JSON.stringify({ success: true, data }), {
    status: 200,
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

beforeEach(() => {
  tokenStore.set({ accessToken: 'test-token', refreshToken: 'r' });
});

afterEach(() => {
  tokenStore.clear();
  vi.restoreAllMocks();
});

describe('the KYC submission', () => {
  it('sends a FormData body with NO content-type header', async () => {
    let sent;
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
      sent = { url: String(url), init };
      return Promise.resolve(envelope({ status: 'Pending' }));
    });

    const { result } = renderHook(() => useSubmitKyc(), { wrapper: wrapper() });

    await result.current.mutateAsync({
      firstName: 'Ada',
      lastName: 'Lovelace',
      dateOfBirth: '1990-01-01',
      address: '1 Analytical Way',
      city: 'London',
      country: 'United Kingdom',
      documentType: 'passport',
      files: { passport: new File(['x'], 'passport.png', { type: 'image/png' }) },
    });

    expect(sent.init.body).toBeInstanceOf(FormData);

    // The whole point. A content-type here makes the server report every text
    // field as missing.
    const headers = sent.init.headers ?? {};
    const names = Object.keys(headers).map((key) => key.toLowerCase());
    expect(names).not.toContain('content-type');

    // The bearer token still goes, which is the header that must NOT be
    // dropped along with it.
    expect(headers.authorization).toBe('Bearer test-token');
  });

  it('carries the text fields and the file under the field name the route expects', async () => {
    let body;
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
      body = init.body;
      return Promise.resolve(envelope({ status: 'Pending' }));
    });

    const file = new File(['x'], 'front.jpg', { type: 'image/jpeg' });
    const { result } = renderHook(() => useSubmitKyc(), { wrapper: wrapper() });

    await result.current.mutateAsync({
      firstName: 'Ada',
      lastName: 'Lovelace',
      dateOfBirth: '1990-01-01',
      gender: '',
      address: '1 Analytical Way',
      city: 'London',
      country: 'United Kingdom',
      documentType: 'id_card',
      files: { idFront: file, idBack: undefined },
    });

    expect(body.get('firstName')).toBe('Ada');
    expect(body.get('documentType')).toBe('id_card');
    expect(body.get('idFront')).toBe(file);

    // Empty and absent values are dropped rather than sent as "" or
    // "undefined" — the submit validator is not `.strict()` but `gender` is a
    // `z.enum`, and "" is not one of its members.
    expect(body.get('gender')).toBeNull();
    expect(body.get('idBack')).toBeNull();
  });
});

describe('the combined transaction history', () => {
  it('is two counted sides, not a flat list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      envelope({
        deposits: { count: 2, rows: [{ id: 1, amount: '10.00000000' }] },
        withdrawals: { count: 0, rows: [] },
      }),
    );

    const { result } = renderHook(() => useTransactionHistory({ limit: 25 }), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(Array.isArray(result.current.data)).toBe(false);
    expect(result.current.data.deposits.count).toBe(2);
    expect(result.current.data.deposits.rows).toHaveLength(1);
    expect(result.current.data.withdrawals.rows).toEqual([]);
  });

  it('sends limit/offset, never page/limit', async () => {
    let url;
    vi.spyOn(globalThis, 'fetch').mockImplementation((requested) => {
      url = String(requested);
      return Promise.resolve(envelope({ deposits: { count: 0, rows: [] }, withdrawals: { count: 0, rows: [] } }));
    });

    const { result } = renderHook(() => useTransactionHistory({ limit: 25, offset: 50 }), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The validator is `.strict()`: `page` here is a 422, and a 422 on a list
    // renders as an empty table.
    expect(url).toContain('limit=25');
    expect(url).toContain('offset=50');
    expect(url).not.toContain('page=');
  });
});

describe('beginning two-factor setup', () => {
  it('is a POST and is never retried — a retry mints a second secret', async () => {
    const calls = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
      calls.push(init.method);
      return Promise.resolve(
        new Response(JSON.stringify({ success: false, error: { code: 'X', message: 'no' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });

    const { result } = renderHook(() => useBeginTwoFactor(), { wrapper: wrapper() });

    await expect(result.current.mutateAsync()).rejects.toBeTruthy();

    // One attempt. `POST /2fa/enable` overwrites the stored secret every time
    // it is called, so a retried failure can leave the player's authenticator
    // holding a secret the server has already discarded.
    expect(calls).toEqual(['POST']);
  });
});
