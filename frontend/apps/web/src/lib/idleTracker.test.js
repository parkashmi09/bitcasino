import { afterEach, describe, expect, it, vi } from 'vitest';
import { idleNotice, startIdleTracker } from './idleTracker';

const MIN = 60_000;
const setup = (check) => {
  const o = { ping: vi.fn(async () => {}), check: vi.fn(check), hasSession: () => true, onSignedOut: vi.fn() };
  return { o, stop: startIdleTracker({ minutes: 1, ...o }) };
};
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('idle tracker', () => {
  afterEach(() => vi.useRealTimers());

  it('pings at most once a minute (plus a trailing one) while the player interacts', async () => {
    vi.useFakeTimers();
    const { o, stop } = setup(async () => ({ signedOut: false }));
    await flush();
    expect(o.ping).toHaveBeenCalledTimes(1); // mount
    for (let i = 0; i < 5; i += 1) {
      await vi.advanceTimersByTimeAsync(5_000);
      window.dispatchEvent(new Event('keydown'));
    }
    expect(o.ping).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(35_000);
    expect(o.ping).toHaveBeenCalledTimes(2); // trailing, at the minute
    expect(o.check).not.toHaveBeenCalled(); // never idle a full minute
    stop();
  });

  it('after the window with no interaction asks the server; signedOut ends it', async () => {
    vi.useFakeTimers();
    const { o } = setup(async () => ({ signedOut: true }));
    await vi.advanceTimersByTimeAsync(MIN + 10);
    expect(o.check).toHaveBeenCalledTimes(1);
    expect(o.onSignedOut).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('keydown'));
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(o.ping).toHaveBeenCalledTimes(1); // stopped: no more heartbeats
  });

  it('kept by the server (a bet in a game iframe): checks again at nextCheckAt', async () => {
    vi.useFakeTimers();
    const { o, stop } = setup(async () => ({ signedOut: false, nextCheckAt: new Date(Date.now() + 30_000).toISOString() }));
    await vi.advanceTimersByTimeAsync(MIN + 10);
    expect(o.check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(o.check).toHaveBeenCalledTimes(2);
    expect(o.onSignedOut).not.toHaveBeenCalled();
    stop();
  });

  it('a failed check with the tokens gone (the server sweep won) still reports the sign-out', async () => {
    vi.useFakeTimers();
    const onSignedOut = vi.fn();
    startIdleTracker({ minutes: 1, ping: async () => {}, check: async () => { throw new Error('401'); }, hasSession: () => false, onSignedOut });
    await vi.advanceTimersByTimeAsync(MIN + 10);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(idleNotice(1)).toBe('You were signed out after 1 minute of inactivity');
  });
});
