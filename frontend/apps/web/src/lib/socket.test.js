import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The transport's two reply envelopes, and the routing between two servers.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THE ENVELOPE TESTS ARE THE IMPORTANT ONES
 *
 * `createSocketServer` does not wrap a handler's return value — it replies
 * with exactly what the handler produced. user-service's modules each wrap
 * their own (`const ok = (payload) => ({status: true, ...payload})`); the
 * `in-house` module never adopted that and answers legacy's `command`
 * envelope instead.
 *
 * So there are two readers, and picking the wrong one fails in the worst
 * possible direction each way:
 *
 *   `request()` on a PLAY_* reply  -> a WON round rejected as an error
 *   `play()` on a wallet reply     -> a refusal read as a success
 *
 * Every shape below was captured from the running services, not invented:
 * casino-service on :4003 for the `command` ones, user-service on :4001 for
 * the `status` ones.
 * ═════════════════════════════════════════════════════════════════════════
 */

/** The fake connection the module gets instead of a real socket. */
let emitted;
let nextReply;

vi.mock('socket.io-client', () => ({
  io: vi.fn((url, options) => {
    const connection = {
      url,
      options,
      close: vi.fn(),
      timeout: () => ({
        emit: (event, frame, ack) => {
          emitted.push({ event, frame, url, path: options.path });
          const reply = nextReply.shift();
          // `[timeoutError, frame]` is socket.io's ack signature under
          // `.timeout()` — the first slot is null on a real reply.
          queueMicrotask(() => ack(null, encodeFrame(reply)));
        },
      }),
    };
    return connection;
  }),
}));

vi.mock('@/auth/tokenStore', () => ({
  tokenStore: { getAccess: () => 'test-token' },
}));

const encodeFrame = (data) => new TextEncoder().encode(JSON.stringify(data));

let socket;

beforeEach(async () => {
  emitted = [];
  nextReply = [];
  vi.resetModules();
  socket = await import('./socket');
});

afterEach(() => {
  socket.closeSocket();
});

describe('the command envelope — PLAY_* on casino-service', () => {
  it('resolves a settled round, which carries no `status` key at all', async () => {
    // Captured from casino-service: `{coin:'INR', amount:'10', payout:'2.00'}`.
    nextReply.push({
      command: 'busted',
      target: '2.16',
      result: '2.16',
      hash: 'a1b2',
      profit: '10.00000000',
      balance: '9999.80000000',
      win: true,
      gid: '3',
    });

    const round = await socket.play(socket.EVENTS.PLAY_LIMBO, {
      coin: 'INR',
      amount: '10',
      payout: '2.00',
    });

    expect(round.command).toBe('busted');
    expect(round.win).toBe(true);
    expect(round.balance).toBe('9999.80000000');
  });

  it('rejects `command: error` with the module\'s own INHOUSE_ code', async () => {
    nextReply.push({
      command: 'error',
      message: 'Your balance is not enough',
      code: 'INHOUSE_INSUFFICIENT_BALANCE',
    });

    await expect(
      socket.play(socket.EVENTS.PLAY_LIMBO, { coin: 'INR', amount: '9e9', payout: '2.00' }),
    ).rejects.toMatchObject({
      code: 'INHOUSE_INSUFFICIENT_BALANCE',
      message: 'Your balance is not enough',
    });
  });

  it('rejects a transport-guard refusal, which has no `command` key', async () => {
    // The framework refusing before the handler ran — unauthenticated, rate
    // limited, or a handler that threw. Same shape on both envelopes.
    nextReply.push({ error: { code: 'SOCKET_UNAUTHENTICATED', message: 'Sign in first' } });

    await expect(socket.play(socket.EVENTS.PLAY_LIMBO, {})).rejects.toMatchObject({
      code: 'SOCKET_UNAUTHENTICATED',
      message: 'Sign in first',
    });
  });

  it('would have been rejected by `request()` — which is why `play()` exists', async () => {
    nextReply.push({ command: 'busted', result: '2.16', win: true, balance: '1.00000000' });

    // The regression this whole split guards against: a won round read as a
    // refusal, with no code and no message to show for it.
    await expect(socket.request(socket.EVENTS.PLAY_LIMBO, {})).rejects.toMatchObject({
      code: 'SOCKET_ERROR',
    });
  });
});

describe('the status envelope — wallet events on user-service', () => {
  it('resolves and strips `status`', async () => {
    nextReply.push({ status: true, coin: 'USDT', address: 'demo1abc', allocated: true });

    const answer = await socket.request(socket.EVENTS.GET_ADDRESS, { coin: 'USDT' });

    expect(answer).toEqual({ coin: 'USDT', address: 'demo1abc', allocated: true });
    expect(answer).not.toHaveProperty('status');
  });

  it('rejects a handler refusal, where `status` IS the message and is truthy', async () => {
    // The shape that makes `if (reply.status)` pass on a failure.
    nextReply.push({
      status: 'That currency cannot be withdrawn',
      error: { code: 'CRYPTOWITHDRAW_UNSUPPORTED_COIN' },
    });

    await expect(socket.request(socket.EVENTS.SUBMIT_NEW_WITHDRAWL, {})).rejects.toMatchObject({
      code: 'CRYPTOWITHDRAW_UNSUPPORTED_COIN',
      message: 'That currency cannot be withdrawn',
    });
  });
});

describe('routing', () => {
  it('sends a PLAY_* event to casino-service and a wallet event to user-service', async () => {
    nextReply.push({ command: 'busted', result: '1.00' });
    nextReply.push({ status: true });

    await socket.play(socket.EVENTS.PLAY_LIMBO, {});
    await socket.request(socket.EVENTS.GET_ADDRESS, {});

    // Two separate connections, distinguished by path — both Socket.io servers
    // listen on the default `/socket.io`, so the casino one is same-origin
    // under a path Vite rewrites. One shared connection would reach a server
    // with no listener for half the table, which is silent on both sides.
    expect(emitted[0].path).toBe('/casino-socket');
    expect(emitted[1].path).toBe('/socket.io');
  });
});

describe('the wire format', () => {
  it('round-trips through the frame the server sends', () => {
    const payload = { coin: 'INR', amount: '10.00000000' };
    expect(socket.decode(socket.encode(payload))).toEqual(payload);
  });

  it('reads a plain object frame, which the server sends untouched', () => {
    // `encode` returns null for a falsy payload and several handlers emit that
    // — a null frame means "no data" rather than an error.
    expect(socket.encode(null)).toBeNull();
    expect(socket.decode(null)).toBeNull();
    expect(socket.decode({ status: true })).toEqual({ status: true });
  });
});
