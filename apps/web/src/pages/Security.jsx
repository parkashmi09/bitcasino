import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { CodeField, PasswordField } from '@/components/ui/PasswordField';
import { useAuth } from '@/auth/AuthProvider';
import {
  useBeginTwoFactor,
  useCompleteTwoFactor,
  useDisableTwoFactor,
  useSessions,
  useTwoFactorStatus,
} from '@/queries';
import { api, ApiError } from '@/lib/api';
import { ENDPOINTS } from '@/lib/endpoints';
import { cn } from '@/lib/cn';

/**
 * `/profile/security`.
 *
 * Three cards under the account tab bar: the password, two-factor
 * authentication, and the account's active sessions. The reference has the
 * first two and stops there — no session list, no device history — so the
 * third is a deliberate addition, argued below.
 *
 * Every number below was read off `bitcasino.io/profile/security` itself, with
 * `getBoundingClientRect` and `getComputedStyle` on each piece, by the
 * procedure in `docs/11-comparing-against-the-reference.md`, at a 1540px
 * viewport:
 *
 *   page          `grid gap-2`, heading at y=162 — the same 8px lead-in the
 *                 account page has, not the flush `h1` Notifications uses
 *   heading       24px/32, weight 400, `bulma` — DM Sans, not the display face
 *   card          `gohan`, 12px radius, **752px max**, 16px pad and 32px/24px
 *                 from `sm`, 16px between its blocks
 *   rule BETWEEN  1px `beerus`, the FULL width of the column (1205px), not the
 *                 card's 752 — it is a page divider, not part of either card
 *   row           40px, label at the start, control at the end
 *
 * ## The reference's two cards are not styled the same, and that is not a typo
 *
 * Read off the live page rather than assumed:
 *
 *   Login heading                `h4.text-xl`  20px/28, weight 400
 *   Two-factor heading           `h3.text-lg`  18px/28, weight 500
 *   Login's inner rule           `border-t border-beerus/60`
 *   Two-factor's inner rule      `h-px bg-beerus`
 *
 * Two different elements, two sizes, two weights and two rules for what reads
 * as one repeated card. Both are reproduced as measured. Anyone tempted to
 * "fix" the pair into one component should know it is a difference in the
 * reference, not a mistake here — `docs/11` records it.
 *
 * ## What is real — all of it, as of Phase 6
 *
 * `Update` opens a dialog that calls `POST /api/v1/user/auth/change-password`
 * with `{currentPassword, newPassword}`.
 *
 * **The toggle now toggles.** An earlier version of this file said the
 * platform had no route to turn 2FA on or off — "the only 2FA path anywhere
 * is `POST /email/2fa/reset`". That was wrong: `modules/twofa` mounts five
 * player routes at `/api/v1/user/2fa/*`, and the switch drives four of them
 * through a two-step setup dialog and a disable dialog. The state comes from
 * `GET /2fa/status` rather than from `/auth/me`, because `status` is the
 * module's own answer and carries `hasInitiated` besides — an abandoned setup
 * is a real state and `two_fa_status` cannot express it.
 *
 * ## The third card is NOT on the reference
 *
 * `bitcasino.io/profile/security` has two cards and no session list. This
 * build adds one, because `GET /auth/sessions` exists, the sessions are real,
 * and an account page that can change a password but cannot show where the
 * account is signed in is missing the half of the story that matters after a
 * password is stolen. It is drawn in the page's own idiom rather than invented
 * chrome, and `docs/11` records it as a deliberate divergence.
 */
export function Security() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="grid gap-2">
      {/* `font-primary` and `tracking-normal` both undo the base `h1` rule,
          which sets the display face and -0.01em. The reference's account
          headings are plain DM Sans at 24/32 with no tracking. */}
      <h1 className="font-primary text-2xl font-normal tracking-normal text-bulma">
        Security
      </h1>

      <Card>
        {/* 20/28 weight 400 — the reference's `h4.text-xl` here. */}
        <h2 className="font-primary text-xl leading-7 font-normal tracking-normal text-bulma">
          Login
        </h2>
        {/* `mt-2` on top of the card's own 16px grid gap is the reference's
            own `[&:not(:first-child)]:mt-2`, which is why the gap under the
            Login heading measures 24px and every other gap in the card is 16. */}
        <p className="mt-2 text-base leading-6 text-trunks">
          Make sure to use a strong and unique password to keep your account secure.
        </p>
        <hr className="border-0 border-t border-beerus/60" />
        <Row label="Password">
          <Button onClick={() => setDialogOpen(true)} className="text-base">
            Update
          </Button>
        </Row>
      </Card>

      {/* The page divider, at the column's full width rather than the card's. */}
      <hr className="h-px border-0 bg-beerus" />

      <TwoFactorCard />

      <hr className="h-px border-0 bg-beerus" />

      <SessionsCard />

      <ChangePasswordDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}

/**
 * Two-factor authentication, over the four `/2fa/*` routes.
 *
 * The switch is the reference's, and what sits behind it is a state machine
 * with three positions rather than two:
 *
 *   isEnabled: false, hasInitiated: false   never set up
 *   isEnabled: false, hasInitiated: true    a secret was minted, never confirmed
 *   isEnabled: true                         on
 *
 * The middle one is why `hasInitiated` is read at all. A player who scanned a
 * QR and then closed the tab has an authenticator showing codes for a secret
 * the account is not using, and a card that said only "Inactive" would leave
 * them to discover that by trying to sign in. It says so instead, and the
 * setup dialog mints a fresh secret when they come back — which is correct,
 * because `POST /2fa/enable` overwrites the stored one and the old entry in
 * their app is already dead.
 */
function TwoFactorCard() {
  const { data, isPending, isError } = useTwoFactorStatus();
  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  const enabled = Boolean(data?.isEnabled);
  const halfSet = !enabled && Boolean(data?.hasInitiated);

  return (
    <Card>
      {/* 18/28 weight 500 — the reference's `h3.text-lg` here. See above. */}
      <h2 className="font-primary text-lg leading-7 font-medium tracking-normal text-bulma">
        Two-factor authentication
      </h2>
      <hr className="h-px border-0 bg-beerus" />

      <Row
        label={
          <>
            <span className="text-sm leading-5 text-bulma">App Authentication</span>{' '}
            <span className="text-sm leading-5 text-trunks">
              {isPending ? '…' : isError ? 'Unavailable' : enabled ? 'Active' : 'Inactive'}
            </span>
          </>
        }
      >
        {isPending ? (
          <Skeleton className="h-6 w-11 rounded-full" />
        ) : (
          <Switch
            checked={enabled}
            label="App Authentication"
            /**
             * A failed status read drops `onChange`, which is what turns the
             * switch back into the reporting `div` — see the component. It is
             * the one case it must not act on: flipping it would begin a
             * setup on an account whose real state is unknown, and
             * `POST /2fa/enable` answers 409 on one already enabled.
             */
            {...(isError
              ? { reason: 'Could not read your two-factor status. Reload the page.' }
              : { onChange: () => (enabled ? setDisableOpen(true) : setSetupOpen(true)) })}
          />
        )}
      </Row>

      {halfSet && (
        <p className="text-sm leading-5 text-trunks">
          You started setting this up but never confirmed a code, so it is not
          protecting your account yet. Turning it on issues a new QR code —
          delete the old entry from your authenticator app.
        </p>
      )}

      <TwoFactorSetupDialog open={setupOpen} onClose={() => setSetupOpen(false)} />
      <TwoFactorDisableDialog open={disableOpen} onClose={() => setDisableOpen(false)} />
    </Card>
  );
}

/**
 * Where the account is signed in.
 *
 * `GET /auth/sessions` answers every unrevoked, unexpired refresh session.
 * There is **no per-session revoke route** — `POST /auth/logout` takes a
 * `refreshToken` for one or `{allSessions: true}` for all, and nothing
 * addresses a session by id — so this offers the one action that exists and
 * does not draw a per-row button that could not work.
 *
 * The current session is not marked, and cannot be: the list carries no
 * session id the client can match its own token against, and guessing from
 * the user-agent would mark every tab in the same browser. Rather than
 * labelling the wrong row, the button says plainly that it signs this device
 * out too.
 */
function SessionsCard() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { data, isPending, isError } = useSessions();
  const [busy, setBusy] = useState(false);

  const sessions = Array.isArray(data) ? data : [];

  async function signOutEverywhere() {
    setBusy(true);
    try {
      await api(ENDPOINTS.logout, { method: 'POST', body: { allSessions: true } });
    } catch {
      // The local session is cleared regardless. A failed call leaves the
      // OTHER devices signed in, which is worse — but staying signed in here
      // as well helps nobody, and `logout()` below is what the player asked
      // for on this device.
    } finally {
      await logout();
      navigate('/login', { replace: true });
    }
  }

  return (
    <Card>
      <h2 className="font-primary text-lg leading-7 font-medium tracking-normal text-bulma">
        Where you are signed in
      </h2>
      <hr className="h-px border-0 bg-beerus" />

      {isPending ? (
        <div className="grid gap-2">
          {[0, 1].map((row) => (
            <Skeleton key={row} className="h-12 rounded-i-sm" />
          ))}
        </div>
      ) : isError ? (
        <p className="text-sm leading-5 text-trunks">
          Could not load your sessions. Reload the page to try again.
        </p>
      ) : sessions.length === 0 ? (
        /* Not reachable in practice — reading this list requires a session,
           so there is always at least one. Rendered anyway rather than
           crashing on an empty array if the server ever disagrees. */
        <p className="text-sm leading-5 text-trunks">No active sessions.</p>
      ) : (
        <ul className="grid gap-2">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-i-sm bg-goku px-3 py-2.5"
            >
              <span className="text-sm leading-5 text-bulma">
                {/* `device_label` is the server's own summary of the
                    user-agent and is null for a client it cannot summarise,
                    such as curl. The raw agent is not printed in its place —
                    it is 120 characters of version numbers. */}
                {session.device_label || 'Unrecognised device'}
              </span>
              <span className="text-xs leading-4 text-trunks tabular-nums">
                {session.ip_address ?? 'unknown IP'} · last used{' '}
                {formatWhen(session.last_used_at ?? session.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Row label={`${sessions.length || 'No'} active session${sessions.length === 1 ? '' : 's'}`}>
        <Button
          variant="secondary"
          onClick={signOutEverywhere}
          disabled={busy || isPending}
          className="text-base"
        >
          {busy ? 'Signing out…' : 'Sign out everywhere'}
        </Button>
      </Row>

      <p className="text-xs leading-4 text-trunks">
        This signs out every device, including this one.
      </p>
    </Card>
  );
}

/**
 * A timestamp as something a person reads.
 *
 * Relative under a day because "3 hours ago" is what tells somebody whether a
 * session is theirs; absolute beyond that, because "14 days ago" is not.
 */
function formatWhen(value) {
  if (!value) return 'unknown';
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return 'unknown';

  const seconds = Math.round((Date.now() - then.getTime()) / 1000);
  if (seconds < 90) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;

  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * One block. `max-w-[752px]` is the reference's own cap and it lives on the
 * card rather than the page, because the divider between the two cards runs
 * the full width of the column and would be cut short by a wrapper.
 */
function Card({ children }) {
  return (
    <section className="grid max-w-[752px] gap-4 rounded-i-md bg-gohan p-4 sm:p-8 sm:pb-6">
      {children}
    </section>
  );
}

/**
 * Label at the start, control at the end.
 *
 * The reference writes this as `grid gap-2` and then gets a row out of it
 * anyway — `display` resolves to `flex` on the live page — with the label
 * padded down 12px against a `leading-none` line box to fake the centring.
 * Written as the flex row it actually is, with `items-center` doing the
 * centring properly.
 *
 * **No minimum height.** The row is exactly as tall as its control, which is
 * what makes the two cards the reference's two different heights: 40px under
 * Login where the control is a button, 24px under Two-factor where it is a
 * 24px switch, so the cards measure 205 and 141 rather than both measuring the
 * taller one.
 */
function Row({ label, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm leading-5 font-medium text-bulma">{label}</p>
      {children}
    </div>
  );
}

/** The backend's rule, from `auth.validators.js`: 10-200, no composition rule. */
const MIN_LENGTH = 10;


/**
 * What `Update` opens.
 *
 * The chrome — overlay, panel, Escape, focus return, scroll lock — is
 * `components/ui/Dialog.jsx` now. An earlier version of this file built it
 * inline and said "if a third lands, extract it then"; Phase 6 landed three
 * more, so it did.
 *
 * ## The copy is NOT the reference's, deliberately
 *
 * The reference's dialog says the password "must have at least 7 characters
 * that include at least one number or uppercase letter", and that changing it
 * blocks withdrawals for 48 hours. Neither is true of this build: the
 * validator behind `POST /auth/change-password` is `min(10).max(200)` with no
 * composition rule at all, and the 48-hour hold is the operator's own policy,
 * which this project does not implement. Copying either would be a rule the
 * form then contradicts — a 9-character password with a capital in it would be
 * accepted by the page and rejected by the server.
 *
 * What replaces the second line is the thing that *does* happen, read from
 * `auth.service.js`: the change revokes every session for the account, the
 * caller's included. So the success state does not pretend the player is still
 * signed in — it says what happened and offers the one action left.
 */
function ChangePasswordDialog({ open, onClose }) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const firstFieldRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setCurrent('');
    setNext('');
    setConfirm('');
    setError(null);
    setFieldErrors({});
    setDone(false);
  }, [open]);

  /**
   * Checked here as well as on the server, because every one of these can be
   * answered without a round trip and a rejected password is the worst thing
   * to make somebody wait for. The server is still the authority — its 422
   * lands on the same fields through `ApiError.fields`.
   */
  function validate() {
    const issues = {};
    if (!current) issues.current = 'Enter your current password.';
    if (next.length < MIN_LENGTH) {
      issues.next = `Your new password must be at least ${MIN_LENGTH} characters.`;
    } else if (next === current) {
      issues.next = 'The new password must be different from the current one.';
    }
    if (confirm !== next) issues.confirm = 'The two passwords do not match.';
    return issues;
  }

  async function submit(event) {
    event.preventDefault();
    setError(null);

    const issues = validate();
    setFieldErrors(issues);
    if (Object.keys(issues).length > 0) return;

    setBusy(true);
    try {
      await api(ENDPOINTS.changePassword, {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      });
      setDone(true);
    } catch (cause) {
      if (cause instanceof ApiError) {
        // A 422 names the field it rejected; everything else is about the
        // attempt and belongs in the banner. `CURRENT_PASSWORD_INCORRECT` is
        // the one worth putting on a field anyway — it is the only thing the
        // player can act on without rereading the form.
        if (cause.code === 'CURRENT_PASSWORD_INCORRECT') {
          setFieldErrors({ current: cause.message });
        } else if (cause.fields?.length) {
          setFieldErrors({
            current: cause.fieldError('currentPassword') ?? undefined,
            next: cause.fieldError('newPassword') ?? undefined,
          });
        } else {
          setError(cause.message);
        }
      } else {
        setError('Something went wrong. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function signInAgain() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <Dialog open={open} onClose={onClose} title="Change password" initialFocus={firstFieldRef}>
      {done ? (
        <div className="grid gap-4">
          <p className="text-base leading-6 text-bulma">Your password has been changed.</p>
          {/* Not a nicety: `changePassword` revokes every session for the
              account, this one included, so the tab is already holding a dead
              refresh token. Saying so beats a 401 five minutes later. */}
          <p className="text-sm leading-5 text-trunks">
            Every device signed in to this account has been signed out, including
            this one. Sign in again with your new password.
          </p>
          <Button size="lg" fullWidth onClick={signInAgain}>
            Sign in again
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-4">
          <p className="text-base leading-6 text-trunks">
            Let&apos;s make this strong together! Your password must be at least{' '}
            {MIN_LENGTH} characters.
          </p>

          <PasswordField
            ref={firstFieldRef}
            label="Current password"
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
            error={fieldErrors.current}
          />
          <PasswordField
            label="New password"
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            error={fieldErrors.next}
          />
          <PasswordField
            label="Confirm password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            error={fieldErrors.confirm}
          />

          <p
            aria-live="polite"
            className={cn('min-h-5 text-sm leading-5', error && 'text-chichi')}
          >
            {error}
          </p>

          {/* The reference prints a 48-hour withdrawal hold here. That is the
              operator's policy and not this build's; what this build really
              does is revoke every session. */}
          <p className="text-center text-xs leading-4 text-trunks">
            Changing your password signs you out on every device.
          </p>

          <Button type="submit" size="lg" fullWidth disabled={busy}>
            {busy ? 'Changing…' : 'Change password'}
          </Button>
        </form>
      )}
    </Dialog>
  );
}

/**
 * Turning two-factor authentication ON — a three-step handshake, in two
 * screens.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * `POST /2fa/enable` IS NOT IDEMPOTENT, AND THAT SHAPES THIS WHOLE COMPONENT.
 *
 * It mints a NEW secret and overwrites the stored one every time it is
 * called. So a second call after the player has scanned the first QR leaves
 * their authenticator showing codes for a secret the server has discarded —
 * every code they type is then correct in their app and wrong here, with
 * nothing on screen to explain it.
 *
 * Hence: fired ONCE, from the effect on open, and the answer held in the
 * mutation's own state for the life of the dialog. Not a query — a query
 * would refetch on window focus, on remount, on cache invalidation, and each
 * of those is a fresh secret. Not called on render. Not retried.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * The secret is shown as text beside the QR because a player setting this up
 * on the same device they are reading it on cannot photograph their own
 * screen. That is what `secret` is in the response for — the service comments
 * say it is "returned once, for manual entry when a camera is not available".
 */
function TwoFactorSetupDialog({ open, onClose }) {
  const begin = useBeginTwoFactor();
  const complete = useCompleteTwoFactor();

  const [code, setCode] = useState('');
  const [done, setDone] = useState(false);
  const codeRef = useRef(null);

  // `open` is the only input that may fire this. Anything else in the
  // dependency list is another secret minted — see the block above.
  useEffect(() => {
    if (!open) return;
    setCode('');
    setDone(false);
    complete.reset();
    begin.reset();
    begin.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit(event) {
    event.preventDefault();
    try {
      await complete.mutateAsync({ code });
      setDone(true);
    } catch {
      // `complete.error` carries it and the form renders from that. The code
      // is kept so the player can correct a digit rather than retype six.
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Two-factor authentication"
      initialFocus={codeRef}
    >
      {done ? (
        <div className="grid gap-4">
          <p className="text-base leading-6 text-bulma">
            Two-factor authentication is on.
          </p>
          <p className="text-sm leading-5 text-trunks">
            You will be asked for a code from your authenticator app the next
            time you sign in. Keep the app — without it, and without the
            account email, you cannot get back in.
          </p>
          <Button size="lg" fullWidth onClick={onClose}>
            Done
          </Button>
        </div>
      ) : begin.isPending ? (
        <div className="grid justify-items-center gap-3 py-6">
          <Skeleton className="size-40 rounded-i-sm" />
          <Skeleton className="h-4 w-56" />
        </div>
      ) : begin.isError ? (
        <div className="grid gap-4">
          <p role="alert" className="text-sm leading-5 text-chichi">
            {/* `ALREADY_ENABLED` is worth its own sentence: it means the card
                behind this dialog is showing a stale state, and reloading is
                the fix rather than retrying. */}
            {begin.error?.code === 'TWOFA_ALREADY_ENABLED'
              ? 'Two-factor authentication is already on for this account. Reload the page.'
              : begin.error?.message || 'Could not start the setup.'}
          </p>
          <Button variant="secondary" size="lg" fullWidth onClick={onClose}>
            Close
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-4">
          <p className="text-base leading-6 text-trunks">
            Scan this with an authenticator app, then enter the six-digit code
            it shows.
          </p>

          {begin.data?.qrCode && (
            <img
              src={begin.data.qrCode}
              alt="Two-factor setup QR code"
              width={160}
              height={160}
              className="mx-auto size-40 rounded-i-sm bg-goten p-1"
            />
          )}

          {/* For a player setting this up on the device they are reading it
              on, who cannot photograph their own screen. */}
          {begin.data?.secret && (
            <div className="grid gap-1 rounded-i-sm bg-gohan px-3 py-2.5">
              <span className="text-xs leading-4 text-trunks">
                Or enter this key by hand
              </span>
              <code className="font-mono text-sm break-all text-bulma">
                {begin.data.secret}
              </code>
            </div>
          )}

          <CodeField
            ref={codeRef}
            value={code}
            onChange={setCode}
            error={complete.isError ? complete.error?.message : undefined}
            hint="Ten attempts every fifteen minutes."
          />

          <Button
            type="submit"
            size="lg"
            fullWidth
            disabled={code.length !== 6 || complete.isPending}
          >
            {complete.isPending ? 'Verifying…' : 'Turn on'}
          </Button>
        </form>
      )}
    </Dialog>
  );
}

/**
 * Turning it OFF — the code AND the account password.
 *
 * Both, because this is the one action on the page that lowers the account's
 * security: it needs the second factor itself and the thing that factor
 * protects. `twofa.service.js` checks the password first and answers
 * `TWOFA_PASSWORD_REQUIRED` before it looks at the code, which is why the
 * error lands on the password field rather than the code one.
 *
 * The password lives in component state for the duration of the form and
 * nowhere else — not in a query key, not in the cache — the same rule the
 * withdrawal form follows.
 *
 * Worth knowing, and said on screen: disabling CLEARS the secret rather than
 * flagging it off, so turning it back on issues a new QR and the old entry in
 * the authenticator app is dead. A player who expected to re-enable with the
 * same entry would otherwise find out by being locked out of the setup.
 */
function TwoFactorDisableDialog({ open, onClose }) {
  const disable = useDisableTwoFactor();

  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const codeRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setCode('');
    setPassword('');
    disable.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit(event) {
    event.preventDefault();
    try {
      await disable.mutateAsync({ code, password });
      // Cleared the moment it is no longer needed, before anything renders.
      setPassword('');
      onClose();
    } catch {
      // `disable.error` carries it. The password is kept so the player can
      // correct whichever of the two was wrong.
    }
  }

  const wrongPassword = disable.error?.code === 'TWOFA_PASSWORD_REQUIRED';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Turn off two-factor authentication"
      initialFocus={codeRef}
    >
      <form onSubmit={submit} className="grid gap-4">
        <p className="text-base leading-6 text-trunks">
          Enter a code from your authenticator app and your account password.
        </p>

        <CodeField
          ref={codeRef}
          value={code}
          onChange={setCode}
          error={disable.isError && !wrongPassword ? disable.error?.message : undefined}
        />

        <PasswordField
          label="Account password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          error={wrongPassword ? disable.error?.message : undefined}
        />

        <p className="text-xs leading-4 text-trunks">
          Turning this off clears the key. If you turn it back on later you will
          scan a new QR code, and the old entry in your app stops working.
        </p>

        <Button
          type="submit"
          size="lg"
          fullWidth
          disabled={code.length !== 6 || password.length === 0 || disable.isPending}
        >
          {disable.isPending ? 'Turning off…' : 'Turn off'}
        </Button>
      </form>
    </Dialog>
  );
}
