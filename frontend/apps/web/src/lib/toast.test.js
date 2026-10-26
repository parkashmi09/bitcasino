import { afterEach, describe, expect, it, vi } from 'vitest';
import { dismissToast, resetToasts, subscribeToasts, toast } from './toast';

describe('toast store', () => {
  afterEach(() => { resetToasts(); vi.useRealTimers(); });

  it('keeps the newest three and expires each on its own timer', () => {
    vi.useFakeTimers();
    let seen = [];
    const off = subscribeToasts((list) => { seen = list; });
    ['a', 'b', 'c', 'd'].forEach((m) => toast.success(m));
    expect(seen.map((t) => t.message)).toEqual(['b', 'c', 'd']);
    toast.error('boom');
    vi.advanceTimersByTime(4000);
    expect(seen.map((t) => t.message)).toEqual(['boom']);
    dismissToast(seen[0].id);
    expect(seen).toEqual([]);
    off();
  });

  it('ignores an empty message (a mutation without meta.success)', () => {
    expect(toast.success(undefined)).toBe(null);
  });
});
