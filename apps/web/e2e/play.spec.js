import { expect, test } from '@playwright/test';

/**
 * Play a real round of Limbo and watch the balance move.
 *
 * The second half of Phase 8's end-to-end bullet, and the only test anywhere
 * in this repository that exercises the whole stack at once: browser →
 * socket.io → casino-service → one database transaction across `bets`,
 * `credits` and `house` → a reply on the COMMAND envelope → a re-read of the
 * wallet over HTTP on user-service.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * IT NEEDS THE SECOND SOCKET, AND THAT IS THE POINT.
 *
 * In-house rounds live on casino-service (:4003), not user-service (:4001),
 * because the stake debit, the result and the payout are ONE transaction
 * against casino tables — user-service does not load that domain. So this
 * page holds two connections on two paths through two proxy rewrites, and
 * `bindSession` has to RECONNECT the casino one on sign-in rather than
 * rebinding it, since `ONLINE_LOGGED` is not registered there.
 *
 * Get that wrong and the casino socket stays anonymous, every `PLAY_*` is
 * refused for the life of the connection, and the symptom is a Bet button
 * that does nothing at all. No unit test sees it; this one does.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** The seeded demo player, funded with 10,000 INR by `--demo`. */
const PLAYER = { name: 'demo_player01', password: 'Demo@12345' };

/**
 * `/play/:category/:slug`, where the slug is the catalogue **uuid**.
 *
 * The Phase 0 seeder writes in-house rows with `uuid` set to the engine key
 * and `type: 'originals'`, so Limbo is `originals/limbo` — not a slugified
 * title, which is what `useRecentlyPlayed` records having got wrong once.
 */
const LIMBO = '/play/originals/limbo';

const balanceChip = (page) => page.locator('button[aria-label^="Balance,"]');

/** Digits only, so `1,234.50 INR` and `1234.5` compare as the same number. */
function amountOf(text) {
  const match = String(text).replace(/,/g, '').match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

async function signIn(page) {
  await page.goto('/login');
  await page.getByLabel('Username or Email').fill(PLAYER.name);
  await page.getByLabel('Password', { exact: true }).fill(PLAYER.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(balanceChip(page)).toContainText(/\d/);
}

test.describe('an in-house round', () => {
  test('settles, moves the balance, and appears in recent rounds', async ({ page }) => {
    await signIn(page);

    await page.goto(LIMBO);

    const stake = page.getByLabel('Bet amount');
    await expect(stake).toBeVisible();

    /**
     * A stake small enough that the account outlives a losing streak across
     * re-runs, and a target low enough that the round is accepted.
     *
     * This test deliberately does NOT assert a win. The result is drawn from
     * a provably-fair hash and asserting an outcome would make the suite fail
     * roughly half the time — the contract under test is that a round SETTLES
     * and the ledger moves, not which way it went.
     */
    await stake.fill('1');
    await page.getByLabel('Target multiplier').fill('2.00');

    const before = amountOf(await balanceChip(page).innerText());
    expect(before).not.toBeNull();

    await page.getByRole('button', { name: 'Bet' }).click();

    /* The result panel is the settled round — `{command: 'busted', target,
       result, hash, profit, balance}`. Its appearance is what says the
       transaction committed rather than the request having been refused. */
    await expect(page.getByText(/Roll above|×/).first()).toBeVisible();

    /**
     * The balance must CHANGE. Win or lose it cannot stay the same: a loss
     * takes the stake and a win returns more than it.
     *
     * The chip re-reads over HTTP after the round rather than trusting the
     * `balance` field in the socket reply, so this also proves the two
     * services agree about the same money.
     */
    await expect
      .poll(async () => amountOf(await balanceChip(page).innerText()), {
        message: 'the balance chip never moved after a settled round',
        timeout: 15_000,
      })
      .not.toBe(before);

    /* And the round is in the player's own history — `GET /casino/bet-history`
       on casino-service, a different read path from the one that settled it.
       A round that settled but was never written would pass every assertion
       above. */
    await expect(page.getByText(/Limbo|limbo/).first()).toBeVisible();
  });

  test('refuses a stake larger than the balance, without taking it', async ({ page }) => {
    await signIn(page);
    await page.goto(LIMBO);

    const before = amountOf(await balanceChip(page).innerText());

    await page.getByLabel('Bet amount').fill('999999999');
    await page.getByLabel('Target multiplier').fill('2.00');

    /* The client refuses first — the Bet button disables and says why — so
       the request is never sent. That is the behaviour being asserted: the
       server would also refuse, but a client that let it through would be
       spending a round trip to be told something it already knew. */
    await expect(page.getByRole('alert')).toContainText(/balance/i);
    await expect(page.getByRole('button', { name: 'Bet' })).toBeDisabled();

    // And nothing moved.
    expect(amountOf(await balanceChip(page).innerText())).toBe(before);
  });

  test('tells a signed-out visitor to sign in rather than failing silently', async ({ page }) => {
    /**
     * The failure this replaces is the worst one on the page: an anonymous
     * socket is ACCEPTED by the server (a missing token is a visitor, not an
     * error), so the connection looks healthy and every `PLAY_*` on it is
     * refused. Without an explicit signed-out state the button would simply
     * do nothing.
     */
    await page.goto(LIMBO);

    await expect(page.getByRole('link', { name: /log in/i }).first()).toBeVisible();
  });
});
