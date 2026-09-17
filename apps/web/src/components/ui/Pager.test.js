import { describe, expect, it } from 'vitest';
import { pageWindow } from './Pager';

/** `[1, null, 3]` -> `'1 … 3'`, which is how the cases below are written. */
const render = (page, total) =>
  pageWindow(page, total)
    .map((n) => (n === null ? '…' : n))
    .join(' ');

describe('pageWindow', () => {
  /**
   * Read off the reference's own pager on `/categories/video-slots`, which
   * runs to 203 pages — the only list long enough to exercise every branch.
   * These are transcriptions, not expectations chosen to fit the code.
   */
  it.each([
    [1, '1 2 3 4 … 203'],
    [3, '1 2 3 4 … 203'],
    [4, '1 … 3 4 5 … 203'],
    [5, '1 … 4 5 6 … 203'],
    [12, '1 … 11 12 13 … 203'],
    [202, '1 … 200 201 202 203'],
    [203, '1 … 200 201 202 203'],
  ])('matches the reference at page %i of 203', (page, expected) => {
    expect(render(page, 203)).toBe(expected);
  });

  /**
   * The reference's Baccarat page, which is three pages. Short lists show
   * every number — an ellipsis that hides nothing is worse than the numbers.
   */
  it('draws every number when the list is short', () => {
    expect(render(1, 3)).toBe('1 2 3');
    expect(render(2, 3)).toBe('1 2 3');
    expect(render(3, 3)).toBe('1 2 3');
    expect(render(1, 4)).toBe('1 2 3 4');
    expect(render(4, 4)).toBe('1 2 3 4');
  });

  it('always keeps the first and last page reachable', () => {
    for (let total = 1; total <= 40; total += 1) {
      for (let page = 1; page <= total; page += 1) {
        const window = pageWindow(page, total);
        const numbers = window.filter((n) => n !== null);
        expect(numbers[0], `page ${page} of ${total}`).toBe(1);
        expect(numbers.at(-1), `page ${page} of ${total}`).toBe(total);
        expect(numbers, `page ${page} of ${total}`).toContain(page);
      }
    }
  });

  it('never emits two ellipses in a row, or one at either end', () => {
    for (let total = 1; total <= 60; total += 1) {
      for (let page = 1; page <= total; page += 1) {
        const window = pageWindow(page, total);
        expect(window[0], `page ${page} of ${total}`).not.toBeNull();
        expect(window.at(-1), `page ${page} of ${total}`).not.toBeNull();
        window.forEach((n, i) => {
          if (n === null) expect(window[i + 1], `page ${page} of ${total}`).not.toBeNull();
        });
      }
    }
  });

  it('emits numbers in strictly ascending order, with no repeats', () => {
    for (let total = 1; total <= 60; total += 1) {
      for (let page = 1; page <= total; page += 1) {
        const numbers = pageWindow(page, total).filter((n) => n !== null);
        const ascending = numbers.every((n, i) => i === 0 || n > numbers[i - 1]);
        expect(ascending, `page ${page} of ${total}: ${numbers.join(' ')}`).toBe(true);
      }
    }
  });

  /**
   * An ellipsis must stand for at least one number it is hiding. This is the
   * property the first draft of this function got wrong in the other
   * direction — it collapsed a gap of one into the number, which the reference
   * does not do (see page 4 above) — so it is worth pinning from both sides.
   */
  it('only draws an ellipsis where numbers are actually missing', () => {
    for (let total = 1; total <= 60; total += 1) {
      for (let page = 1; page <= total; page += 1) {
        const window = pageWindow(page, total);
        window.forEach((n, i) => {
          if (n !== null) return;
          expect(window[i + 1] - window[i - 1], `page ${page} of ${total}`).toBeGreaterThan(1);
        });
      }
    }
  });

  it('survives a page number outside the list', () => {
    expect(render(0, 3)).toBe('1 2 3');
    expect(render(99, 3)).toBe('1 2 3');
    expect(pageWindow(1, 0)).toEqual([1]);
  });
});
