import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/auth/AuthProvider';
import { api, ApiError } from '@/lib/api';
import { ENDPOINTS } from '@/lib/endpoints';
import { cn } from '@/lib/cn';

/**
 * `/profile/security`.
 *
 * Two cards under the account tab bar: the password, and two-factor
 * authentication. That is the whole page on the reference — no sessions list,
 * no device history, nothing else.
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
 * ## What is real
 *
 * `Update` opens a dialog that calls `POST /api/v1/user/auth/change-password`
 * with `{currentPassword, newPassword}` — a live endpoint, already registered
 * in `lib/endpoints.js`. The 2FA row reads `two_fa_status` off `/auth/me`, so
 * `Active` / `Inactive` is the account's real state.
 *
 * **The toggle does not toggle.** The platform in `backend/` has no route to
 * turn 2FA on or off: `modules/auth` serves `me`, `sessions`, `logout` and
 * `change-password` and nothing else, and the only 2FA path anywhere is
 * `POST /email/2fa/reset`, which is a public *recovery* flow, not a setting.
 * `docs/10` lists `POST /2fa/enable` under Phase 6 as work still to do. So the
 * switch paints exactly as the reference draws it and is `aria-disabled` with
 * a title saying why — the rule the account menu's unbuilt rows and the
 * account page's `Start verification` both follow. When those routes land,
 * this is a `useState` and an `api()` call away.
 */
export function Security() {
  const { user } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);

  // `/auth/me` answers `two_fa_status`; the session payload the login response
  // carries calls the same flag `twoFactorEnabled`. Either can be the one that
  // landed first, so both are read — see `AuthProvider`, which merges them.
  const twoFactorOn = Boolean(user?.two_fa_status ?? user?.twoFactorEnabled);

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
                {twoFactorOn ? 'Active' : 'Inactive'}
              </span>
            </>
          }
        >
          <Switch
            checked={twoFactorOn}
            label="App Authentication"
            reason="Turning two-factor authentication on or off is not available yet."
          />
        </Row>
      </Card>

      <ChangePasswordDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
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

/**
 * The 2FA switch: a 44x24 track on a 100px radius with a 16px knob inset 4px,
 * exactly the reference's. `beerus` off, `piccolo` on.
 *
 * `role="switch"` on a `div` rather than a `<button>`: this one has nothing to
 * press. A `<button disabled>` is skipped by a screen reader, so the state it
 * is reporting — which is the whole point of the control — would be
 * unreachable. `aria-disabled` announces both the state and the fact that it
 * cannot be changed, and `title` says why on hover. Same rule `MenuRow` uses
 * for the account menu's unbuilt rows.
 */
function Switch({ checked, label, reason }) {
  return (
    <div
      role="switch"
      aria-checked={checked}
      aria-disabled="true"
      aria-label={label}
      title={reason}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full p-1 transition-colors',
        checked ? 'bg-piccolo' : 'bg-beerus',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-1 block size-4 rounded-full bg-gohan transition-all duration-200',
          checked ? 'start-6' : 'start-1',
        )}
      />
    </div>
  );
}

/** Matches the dialog enter/leave animations in index.css. */
const ANIMATION_MS = 150;

/** The backend's rule, from `auth.validators.js`: 10-200, no composition rule. */
const MIN_LENGTH = 10;

/**
 * What `Update` opens.
 *
 * Same chrome as `ClaimRewardDialog` on the rewards page — one card, an
 * overlay that closes on click, Escape to dismiss, focus returned to the
 * opener, body scroll locked while it is up. Built here rather than shared
 * because the two differ in everything below the frame, and a `Dialog`
 * abstraction over two callers would be one indirection for no reuse; if a
 * third lands, extract it then.
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
  // The panel stays mounted for one animation after `open` goes false, so the
  // zoom-out is not cut off by React unmounting the tree.
  const [closing, setClosing] = useState(false);

  const firstFieldRef = useRef(null);
  const openerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    openerRef.current = document.activeElement;
    setClosing(false);
    setCurrent('');
    setNext('');
    setConfirm('');
    setError(null);
    setFieldErrors({});
    setDone(false);

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const id = window.setTimeout(() => firstFieldRef.current?.focus(), 0);

    return () => {
      window.clearTimeout(id);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => {
      setClosing(false);
      onClose();
      openerRef.current?.focus?.();
    }, ANIMATION_MS);
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open && !closing) return null;

  const leaving = closing || !open;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        role="presentation"
        onClick={close}
        className={cn(
          'absolute inset-0 bg-popo/50',
          leaving ? 'animate-overlay-out' : 'animate-overlay-in',
        )}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Change password"
        className={cn(
          'relative grid w-full max-w-[448px] gap-4 rounded-i-md bg-goku p-4',
          'shadow-lg ring-1 ring-bulma/10 outline-none',
          leaving ? 'animate-dialog-out' : 'animate-dialog-in',
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b-[0.5px] border-beerus pb-4">
          <h2 className="font-primary text-lg leading-7 font-medium tracking-normal text-bulma">
            Change password
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="-me-1 -mt-1 grid size-8 shrink-0 cursor-pointer place-items-center rounded-i-sm text-bulma transition-colors hover:bg-heles"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {done ? (
          <div className="grid gap-4">
            <p className="text-base leading-6 text-bulma">
              Your password has been changed.
            </p>
            {/* Not a nicety: `changePassword` revokes every session for the
                account, this one included, so the tab is already holding a
                dead refresh token. Saying so beats a 401 five minutes later. */}
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
      </div>
    </div>
  );
}

/**
 * A password field with the reference's `Show` control inside it.
 *
 * `Show` is a `<button>`, not a link: it changes what is on screen and goes
 * nowhere. It carries `aria-pressed` so the state is announced, and it is
 * `tabIndex={-1}` — tabbing from one password field should reach the next
 * field, not a visibility toggle in between, and the control stays reachable
 * by pointer and by the screen reader's own navigation.
 *
 * `ref` goes to the input so the dialog can focus the first field on open.
 */
function PasswordField({ ref, label, value, onChange, autoComplete, error }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const messageId = error ? `${id}-error` : undefined;

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-base leading-6 text-trunks">
        {label}
      </label>

      <div
        className={cn(
          'flex h-10 items-center gap-2 rounded-i-sm border-[1.6px] bg-transparent px-2.5',
          'transition-colors focus-within:border-piccolo',
          error ? 'border-chichi' : 'border-hit',
        )}
      >
        <input
          ref={ref}
          id={id}
          name={id}
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={messageId}
          className="h-full w-full min-w-0 bg-transparent text-base leading-6 text-bulma outline-none placeholder:text-trunks"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-pressed={shown}
          onClick={() => setShown((value_) => !value_)}
          className="shrink-0 cursor-pointer text-sm font-medium text-bulma underline underline-offset-2 transition-colors hover:text-piccolo"
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>

      {error && (
        <p id={messageId} className="text-xs leading-4 text-chichi">
          {error}
        </p>
      )}
    </div>
  );
}
