import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { Refer } from './Refer';

/**
 * The banner's consent line, and the dialog it opens.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE CONSENT LINE IS A BUTTON, NOT A LINK
 *
 * The reference opens "Referral Terms & Conditions" in a dialog rather than
 * navigating to a terms page. When this was a plain `<a href="/terms">`, and
 * `/terms` redirected to `/register` (which a logged-in player lands back on
 * home from), a granted-consent click looked like it was throwing the player
 * out of the page entirely.
 *
 * This test pins the shape that replaced it: a real button (`type="button"`,
 * so it cannot submit a form), and a click that leaves the dialog in the DOM
 * and the route untouched.
 */

vi.mock('@/hooks/useReferral', () => ({
  useReferral: () => ({
    link: 'https://bitcasino.test/ref/abc123',
    referrals: 0,
    earned: '0',
    status: 'ready',
  }),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/profile/refer-a-friend']}>
      <Refer />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the referral terms consent line', () => {
  it('is a button rather than a link', () => {
    renderPage();

    const consent = screen.getByRole('button', { name: /referral terms/i });
    expect(consent.type).toBe('button');
    expect(consent.tagName).toBe('BUTTON');
  });

  it('opens the terms dialog without navigating away', () => {
    renderPage();

    // No dialog on first paint.
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /referral terms/i }));

    expect(screen.getByRole('dialog', { name: /refer a friend terms/i })).toBeTruthy();
    expect(screen.getByText(/govern the Bitcasino Refer a Friend Program/i)).toBeTruthy();
    expect(screen.getAllByText(/Program Overview/i).length).toBeGreaterThan(0);
  });

  it('shows both the overview and the general terms', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /referral terms/i }));

    // Clauses before the table and after it (the list runs through the table),
    // then the general terms' own list.
    expect(screen.getByText(/A registered Bitcasino user/i)).toBeTruthy();
    expect(screen.getByText(/Wagering on restricted games/i)).toBeTruthy();
    expect(screen.getByText(/modify and adjust the reward levels/i)).toBeTruthy();
    expect(screen.getByText(/modify or terminate the Program/i)).toBeTruthy();
    expect(screen.getByText(/shall be resolved in the courts of Curacao/i)).toBeTruthy();
  });

  it('does not let string clauses render as empty links', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /referral terms/i }));

    const dialog = screen.getByRole('dialog');
    const links = dialog.querySelectorAll('a');
    // Every anchor must be the one real clause link — `String.prototype.link`
    // is a legacy DOM method, and `item.link` on a string clause is a function
    // rather than `undefined`. There is exactly one in-app anchor.
    expect(links.length).toBe(1);
    expect(links[0].getAttribute('href')).toBe('/help-center/reward-terms');
  });
});

describe('the share menu', () => {
  // The empty state carries its own `LinkRow`, so the page renders two Share
  // triggers; both behave the same, and the banner's comes first.
  function openBannerShare() {
    fireEvent.click(screen.getAllByRole('button', { name: 'Share' })[0]);
  }

  it('opens under the Share button with the four networks', () => {
    renderPage();

    expect(screen.queryByRole('menu')).toBeNull();
    openBannerShare();

    const menu = screen.getByRole('menu', { name: /share your invite link/i });
    const rows = within(menu).getAllByRole('menuitem');
    expect(rows.map((row) => row.textContent.trim())).toEqual([
      'Share via Telegram',
      'Share via WhatsApp',
      'Share via Messenger',
      'Share via Line',
    ]);
  });

  it('points each network at its own share intent', () => {
    renderPage();
    openBannerShare();

    const link = 'https://bitcasino.test/ref/abc123';
    const rows = within(screen.getByRole('menu')).getAllByRole('menuitem');
    const href = (index) => rows[index].getAttribute('href');

    expect(href(0)).toBe(`https://t.me/share/url?url=${encodeURIComponent(link)}`);
    expect(href(1)).toBe(`https://wa.me/?text=${encodeURIComponent(link)}`);
    expect(href(2)).toBe(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`,
    );
    expect(href(3)).toBe(`https://line.me/R/msg/?text=${encodeURIComponent(link)}`);
  });
});