import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from './api';
import { shouldRetry, retryDelay } from '@/queries/client';
import { formatWait } from '@/components/ui/QueryState';
import { SocketError, RATE_LIMIT_WINDOW_MS } from './socket';

/**
 * Rate limiting, on both transports.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THESE ARE WORTH A TEST
 *
 * A rate limit is the one failure where the obvious client behaviour makes
 * things worse. Every attempt inside the window is itself counted, so a
 * retry loop extends its own lockout AND adds load to a service that has
 * already said it has too much. The rules that stop that are spread over four
 * files — `api.js` reads the wait, `queries/client.js` decides whether and
 * when to try again, `QueryState` says so, `socket.js` classifies the socket's
 * own refusal — and none of them is exercised by the happy path.
 *
 * The platform's limiter sends the wait TWICE and the two are easy to confuse:
 * `Retry-After` as a header, `details.retryAfter` in the envelope. Both are
 * checked here, including the HTTP-date form of the header, which nothing in
 * this deployment sends today but an intermediary in front of it would.
 * ═════════════════════════════════════════════════════════════════════════
 */

const limited = ({ header, body } = {}) =>
  new Response(
    JSON.stringify({
      success: false,
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many requests, please slow down',
        details: { requestId: 'req-1', ...(body === undefined ? {} : { retryAfter: body }) },
      },
    }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json',
        ...(header === undefined ? {} : { 'retry-after': header }),
      },
    },
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a 429 over HTTP', () => {
  it('reads the wait from the Retry-After header', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => limited({ header: '60' }));

    const error = await api('/x', { auth: false }).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(429);
    expect(error.isRateLimited).toBe(true);
    expect(error.retryAfter).toBe(60);
  });

  it('prefers the header over the envelope when both are present', async () => {
    // An intermediary that shortened the window is the case this covers: the
    // header is what the thing nearest the client actually enforces.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      limited({ header: '5', body: 3600 }),
    );

    const error = await api('/x', { auth: false }).catch((e) => e);
    expect(error.retryAfter).toBe(5);
  });

  it('falls back to details.retryAfter when there is no header', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => limited({ body: 3600 }));

    const error = await api('/x', { auth: false }).catch((e) => e);
    expect(error.retryAfter).toBe(3600);
  });

  it('reads an HTTP-date Retry-After as seconds from now', async () => {
    const at = new Date(Date.now() + 90_000).toUTCString();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => limited({ header: at }));

    const error = await api('/x', { auth: false }).catch((e) => e);

    // The date has second precision and the clock moves between the two, so
    // this is a window rather than an equality.
    expect(error.retryAfter).toBeGreaterThanOrEqual(88);
    expect(error.retryAfter).toBeLessThanOrEqual(90);
  });

  it('is null rather than a guess when the limiter says nothing', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => limited());

    const error = await api('/x', { auth: false }).catch((e) => e);
    expect(error.retryAfter).toBeNull();
  });

  it('does not attach a wait to a failure that is not a rate limit', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', details: {} } }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
    );

    const error = await api('/x', { auth: false }).catch((e) => e);
    expect(error.retryAfter).toBeNull();
    expect(error.isRateLimited).toBe(false);
  });

  it('does not retry inside `api` itself', async () => {
    // The whole point: one request, one attempt. Backoff is the query layer's
    // decision, made once, not a loop buried in the transport.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => limited({ header: '60' }));

    await api('/x', { auth: false }).catch(() => {});

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('the query layer’s backoff', () => {
  const rateLimited = (retryAfter) =>
    new ApiError({ code: 'TOO_MANY_REQUESTS', status: 429, retryAfter, details: {} });

  it('allows exactly one more attempt after a 429', () => {
    expect(shouldRetry(0, rateLimited(60))).toBe(true);
    expect(shouldRetry(1, rateLimited(60))).toBe(false);
  });

  it('waits as long as the server said, not as long as the curve says', () => {
    // The curve's first delay is 1s. Honouring it would land the retry inside
    // the same window that refused the first attempt.
    expect(retryDelay(0, rateLimited(20))).toBe(20_000);
  });

  it('caps the wait so a long window does not hide the error state', () => {
    expect(retryDelay(0, rateLimited(3600))).toBe(30_000);
  });

  it('uses the exponential curve when no wait was given', () => {
    expect(retryDelay(0, rateLimited(null))).toBe(1000);
    expect(retryDelay(2, rateLimited(null))).toBe(4000);
  });

  it('still refuses to retry a 4xx that is not a rate limit', () => {
    expect(shouldRetry(0, new ApiError({ code: 'VALIDATION_ERROR', status: 422 }))).toBe(false);
  });
});

describe('the wait, as the player reads it', () => {
  it('counts seconds, then minutes, then hours', () => {
    expect(formatWait(1)).toBe('1 second');
    expect(formatWait(45)).toBe('45 seconds');
    expect(formatWait(60)).toBe('1 minute');
    expect(formatWait(3600)).toBe('1 hour');
  });

  it('rounds UP at every boundary', () => {
    // A wait announced as shorter than it is produces a second refusal, which
    // is the outcome the message exists to prevent.
    expect(formatWait(61)).toBe('2 minutes');
    expect(formatWait(3601)).toBe('2 hours');
  });

  it('answers null for a wait it was never given', () => {
    expect(formatWait(null)).toBeNull();
    expect(formatWait(0)).toBeNull();
    expect(formatWait(undefined)).toBeNull();
  });
});

describe('a rate limit over the socket', () => {
  it('classifies the transport’s own refusal', () => {
    const error = new SocketError({ code: 'SOCKET_RATE_LIMITED', message: 'slow down' });
    expect(error.isRateLimited).toBe(true);
  });

  it('does not classify a module refusal as one', () => {
    const error = new SocketError({ code: 'CRYPTOWITHDRAW_INSUFFICIENT_FUNDS' });
    expect(error.isRateLimited).toBe(false);
  });

  it('publishes the window a poll must wait out', () => {
    // The socket sends no `Retry-After`, so the only safe wait is the whole
    // fixed window. Every bucket in `DEFAULT_LIMITS` is 10s.
    expect(RATE_LIMIT_WINDOW_MS).toBe(10_000);
  });
});
