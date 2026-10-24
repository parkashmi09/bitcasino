import { expect, test } from '@playwright/test';

/**
 * Register → sign in → read a real balance.
 *
 * The first half of Phase 8's end-to-end bullet. The second half — playing a
 * round — is `play.spec.js`, because it needs an account with money in it and
 * a freshly registered one has none.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WHAT THIS CATCHES THAT 185 UNIT TESTS CANNOT
 *
 * Every unit test in this repository mocks the transport. That is the right
 * choice for them and it means none of them can see:
 *
 *   - a CORS preflight the browser refuses, so every call fails before it is
 *     sent — `CORS_ORIGIN` is a deployment variable, not code;
 *   - `AuthProvider`'s bootstrap under REAL StrictMode double-invocation
 *     against a REAL refresh round trip, which is precisely where the
 *     header-skeleton-forever bug lived in Phase 3;
 *   - a session that survives `register` but not the reload after it, because
 *     the refresh token did not persist;
 *   - the socket staying anonymous after sign-in, which refuses every
 *     `player` event on a page that looks entirely healthy.
 *
 * All four render a correct-looking screen that does nothing, which is why
 * they are worth a browser.
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * A username nobody else has.
 *
 * The platform's uniqueness constraint covers `name` and `email`, and this
 * suite creates an account on every run against a database that is not reset
 * between them. A fixed name passes once and 422s forever after — which reads
 * as a broken registration form rather than as a re-run.
 */
function freshAccount() {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return {
    username: `e2e_${stamp}`,
    email: `e2e_${stamp}@example.test`,
    // Ten characters minimum, length-first with no composition rule — see
    // `auth.validators.js` for why that floor is both stronger and kinder.
    password: 'e2e-playwright-passphrase',
  };
}

/** The signed-in header's balance control, which only exists when signed in. */
const balanceChip = (page) => page.locator('button[aria-label^="Balance,"]');

test.describe('a session', () => {
  test('registers, signs the player in, and shows a real balance', async ({ page }) => {
    const account = freshAccount();

    await page.goto('/register');

    await page.getByLabel('Username').fill(account.username);
    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(account.password);

    /* The terms box is `sr-only` with a styled span beside it — clicking the
       LABEL is what a person does, and it is also the only click Playwright
       will make against a visually hidden input without `force`. Reaching for
       `force` here would skip the very thing being tested: that the control
       is operable. */
    await page.getByText('I agree to Terms & Conditions and Privacy Policy').click();

    await page.getByRole('button', { name: 'Create account' }).click();

    /**
     * `register` answers 201 with the session payload — one round trip creates
     * the account AND signs it in. So the balance chip is the assertion, not
     * a redirect to the login page.
     */
    await expect(balanceChip(page)).toBeVisible();

    /* A brand-new account has a `credits` row at zero. `0.00` IS a real
       balance and the correct thing to show; what must not appear is an
       empty control or a skeleton that never resolves. */
    await expect(balanceChip(page)).toContainText(/\d/);
  });

  test('keeps the session across a hard reload', async ({ page }) => {
    /**
     * The regression this exists for.
     *
     * The access token never leaves memory, so a reload has only the refresh
     * token to go on — and `AuthProvider` exchanges it during a moment where
     * the app genuinely does not know who is looking. StrictMode invokes that
     * effect twice. Phase 3 shipped a version where the teardown of the first
     * run cancelled the only run the guard allowed, and the header sat on its
     * skeleton forever with two 200s in the network panel.
     *
     * Nothing but a real reload against a real refresh endpoint reproduces it.
     */
    const account = freshAccount();

    await page.goto('/register');
    await page.getByLabel('Username').fill(account.username);
    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByText('I agree to Terms & Conditions and Privacy Policy').click();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(balanceChip(page)).toBeVisible();

    await page.reload();

    // Not `toBeVisible` alone: the skeleton is visible too. The chip carries
    // a digit and the skeleton does not.
    await expect(balanceChip(page)).toContainText(/\d/);
    await expect(page.getByRole('link', { name: 'Sign Up' })).toHaveCount(0);
  });

  test('signs in an existing account through the login form', async ({ page }) => {
    /* The seeded demo player, from `backend/scripts/seed-data.js --demo`.
       Registering and then logging in with the same credentials would test
       the same minute-old row twice; this proves the login path against an
       account this suite did not create. */
    await page.goto('/login');

    await page.getByLabel('Username or Email').fill('demo_player01');
    await page.getByLabel('Password', { exact: true }).fill('Demo@12345');
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(balanceChip(page)).toContainText(/\d/);
  });

  test('refuses a wrong password without signing anybody in', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Username or Email').fill('demo_player01');
    await page.getByLabel('Password', { exact: true }).fill('not-the-password');
    await page.getByRole('button', { name: 'Log in' }).click();

    /* The refusal is a message, and the session must not exist. Asserting
       only the message would pass for a form that showed an error AND signed
       the player in anyway, which is not a hypothetical shape of bug. */
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(balanceChip(page)).toHaveCount(0);
  });
});
