import { expect, test } from '@playwright/test';

/**
 * Password recovery, as far as a browser can take it.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * THE HAPPY PATH CANNOT BE DRIVEN FROM HERE, AND THAT IS STATED RATHER
 * THAN WORKED AROUND.
 *
 * The code goes to an inbox and NOWHERE else — it is not in the response,
 * not in a header, not in a debug field. That is the single most important
 * property of the flow (legacy's `POST /send-otp` answered `{message, otp}`
 * and handed the caller the code), so a test hook that leaked it back to this
 * suite would be undoing the thing being protected.
 *
 * Reading it properly needs a mail catcher — MailHog or its like — wired into
 * the platform's SMTP configuration and polled over its own API. That is a
 * fixture, not a line in a spec, and it is worth building; it is not built.
 *
 * So the end-to-end coverage of the full three steps lives in
 * `backend/services/user/src/modules/auth/__tests__/registration.test.js`,
 * which drives the same three service calls against a real database with a
 * recording mailer and reads the code out of the rendered message. What is
 * asserted HERE is everything the browser can see without the inbox — which
 * is the routing, the enumeration-safety, and the guard.
 * ═══════════════════════════════════════════════════════════════════════
 */

test.describe('password recovery', () => {
  test('the login page links to a real screen, not back to itself', async ({ page }) => {
    /**
     * The regression this exists for, in one assertion.
     *
     * `/forgot-password` was `<Navigate to="/login" replace />`, so this link
     * returned the player to the panel they had just failed at. It looked
     * like a working link and the site had no account recovery at all.
     */
    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot password?' }).click();

    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  });

  test('asks for an address, then moves to the code step', async ({ page }) => {
    await page.goto('/forgot-password');

    await page.getByLabel('Email').fill('demo_player01@demo.local');
    await page.getByRole('button', { name: 'Send code' }).click();

    await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
    await expect(page.getByLabel('Code')).toBeVisible();
  });

  test('SAYS THE SAME THING FOR AN ADDRESS THAT HAS NO ACCOUNT', async ({ page }) => {
    /**
     * The enumeration guard, asserted from the outside.
     *
     * `POST /email/otp` answers identically either way and sends nothing for
     * an unknown address — legacy answered `User not found`, which turns the
     * reset box into a free membership check. The screen has to match: if it
     * ever said "we found your account" or "check your inbox", the server's
     * care would be undone by the copy in front of it.
     *
     * Both addresses are compared against the SAME rendered text rather than
     * against a fixed string, so a future rewording cannot pass this test
     * while reintroducing the leak.
     */
    const settleOn = async (email) => {
      await page.goto('/forgot-password');
      await page.getByLabel('Email').fill(email);
      await page.getByRole('button', { name: 'Send code' }).click();
      await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
      // The step's own copy, with the address itself masked out — the page
      // echoes what was typed, and that is not a disclosure.
      const body = await page.locator('form').innerText();
      return body.replace(email, '<address>');
    };

    const known = await settleOn('demo_player01@demo.local');
    const unknown = await settleOn('definitely-nobody-here@example.invalid');

    expect(unknown).toBe(known);
  });

  test('refuses a code that is not six digits, in the client', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill('demo_player01@demo.local');
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByLabel('Code')).toBeVisible();

    const code = page.getByLabel('Code');

    /* Letters and punctuation are stripped rather than sent: the server's
       regex is exactly six digits, so a space pasted in from a mail client
       would be a 422 — which reads as "your code is wrong" when it is not. */
    await code.fill('12ab-34');
    await expect(code).toHaveValue('1234');
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();

    await code.fill('123456789');
    await expect(code).toHaveValue('123456');
    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  test('a wrong code is refused and does not advance', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill('demo_player01@demo.local');
    await page.getByRole('button', { name: 'Send code' }).click();

    await page.getByLabel('Code').fill('000000');
    await page.getByRole('button', { name: 'Continue' }).click();

    /* One in a million says this could be the real code. If it ever is, the
       password step appears and this fails — which is the correct outcome for
       a test that cannot tell the difference, and is why the assertion is on
       the heading NOT changing rather than on the error text. */
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
  });

  test('sends a signed-in player to the site rather than the reset form', async ({ page }) => {
    /* Behind `RedirectIfAuthenticated`, like the other two auth screens.
       Somebody already signed in who wants a new password wants
       `/profile/security`, which asks for the current one and needs no email
       round trip. */
    await page.goto('/login');
    await page.getByLabel('Username or Email').fill('demo_player01');
    await page.getByLabel('Password', { exact: true }).fill('Demo@12345');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.locator('button[aria-label^="Balance,"]')).toContainText(/\d/);

    await page.goto('/forgot-password');

    await expect(page.getByRole('heading', { name: 'Reset your password' })).toHaveCount(0);
  });
});
